import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  powerMonitor,
  protocol,
  session,
  shell,
} from 'electron'
import { hostname } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWindow } from './windows'
import { installMenu } from './menu'
import { LocalStore } from './store'
import type { BootInfo, Preferences } from '../shared/desktop'
import type { ApiRead, ApiReply } from '../shared/api'
import { Connections } from './connections'
import { ApiError } from './api/client'

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
  if (win && !win.isDestroyed()) win.webContents.send('yuki:pair-link', link)
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
    const connections = new Connections(
      store,
      app.getPath('userData'),
      app.getVersion(),
      (id, kind, data) => win?.webContents.send('yuki:hint', id, kind, data),
    )
    const action = <A extends unknown[], T>(name: string, run: (...args: A) => T | Promise<T>) => {
      ipcMain.handle(`yuki:${name}`, async (event, ...args: A): Promise<ApiReply<T>> => {
        authorize(event)
        try {
          return { ok: true, value: await run(...args) }
        } catch (error) {
          return { ok: false, code: error instanceof ApiError ? error.code : 'unknown' }
        }
      })
    }
    action('connections', () => connections.publicList())
    action('subscribe', () => connections.publishStates())
    action('reconnect', () => connections.reconnect())
    powerMonitor.on('resume', () => connections.reconnect())
    action('external', async (raw: string) => {
      const url = new URL(raw)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new ApiError('validation_error')
      const result = await dialog.showMessageBox(win!, {
        type: 'question',
        title: '開啟外部連結',
        message: `在瀏覽器開啟 ${url.hostname}？`,
        detail: url.toString(),
        buttons: ['取消', '開啟'],
        defaultId: 0,
        cancelId: 0,
      })
      if (result.response === 1) await shell.openExternal(url.toString())
    })
    action('meta', (server: string) => connections.meta(server))
    action('pair', async (server: string, code: string, label: string) => {
      const result = await connections.pair(server, code, label)
      pairLink = null
      return result
    })
    action('read', (id: string, route: ApiRead) => connections.read(id, route))
    action('send', (id: string, text: string) => connections.send(id, text))
    action('outbox', (id: string) => connections.box(id).list())
    action('verify', (id: string, requestId: string) => connections.verify(id, requestId))
    action('draft', (id: string, text?: string) => connections.box(id).draft(text))
    for (const connection of connections.list()) connections.start(connection.characterId)
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
    const openWindow = () => {
      const created = createWindow(store)
      win = created
      created.once('closed', () => {
        if (win === created) win = undefined
      })
      installMenu(() => win)
    }
    openWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openWindow()
      } else win?.show()
    })
    app.on('will-quit', () => {
      connections.close()
      store.db.close()
    })
  })
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
