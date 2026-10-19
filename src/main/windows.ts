import { BrowserWindow, nativeTheme, screen, app } from 'electron'
import { join } from 'node:path'
import { windowGeometry, type Rect } from './geometry'
import type { LocalStore } from './store'
import { keyboardCommand } from '../shared/commands'

const modes = new WeakMap<BrowserWindow, (pairing: boolean) => void>()
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
  const opaque = store.preferences().opaque || nativeTheme.prefersReducedTransparency
  const win = new BrowserWindow({
    ...geometry.bounds,
    minWidth: geometry.minimum.width,
    minHeight: geometry.minimum.height,
    title: 'Yuki',
    icon: join(app.getAppPath(), 'resources/icons/app/256x256.png'),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1C1E' : '#F5F5F7',
    titleBarStyle: mac ? 'hiddenInset' : 'hidden',
    ...(mac
      ? {
          trafficLightPosition: { x: 20, y: 18 },
          vibrancy: opaque ? undefined : ('sidebar' as const),
          visualEffectState: 'followWindow' as const,
        }
      : {
          titleBarOverlay: {
            height: 52,
            color: '#00000000',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#F2F2F4' : '#1D1D1F',
          },
        }),
    ...(process.platform === 'win32' && !opaque ? { backgroundMaterial: 'mica' as const } : {}),
    autoHideMenuBar: !mac,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  })
  let adjusting = false
  const fit = () => {
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
      win.setBounds(next.bounds)
    if (!pairing && !win.isMaximized()) store.set('window', next.bounds)
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
    win.setBounds(next.bounds)
    adjusting = false
  })
  screen.on('display-metrics-changed', fit)
  screen.on('display-added', fit)
  screen.on('display-removed', fit)
  win.on('moved', fit)
  win.on('resized', fit)
  win.once('closed', () => {
    modes.delete(win)
    screen.removeListener('display-metrics-changed', fit)
    screen.removeListener('display-added', fit)
    screen.removeListener('display-removed', fit)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const command = keyboardCommand(input, process.platform)
    if (command) {
      event.preventDefault()
      win.webContents.send('yuki:command', command)
    }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })
  win.once('ready-to-show', () => win.show())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadURL('app://desktop/index.html')
  return win
}
