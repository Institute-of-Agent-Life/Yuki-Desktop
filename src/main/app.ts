import {
  app,
  clipboard,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  nativeImage,
  Menu,
  net,
  powerMonitor,
  protocol,
  session,
  shell,
  systemPreferences,
} from 'electron'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWindow, setWindowMode, setKeyboardCapture } from './windows'
import { installMenu } from './menu'
import { LocalStore } from './store'
import type { BootInfo, Preferences, NavigationTarget } from '../shared/desktop'
import type {
  ApiRead,
  ApiReply,
  AttachmentSource,
  ArtifactSource,
  WorkCommand,
  ComputerCommand,
} from '../shared/api'
import { Connections } from './connections'
import { ApiError } from './api/client'
import { NativeShell } from './native'
import { ClientNotifications } from './notifications'
import { heldComputers } from './computer-exit'

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
      if (!details.url.startsWith('app://desktop/')) {
        callback({ responseHeaders: details.responseHeaders })
        return
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-src 'self' blob:",
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
        if (['sync', 'conversation', 'work', 'character', 'work_steps', 'computer'].includes(kind))
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
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['ws://*/*', 'wss://*/*'] },
      (details, callback) => {
        const development =
          !app.isPackaged &&
          process.env.ELECTRON_RENDERER_URL &&
          details.url.startsWith(process.env.ELECTRON_RENDERER_URL.replace(/^http/, 'ws') + '/')
        callback({
          cancel:
            !development &&
            !(
              details.webContentsId === win?.webContents.id &&
              connections.computerTickets.consume(details.url)
            ),
        })
      },
    )
    const notifications = new ClientNotifications(store, connections, (notice) =>
      native.show(notice),
    )
    native.update(store.preferences())
    let quitAllowed = false,
      askingToQuit = false
    powerMonitor.on('shutdown', () => {
      quitAllowed = true
    })
    app.on('before-quit', (event) => {
      if (quitAllowed) return
      event.preventDefault()
      if (askingToQuit) return
      askingToQuit = true
      void (async () => {
        const held = await heldComputers(connections)
        if (!held.length) return true
        reveal?.()
        const options = {
          type: 'question' as const,
          title: '你正在控制角色的電腦',
          message: `${held.some((item) => item.offline) ? '你上次仍在控制' : '你正在控制'} ${held.map((item) => item.connection.name).join('、')} 的電腦`,
          detail: `${held.some((item) => item.offline) ? '目前無法連線確認；交回時會核對伺服器目前的控制權。' : ''}保持控制時，需要用電腦的步驟會一直等待交回；其他步驟照常進行。`,
          buttons: ['交回並結束', '保持控制並結束', '取消'],
          defaultId: 0,
          cancelId: 2,
        }
        const choice = win
          ? await dialog.showMessageBox(win, options)
          : await dialog.showMessageBox(options)
        if (choice.response === 2) return false
        if (choice.response === 1) return true
        for (const item of held) {
          const result = await connections.computerCommand(item.connection.characterId, {
            action: 'return',
            leaseId: item.leaseId,
            note: '使用者交回控制並結束 App。',
          })
          if (result.state !== 'result' || result.problem) {
            const failure = {
              type: 'warning' as const,
              message: '尚未確認交回，App 會保持開啟。',
              detail: '請確認目前控制權或查證原請求，再決定是否結束。',
            }
            if (win) await dialog.showMessageBox(win, failure)
            else await dialog.showMessageBox(failure)
            return false
          }
        }
        return true
      })()
        .then((allowed) => {
          askingToQuit = false
          if (allowed) {
            quitAllowed = true
            app.quit()
          }
        })
        .catch(() => {
          askingToQuit = false
        })
    })
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
    action('computer-ticket', (id: string) => connections.computerTicket(id))
    action('save-computer-file', async (id: string, path: string) => {
      const item = await connections.computerFile(id, path)
      const target = await dialog.showSaveDialog(win!, {
        defaultPath: item.filename ?? basename(path),
      })
      if (target.canceled || !target.filePath) return false
      await item.cache.save(item.path, item.sha256, target.filePath)
      return true
    })
    action('computer-command', (id: string, command: ComputerCommand) =>
      connections.computerCommand(id, command),
    )
    action('computer-commands', (id: string) => connections.computerCommands(id).list())
    action('verify-computer-command', (id: string, request: string) =>
      connections.verifyComputerCommand(id, request),
    )
    action('keyboard-capture', (captured: boolean) => setKeyboardCapture(win!, captured))
    action('save-screenshot', async (id: string, bytes: Uint8Array) => {
      const connection = connections.connection(id)
      const image = nativeImage.createFromBuffer(Buffer.from(bytes))
      if (image.isEmpty()) throw new ApiError('validation_error')
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: `${connection.name} 電腦截圖.png`,
        filters: [{ name: 'PNG 圖片', extensions: ['png'] }],
      })
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, image.toPNG())
      return true
    })
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
    action('artifact-content', (id: string, source: ArtifactSource) =>
      connections.artifactContent(id, source),
    )
    action('save-artifact', async (id: string, source: ArtifactSource) => {
      const content = await connections.artifact(id, source)
      const picked = await dialog.showSaveDialog(win!, {
        title: '存到…',
        defaultPath: basename(content.filename),
      })
      if (picked.canceled || !picked.filePath) return false
      const current = await connections.artifact(id, source)
      await current.cache.save(current.path, current.sha256, picked.filePath)
      connections.savedArtifact(id, source, picked.filePath)
      return true
    })
    action('reveal-artifact', async (id: string, source: ArtifactSource) => {
      const path = connections.savedArtifact(id, source)
      if (!path) throw new ApiError('local_file_missing')
      try {
        await stat(path)
      } catch {
        throw new ApiError('local_file_missing')
      }
      shell.showItemInFolder(path)
    })
    action('open-artifact', async (id: string, source: ArtifactSource) => {
      const content = await connections.artifact(id, source)
      const directory = join(content.cache.root, 'open', content.sha256, randomUUID())
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const path = join(directory, basename(content.filename))
      await content.cache.save(content.path, content.sha256, path)
      const error = await shell.openPath(path)
      if (error) throw new ApiError('open_failed')
    })
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
      created.on('close', (event) => {
        if (!quitAllowed && !store.preferences().keepInTray) {
          event.preventDefault()
          app.quit()
        }
      })
      created.on('session-end', () => {
        quitAllowed = true
      })
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
