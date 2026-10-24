import { nativeTheme, screen, app, type BrowserWindow } from 'electron'
import { createPlatformWindow } from './linux-frame'
import { applyWindowAppearance, windowAppearance } from './window-appearance'
import { join } from 'node:path'
import { windowGeometry, type Rect } from './geometry'
import type { LocalStore } from './store'
import { keyboardCommand } from '../shared/commands'

const captures = new WeakSet<BrowserWindow>()
const modes = new WeakMap<BrowserWindow, (pairing: boolean) => void>()
const overlayAppearance = () => ({
  height: 52,
  color: '#00000000',
  symbolColor: nativeTheme.shouldUseDarkColors ? '#F2F2F4' : '#1D1D1F',
})
export function setKeyboardCapture(window: BrowserWindow, captured: boolean) {
  if (captured) captures.add(window)
  else captures.delete(window)
  window.webContents.setIgnoreMenuShortcuts(captured)
}
export function setWindowMode(window: BrowserWindow, pairing: boolean) {
  modes.get(window)?.(pairing)
}
export function createWindow(store: LocalStore, pairing = false) {
  const saved = pairing ? undefined : store.get<Rect>('window')
  const work = saved
    ? screen.getDisplayMatching(saved).workArea
    : screen.getPrimaryDisplay().workArea
  let geometry = windowGeometry(work, saved, pairing ? 'pairing' : 'workspace')
  const mac = process.platform === 'darwin'
  const win = createPlatformWindow({
    ...geometry.bounds,
    title: 'Yuki',
    icon: join(app.getAppPath(), 'resources/icons/app/256x256.png'),
    show: false,
    ...windowAppearance(store.preferences()),
    titleBarStyle: mac ? 'hiddenInset' : 'hidden',
    ...(mac
      ? {
          trafficLightPosition: { x: 20, y: 18 },
          visualEffectState: 'followWindow' as const,
        }
      : {
          titleBarOverlay: overlayAppearance(),
        }),
    autoHideMenuBar: !mac,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  })
  applyWindowAppearance(win, store.preferences())
  const updateAppearance = () => {
    applyWindowAppearance(win, store.preferences())
    if (process.platform === 'win32' && !win.isDestroyed())
      win.setTitleBarOverlay(overlayAppearance())
  }
  nativeTheme.on('updated', updateAppearance)
  const applyBounds = (bounds: Rect) => {
    const current = win.getBounds()
    if (
      Object.keys(current).some((key) => current[key as keyof Rect] !== bounds[key as keyof Rect])
    )
      win.setBounds(bounds)
  }
  const applyGeometry = (next: ReturnType<typeof windowGeometry>) => {
    geometry = next
    applyBounds(next.bounds)
    if (process.platform !== 'win32') return
    // Windows projects overlay bounds through its native frame. Measure that
    // projection once for this placement; native dragging never uses setters.
    const actual = win.getBounds(),
      widthOffset = actual.width - next.bounds.width,
      heightOffset = actual.height - next.bounds.height
    applyBounds({
      ...next.bounds,
      width: next.bounds.width - widthOffset,
      height: next.bounds.height - heightOffset,
    })
  }
  let adjusting = false
  let displayId = screen.getDisplayMatching(win.getBounds()).id
  let moveTimer: ReturnType<typeof setTimeout> | undefined
  const cancelMove = () => {
    clearTimeout(moveTimer)
    moveTimer = undefined
  }
  const save = () => {
    cancelMove()
    if (
      !win.isDestroyed() &&
      win.isVisible() &&
      !pairing &&
      !win.isMaximized() &&
      !win.isMinimized() &&
      !win.isFullScreen()
    )
      store.set('window', win.getBounds())
  }
  const fit = () => {
    cancelMove()
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen() || adjusting) return
    adjusting = true
    const old = win.getBounds()
    const display = screen.getDisplayMatching(old)
    displayId = display.id
    const next = windowGeometry(display.workArea, old, pairing ? 'pairing' : 'workspace')
    applyGeometry(next)
    adjusting = false
    save()
  }
  modes.set(win, (nextPairing) => {
    if (pairing === nextPairing) return
    pairing = nextPairing
    adjusting = true
    const display = screen.getDisplayMatching(win.getBounds())
    displayId = display.id
    const next = windowGeometry(
      display.workArea,
      pairing ? undefined : store.get<Rect>('window'),
      pairing ? 'pairing' : 'workspace',
    )
    applyGeometry(next)
    adjusting = false
  })
  screen.on('display-metrics-changed', fit)
  screen.on('display-added', fit)
  screen.on('display-removed', fit)
  // Preserve native movement on the same display. Reapplying its reported bounds
  // after every move can enlarge Windows overlay windows at fractional DPI.
  const moved = () => {
    if (adjusting || win.isDestroyed()) return
    cancelMove()
    moveTimer = setTimeout(() => {
      if (screen.getDisplayMatching(win.getBounds()).id !== displayId) fit()
      else save()
    }, 150)
    moveTimer.unref()
  }
  win.on('move', moved)
  win.on('resize', moved)
  win.on('close', save)
  win.once('closed', () => {
    nativeTheme.removeListener('updated', updateAppearance)
    cancelMove()
    modes.delete(win)
    screen.removeListener('display-metrics-changed', fit)
    screen.removeListener('display-added', fit)
    screen.removeListener('display-removed', fit)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('before-input-event', (event, input) => {
    if (captures.has(win)) return
    if (input.type !== 'keyDown' || input.isComposing) return
    const command = keyboardCommand(input, process.platform)
    if (command) {
      event.preventDefault()
      win.webContents.send('yuki:command', command)
    }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })
  win.once('ready-to-show', () => {
    if (process.platform === 'win32') {
      adjusting = true
      applyGeometry(geometry)
      adjusting = false
    }
    win.show()
    save()
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadURL('app://desktop/index.html')
  return win
}
