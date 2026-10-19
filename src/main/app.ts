import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, session } from 'electron'
import { hostname } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWindow } from './windows'
import { installMenu } from './menu'
import { LocalStore } from './store'
import type { BootInfo, Preferences } from '../shared/desktop'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
if (process.env.YUKI_DESKTOP_DATA) app.setPath('userData', process.env.YUKI_DESKTOP_DATA)
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
app.setAppUserModelId('life.yuki.desktop')

let win: BrowserWindow | undefined
let pairLink: string | null = null
const receiveLink = (link: string) => {
  if (!link.startsWith('yuki://pair?')) return
  pairLink = link
  win?.webContents.send('yuki:pair-link', link)
  win?.show()
  win?.focus()
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  receiveLink(url)
})
const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    argv.filter((arg) => arg.startsWith('yuki://')).forEach(receiveLink)
    if (win?.isMinimized()) win.restore()
    win?.show()
    win?.focus()
  })
  process.argv.filter((arg) => arg.startsWith('yuki://')).forEach(receiveLink)
  void app.whenReady().then(() => {
    const store = new LocalStore(join(app.getPath('userData'), 'desktop.sqlite3'))
    nativeTheme.themeSource = store.preferences().theme
    app.setAsDefaultProtocolClient('yuki')
    const renderer = resolve(import.meta.dirname, '../renderer')
    protocol.handle('app', (request) => {
      const url = new URL(request.url)
      const path = resolve(renderer, `.${decodeURIComponent(url.pathname)}`)
      if (url.hostname !== 'desktop' || !path.startsWith(renderer + sep))
        return new Response(null, { status: 404 })
      return net.fetch(pathToFileURL(path).toString())
    })
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'self' blob:",
          ],
        },
      })
    })
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    )
    const authorize = (event: Electron.IpcMainInvokeEvent) => {
      if (
        !win ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw new Error('untrusted_ipc')
    }
    const appearance = () => ({
      dark: nativeTheme.shouldUseDarkColors,
      reducedTransparency: nativeTheme.prefersReducedTransparency,
      highContrast: nativeTheme.shouldUseHighContrastColors,
    })
    ipcMain.handle('yuki:boot', (event): BootInfo => {
      authorize(event)
      return {
        platform: process.platform as BootInfo['platform'],
        version: app.getVersion(),
        deviceLabel: hostname(),
        ...appearance(),
        preferences: store.preferences(),
        pairLink,
      }
    })
    ipcMain.handle('yuki:preferences', (event, patch: Partial<Preferences>) => {
      authorize(event)
      const current = store.preferences()
      for (const key of ['opaque', 'reducedMotion', 'highContrast'] as const) {
        if (typeof patch[key] === 'boolean') current[key] = patch[key]
      }
      if (['system', 'light', 'dark'].includes(patch.theme ?? '')) current.theme = patch.theme!
      if (typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth))
        current.sidebarWidth = Math.max(220, Math.min(320, patch.sidebarWidth))
      if (typeof patch.inspectorWidth === 'number' && Number.isFinite(patch.inspectorWidth))
        current.inspectorWidth = Math.max(320, Math.min(560, patch.inspectorWidth))
      store.set('appearance', current)
      nativeTheme.themeSource = current.theme
      if (process.platform === 'darwin')
        win?.setVibrancy(
          current.opaque || nativeTheme.prefersReducedTransparency ? null : 'sidebar',
        )
      return current
    })
    nativeTheme.on('updated', () => win?.webContents.send('yuki:theme', appearance()))
    win = createWindow(store)
    installMenu(() => win)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        win = createWindow(store)
        installMenu(() => win)
      } else win?.show()
    })
    app.on('will-quit', () => store.db.close())
  })
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
