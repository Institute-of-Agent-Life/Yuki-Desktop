import {
  app,
  clipboard,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  Menu,
  net,
  powerMonitor,
  protocol,
  session,
  shell,
  systemPreferences,
} from 'electron'
import { hostname } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWindow, setWindowMode } from './windows'
import { installMenu } from './menu'
import { LocalStore } from './store'
import type { BootInfo, Preferences, NavigationTarget } from '../shared/desktop'
import type { ApiRead, ApiReply, AttachmentSource, WorkCommand } from '../shared/api'
import { Connections } from './connections'
import { ApiError } from './api/client'
import { NativeShell } from './native'
import { ClientNotifications } from './notifications'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])
if (process.env.YUKI_DESKTOP_DATA) app.setPath('userData', process.env.YUKI_DESKTOP_DATA)
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform-hint', 'auto')
app.setAppUserModelId('life.yuki.desktop')

let win: BrowserWindow | undefined
let pairLink: string | null = null
let reveal: (() => void) | undefined
let openTarget: NavigationTarget | null = null
const receiveLink = (link: string) => {
  if (!/^yuki:\/\/pair\?/i.test(link)) return
  pairLink = link
  openTarget = null
  if (win && !win.isDestroyed()) win.webContents.send('yuki:pair-link', link)
  reveal?.()
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  receiveLink(url)
})
const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    argv.filter((arg) => /^yuki:\/\//i.test(arg)).forEach(receiveLink)
    reveal?.()
  })
  process.argv.filter((arg) => /^yuki:\/\//i.test(arg)).forEach(receiveLink)
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
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'self' blob:",
          ],
        },
      })
    })
    let microphoneRequested = false
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        const audio =
          microphoneRequested &&
          contents === win?.webContents &&
          permission === 'media' &&
          'mediaTypes' in details &&
          details.mediaTypes?.every((type) => type === 'audio') === true
        if (audio) microphoneRequested = false
        callback(audio)
      },
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
      (id, kind, data) => {
        win?.webContents.send('yuki:hint', id, kind, data)
        if (['sync', 'conversation', 'work', 'character', 'work_steps'].includes(kind))
          void notifications.wake(id).catch(() => {})
      },
    )
    const native = new NativeShell(
      () => win,
      () => reveal?.(),
      (target) => {
        openTarget = target
        win?.webContents.send('yuki:open-target', target)
      },
    )
    const notifications = new ClientNotifications(store, connections, (notice) =>
      native.show(notice),
    )
    native.update(store.preferences())
    const action = <A extends unknown[], T>(name: string, run: (...args: A) => T | Promise<T>) => {
      ipcMain.handle(`yuki:${name}`, async (event, ...args: A): Promise<ApiReply<T>> => {
        authorize(event)
        try {
          return { ok: true, value: await run(...args) }
        } catch (error) {
          return {
            ok: false,
            code: error instanceof ApiError ? error.code : 'unknown',
            ...(error instanceof ApiError && error.reason ? { reason: error.reason } : {}),
          }
        }
      })
    }
    action('connections', () => connections.publicList())
    action('copy', (text: string) => clipboard.writeText(text))
    action('paste', () => clipboard.readText())
    action('context-menu', (options: { text: string; link?: string; save?: boolean }) => {
      if (
        typeof options.text !== 'string' ||
        (options.link !== undefined && typeof options.link !== 'string')
      )
        throw new ApiError('validation_error')
      return new Promise<'save' | null>((resolve) => {
        const menu = Menu.buildFromTemplate([
          {
            label: '複製',
            click: () => {
              clipboard.writeText(options.text)
              resolve(null)
            },
          },
          ...(options.link
            ? [
                {
                  label: '複製連結文字',
                  click: () => {
                    clipboard.writeText(options.link!)
                    resolve(null)
                  },
                },
              ]
            : []),
          ...(options.save ? [{ label: '存成檔案', click: () => resolve('save') }] : []),
        ])
        menu.popup({ window: win!, callback: () => resolve(null) })
      })
    })
    action('selected', (id: string) => {
      connections.connection(id)
      store.set('selectedCharacterId', id)
      native.selectedCharacter = id
      if (win) setWindowMode(win, false)
    })
    action('open-target', () => openTarget)
    action('acknowledge-target', (target: NavigationTarget) => {
      if (JSON.stringify(openTarget) === JSON.stringify(target)) openTarget = null
    })
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
    action('send', (id: string, text: string, uploads?: string[]) =>
      connections.send(id, text, uploads),
    )
    action('uploads', (id: string) => connections.uploads(id).list())
    action('work-command', (id: string, command: WorkCommand) =>
      connections.workCommand(id, command),
    )
    action('work-commands', (id: string) => connections.commands(id).list())
    action('verify-work-command', (id: string, request: string) =>
      connections.verifyWorkCommand(id, request),
    )
    action('work-draft', (id: string, work: string, text?: string) =>
      connections.commands(id).draft(work, text),
    )
    action('attach', async (id: string) => {
      const picked = await dialog.showOpenDialog(win!, {
        title: '附加檔案',
        properties: ['openFile', 'multiSelections'],
      })
      return picked.canceled
        ? connections.uploads(id).list()
        : connections.stage(id, picked.filePaths)
    })
    action('drop', (id: string, paths: string[]) => connections.stage(id, paths))
    action('record', (id: string, bytes: Uint8Array) => connections.record(id, bytes))
    action('retry-upload', (id: string, request: string) => connections.retryUpload(id, request))
    action('remove-upload', (id: string, request: string) => {
      connections.uploads(id).remove(request)
    })
    action('content', (id: string, source: AttachmentSource) => connections.content(id, source))
    action('save-content', async (id: string, source: AttachmentSource) => {
      const content = await connections.attachment(id, source)
      const picked = await dialog.showSaveDialog(win!, {
        title: '存成檔案',
        defaultPath: basename(content.filename),
      })
      if (picked.canceled || !picked.filePath) return false
      const current = await connections.attachment(id, source)
      await current.cache.save(current.path, current.sha256, picked.filePath)
      return true
    })
    action('microphone', async () => {
      if (
        process.platform === 'darwin' &&
        !(await systemPreferences.askForMediaAccess('microphone'))
      )
        throw new ApiError('microphone_denied')
      microphoneRequested = true
    })
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
        openTarget,
      }
    })
    ipcMain.handle('yuki:preferences', (event, patch: Partial<Preferences>) => {
      authorize(event)
      const current = store.preferences()
      for (const key of [
        'opaque',
        'reducedMotion',
        'highContrast',
        'keepInTray',
        'notifyProactive',
        'notifyWaiting',
        'notifyCompleted',
        'notifyHelp',
      ] as const) {
        if (typeof patch[key] === 'boolean') current[key] = patch[key]
      }
      if (['system', 'light', 'dark'].includes(patch.theme ?? '')) current.theme = patch.theme!
      if (patch.sendKey === 'enter' || patch.sendKey === 'command-enter')
        current.sendKey = patch.sendKey
      if (typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth))
        current.sidebarWidth = Math.max(220, Math.min(320, patch.sidebarWidth))
      if (typeof patch.inspectorWidth === 'number' && Number.isFinite(patch.inspectorWidth))
        current.inspectorWidth = Math.max(320, Math.min(560, patch.inspectorWidth))
      store.set('appearance', current)
      native.update(current)
      nativeTheme.themeSource = current.theme
      if (process.platform === 'darwin')
        win?.setVibrancy(
          current.opaque || nativeTheme.prefersReducedTransparency ? null : 'sidebar',
        )
      return current
    })
    nativeTheme.on('updated', () => win?.webContents.send('yuki:theme', appearance()))
    const openWindow = () => {
      const created = createWindow(
        store,
        !connections.publicList().some((connection) => !connection.needsPairing),
      )
      win = created
      created.once('closed', () => {
        if (win === created) win = undefined
      })
      installMenu(() => win)
    }
    openWindow()
    reveal = () => {
      if (!win) {
        openWindow()
        return
      }
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    app.on('activate', () => {
      reveal?.()
    })
    app.on('browser-window-focus', () => connections.reconnect())
    app.on('window-all-closed', () => {
      if (!store.preferences().keepInTray) app.quit()
    })
    app.on('will-quit', () => {
      native.close()
      void notifications.close().then(() => {
        connections.close()
        store.db.close()
      })
    })
  })
}
