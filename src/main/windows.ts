import { nativeTheme, screen, app, type BrowserWindow } from 'electron'
import { createPlatformWindow } from './linux-frame'
import { applyWindowAppearance, windowAppearance } from './window-appearance'
import { join } from 'node:path'
import { windowGeometry, type Rect } from './geometry'
import type { LocalStore } from './store'
import { keyboardCommand } from '../shared/commands'

const modes = new WeakMap<BrowserWindow, (pairing: boolean) => void>()
const overlayAppearance = () => ({
  height: 52,
  color: '#00000000',
  symbolColor: nativeTheme.shouldUseDarkColors ? '#F2F2F4' : '#1D1D1F',
})
export function setWindowMode(window: BrowserWindow, pairing: boolean) {
  modes.get(window)?.(pairing)
}
export function createWindow(store: LocalStore, pairing = false) {
  const saved = pairing ? undefined : store.get<Rect>('window')
  const work = saved
    ? screen.getDisplayMatching(saved).workArea
    : screen.getPrimaryDisplay().workArea
  const geometry = windowGeometry(work, saved, pairing ? 'pairing' : 'workspace')
  const mac = process.platform === 'darwin'
  const win = createPlatformWindow({
    ...geometry.bounds,
    minWidth: geometry.minimum.width,
    minHeight: geometry.minimum.height,
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
    if (process.platform !== 'win32') {
      win.setBounds(bounds)
      return
    }
    // At fractional DPI, reapplying outer bounds can grow an overlay window.
    // Move first, then size its client area using the measured frame difference.
    const current = win.getBounds()
    if (current.x !== bounds.x || current.y !== bounds.y) win.setPosition(bounds.x, bounds.y)
    const outer = win.getBounds()
    if (outer.width !== bounds.width || outer.height !== bounds.height) {
      const content = win.getContentBounds()
      win.setContentSize(
        bounds.width - outer.width + content.width,
        bounds.height - outer.height + content.height,
      )
    }
  }
  let adjusting = false
  let moveTimer: ReturnType<typeof setTimeout> | undefined
  const cancelMove = () => {
    clearTimeout(moveTimer)
    moveTimer = undefined
  }
  const fit = () => {
    cancelMove()
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen() || adjusting) return
    adjusting = true
    const old = win.getBounds()
    const next = windowGeometry(
      screen.getDisplayMatching(old).workArea,
      old,
      pairing ? 'pairing' : 'workspace',
    )
    win.setMinimumSize(next.minimum.width, next.minimum.height)
    if (Object.keys(old).some((key) => old[key as keyof Rect] !== next.bounds[key as keyof Rect]))
      applyBounds(next.bounds)
    if (!pairing && !win.isMaximized()) store.set('window', win.getBounds())
    adjusting = false
  }
  modes.set(win, (nextPairing) => {
    if (pairing === nextPairing) return
    pairing = nextPairing
    adjusting = true
    const area = screen.getDisplayMatching(win.getBounds()).workArea
    const next = windowGeometry(
      area,
      pairing ? undefined : store.get<Rect>('window'),
      pairing ? 'pairing' : 'workspace',
    )
    win.setMinimumSize(next.minimum.width, next.minimum.height)
    applyBounds(next.bounds)
    adjusting = false
  })
  screen.on('display-metrics-changed', fit)
  screen.on('display-added', fit)
  screen.on('display-removed', fit)
  // `moved` is unavailable on Linux. Wait for movement to settle before
  // clamping so intermediate positions can cross into another display.
  win.on('move', () => {
    if (adjusting || win.isDestroyed()) return
    cancelMove()
    moveTimer = setTimeout(fit, 150)
    moveTimer.unref()
  })
  win.on('resize', fit)
  win.on('close', fit)
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
    // Windows resolves its frame and per-monitor DPI during creation.
    if (process.platform === 'win32') applyBounds(geometry.bounds)
    win.show()
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadURL('app://desktop/index.html')
  return win
}
