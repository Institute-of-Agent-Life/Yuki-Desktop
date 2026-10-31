import electronUpdater from 'electron-updater'
import { AppUpdates } from './updates'
import { FeedOnlyUpdater } from './feed-updater'
import { DesktopReleaseProvider } from './release-provider'
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
import { heldComputers } from './computer-exit'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWindow, setWindowMode, setKeyboardCapture } from './windows'
import { applyWindowAppearance, platformMaterial } from './window-appearance'
import { installMenu } from './menu'
import { LocalStore } from './store'
import type { BootInfo, Preferences, NavigationTarget } from '../shared/desktop'
import type {
  ApiRead,
  ApiReply,
  CharacterCommand,
  AttachmentSource,
  ArtifactSource,
  WorkCommand,
  WorkDraftQuestion,
  ComputerCommand,
  Profile,
  SoulCommand,
  SoulEdit,
} from '../shared/api'
import type { ModelApplyInput, ModelTestInput, ModelDiscoverInput } from '../shared/models'
import { Connections } from './connections'
import { ApiError } from './api/client'
import { avatarInput } from './avatar-input'
import { NativeShell } from './native'
import { ClientNotifications } from './notifications'
import { LoginItem } from './login-item'
import { diagnostics } from './diagnostics'
import { AgentConnector } from './agent-connector'
import type {
  ConnectorPairing,
  ConnectorServiceAction,
  ConnectorConfiguration,
  ConnectorTarget,
  ConnectorOperation,
  ConnectorDriver,
  ConnectorTerminal,
  ConnectorTerminalControl,
} from '../shared/connector'
import type { components } from '../shared/contract.gen'
import { LocalBot } from './local-bot'
import type { LocalBotConfiguration } from '../shared/local-bot'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])
if (process.env.YUKI_DESKTOP_DATA) app.setPath('userData', process.env.YUKI_DESKTOP_DATA)
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
      if (url.hostname === 'desktop' && url.pathname.startsWith('/__media/'))
        return connections.previews.response(request)
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
    connections.onIdentity = (id, name) => native.characterName(id, name)
    const decorations = new Map<string, Promise<void>>()
    connections.onProfile = (id, profile) => {
      const key = native.prepareCharacter(id, profile),
        pendingKey = `${id}/${key}`
      if (!profile.avatar || native.hasDecoration(id, key) || decorations.has(pendingKey)) return
      const work = connections
        .avatarBytes(id, profile.avatar.sha256, 128)
        .then((bytes) => native.decorate(id, key, bytes))
        .catch(() => {})
        .finally(() => decorations.delete(pendingKey))
      decorations.set(pendingKey, work)
    }
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
    let installAfterQuit = false
    let closingResources = false
    let suspendedForUpdate: string[] = []
    const updates = new AppUpdates(
      {
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        appImage: process.env.APPIMAGE,
        channel: store.preferences().updateChannel,
      },
      () => {
        const sdk =
          process.platform === 'linux' && !process.env.APPIMAGE
            ? new FeedOnlyUpdater()
            : electronUpdater.autoUpdater
        sdk.setFeedURL({ provider: 'custom', updateProvider: DesktopReleaseProvider })
        return sdk
      },
      (state) => {
        if (win && !win.webContents.isDestroyed()) win.webContents.send('yuki:update', state)
        if (state.phase === 'error' && installAfterQuit && !closingResources) {
          installAfterQuit = false
          quitAllowed = false
          connections.resumeAfterUpdate(suspendedForUpdate)
          suspendedForUpdate = []
          reveal?.()
        }
      },
    )
    let leaveReady: number | undefined
    let leaving:
      { id: string; promise: Promise<boolean>; resolve(allowed: boolean): void } | undefined
    const askToLeave = () => {
      if (!win || win.webContents.isCrashed() || win.webContents.id !== leaveReady)
        return Promise.resolve(true)
      if (leaving) return leaving.promise
      const id = randomUUID()
      let resolve!: (allowed: boolean) => void
      const promise = new Promise<boolean>((done) => {
        resolve = done
      }).finally(() => {
        leaving = undefined
      })
      leaving = { id, promise, resolve }
      win.webContents.send('yuki:leave-request', id)
      return promise
    }
    ipcMain.handle('yuki:leave-ready', (event) => {
      authorize(event)
      leaveReady = event.sender.id
    })
    ipcMain.handle('yuki:leave-response', (event, id: string, allowed: boolean) => {
      authorize(event)
      if (leaving?.id === id && typeof allowed === 'boolean') leaving.resolve(allowed)
    })
    powerMonitor.on('shutdown', () => {
      quitAllowed = true
    })
    app.on('before-quit', (event) => {
      if (quitAllowed) return
      event.preventDefault()
      if (askingToQuit) return
      askingToQuit = true
      void (async () => {
        if (!(await askToLeave())) return false
        const held = await heldComputers(connections)
        if (!held.length) return true
        reveal?.()
        const options = {
          type: 'question' as const,
          title: '你正在控制 Yuki 的電腦',
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
        .then(async (allowed) => {
          if (!allowed) {
            installAfterQuit = false
            return
          }
          if (installAfterQuit) {
            updates.prepareInstall()
            const suspension = connections.suspendForUpdate()
            suspendedForUpdate = suspension.ids
            await suspension.settled
            quitAllowed = true
            updates.installNow()
          } else {
            quitAllowed = true
            app.quit()
          }
        })
        .catch(() => {
          updates.installFailed()
          installAfterQuit = false
          quitAllowed = false
          connections.resumeAfterUpdate(suspendedForUpdate)
          suspendedForUpdate = []
        })
        .finally(() => {
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
    action('update-state', () => updates.state())
    const resourceRoot = app.isPackaged
      ? process.resourcesPath
      : join(app.getAppPath(), 'resources')
    const connector = new AgentConnector({
      root: join(app.getPath('userData'), 'agent-connector'),
      bundledRuntime: app.isPackaged
        ? join(resourceRoot, 'agent-connector')
        : join(app.getAppPath(), '.cache', 'connector-runtime'),
      store,
      authorize: (id) => connections.authorizeConnector(id),
      admission: (id, device) => connections.connectorAdmission(id, device),
      verifyServer: (id, server, device) => connections.verifyConnectorServer(id, server, device),
    })
    action('connector-state', (id?: string) => connector.state(id))
    action('connector-install', (separate?: boolean) => connector.install(separate))
    action('connector-adopt', () => connector.adopt())
    action('connector-use-installation', (input: { executable: string; dataDirectory: string }) =>
      connector.useInstallation(input),
    )
    action('connector-connect', (input: { characterId: string; label: string }) =>
      connector.connect(input),
    )
    action('connector-pair', (input: ConnectorPairing) => connector.pair(input))
    action('connector-server', (input: { characterId: string; server: string }) =>
      connector.server(input),
    )
    action('connector-service', (command: ConnectorServiceAction) => connector.service(command))
    action('connector-full-access', async (enabled: boolean, id?: string) => {
      const state = await connector.fullAccess(enabled)
      if (id && state.available && state.deviceId) {
        try {
          await connections.agentRead(id, `devices/${encodeURIComponent(state.deviceId)}`)
        } catch (error) {
          return { ...state, catalogProblem: error instanceof ApiError ? error.code : 'unknown' }
        }
      }
      return state
    })
    action('connector-discover', (driver?: ConnectorDriver) => connector.discover(driver))
    action('connector-configure', (input: ConnectorConfiguration, start?: boolean) =>
      connector.configure(input, start),
    )
    action('connector-diagnose', (id: string) => connector.diagnose(id))
    action('connector-reveal-native', async (id: string) =>
      shell.showItemInFolder(await connector.nativeExecutable(id)),
    )
    const choosePath = async (directory: boolean) => {
      const options: Electron.OpenDialogOptions = {
        properties: directory ? ['openDirectory'] : ['openFile'],
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
    action('connector-choose-project', () => choosePath(true))
    action('connector-choose-executable', () => choosePath(false))
    action('connector-sessions', async (id: string, instance: string, cursor?: string) => {
      const page = await connections.agentRead<components['schemas']['NativeSessions']>(
        id,
        `instances/${encodeURIComponent(instance)}/sessions${cursor ? '?' + new URLSearchParams({ cursor }) : ''}`,
      )
      if (page.error) throw new ApiError(page.error)
      return { sessions: page.sessions ?? [], next_cursor: page.next_cursor }
    })
    const operationView = (item: components['schemas']['NativeOperation']): ConnectorOperation => ({
      id: item.operation_id,
      instance_id: item.instance_id,
      work_id: item.work_id ?? undefined,
      session_id: item.session_id ?? undefined,
      execution_id: item.execution_id ?? undefined,
      status: item.status ?? 'unknown',
      action: item.action ?? undefined,
      events: item.events ?? [],
      admitted: item.admitted ?? undefined,
      pending: item.pending ?? undefined,
      uncertain: item.uncertain ?? undefined,
      next_cursor: item.next_cursor ?? undefined,
      result: item,
    })
    action(
      'connector-operations',
      async (id: string, work?: string, cursor?: string, device?: string) => {
        const params = new URLSearchParams({
          ...(work ? { work_id: work } : {}),
          ...(cursor ? { cursor } : {}),
          ...(device ? { device_id: device } : {}),
        })
        const page = await connections.agentRead<components['schemas']['NativeOperations']>(
          id,
          `operations${params.size ? '?' + params : ''}`,
        )
        return { operations: page.items.map(operationView), next_cursor: page.next_cursor }
      },
    )
    action('connector-operation', async (id: string, operation: string, cursor?: number) =>
      operationView(
        await connections.agentRead<components['schemas']['NativeOperation']>(
          id,
          `operations/${encodeURIComponent(operation)}${cursor === undefined ? '' : '?' + new URLSearchParams({ cursor: String(cursor) })}`,
        ),
      ),
    )
    action('connector-terminals', async (id: string, device: string, cursor?: string) => {
      const params = new URLSearchParams({ device_id: device, ...(cursor ? { cursor } : {}) })
      const page = await connections.agentRead<{
        items: ConnectorTerminal[]
        next_cursor?: string | null
      }>(id, `terminals?${params}`)
      return { terminals: page.items, next_cursor: page.next_cursor }
    })
    action('connector-terminal', (id: string, run: string, cursor?: number) =>
      connections.agentRead<ConnectorTerminal>(
        id,
        `terminals/${encodeURIComponent(run)}${cursor === undefined ? '' : '?' + new URLSearchParams({ cursor: String(cursor) })}`,
      ),
    )
    action(
      'connector-terminal-control',
      (id: string, run: string, request: string, action: 'cancel') =>
        connections.agentRequest<ConnectorTerminalControl>(
          id,
          `terminals/${encodeURIComponent(run)}/control`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request_id: request, action }),
          },
        ),
    )
    action('connector-terminal-control-read', (id: string, run: string, request: string) =>
      connections.agentRead<ConnectorTerminalControl>(
        id,
        `terminals/${encodeURIComponent(run)}/controls/${encodeURIComponent(request)}`,
      ),
    )
    action(
      'connector-submit',
      async (id: string, input: { text: string; agentTarget: ConnectorTarget }) => {
        const result = await connections.send(id, input.text, [], input.agentTarget)
        return {
          requestId: result.requestId,
          state: result.state,
          eventId: result.eventId,
          problem: result.problem,
        }
      },
    )
    const localBot = new LocalBot({
      resources: join(resourceRoot, 'local-bot'),
      store,
      connections,
      progress: (message) => win?.webContents.send('yuki:local-bot-progress', message),
    })
    action('local-bot-state', () => localBot.state())
    action('local-bot-presets', () => localBot.presets())
    action('local-bot-directory', () => choosePath(true))
    action('local-bot-deploy', (input: LocalBotConfiguration) => localBot.deploy(input))
    action('local-bot-start', () => localBot.start())
    action('local-bot-stop', () => localBot.stop())
    action('local-bot-connect', () => localBot.connect())
    action('update-check', () => updates.check())
    action('update-download', () => updates.download())
    action('update-cancel', () => updates.cancel())
    action('update-install', () => {
      if (!updates.canInstall()) throw new ApiError('update_not_downloaded')
      if (askingToQuit || installAfterQuit) return false
      installAfterQuit = true
      app.quit()
      return true
    })
    const clientAction = <A extends unknown[], T>(
      name: string,
      run: (id: string, ...args: A) => T | Promise<T>,
    ) => action(name, (id: string, ...args: A) => connections.activity(id, () => run(id, ...args)))
    action('connections', () => connections.publicList())
    action('pending-pairings', () => connections.pendingPairings())
    action('resume-pairing', (id: string, device: string) => connections.resumePairing(id, device))
    action('forget-pairing', (id: string, device: string) => connections.forgetPairing(id, device))
    action('prepare-logout', async (id: string) => {
      try {
        return await connections.prepareLogout(id, () => notifications.pause(id))
      } catch (error) {
        notifications.resume(id)
        throw error
      }
    })
    action('logout-summary', (id: string) => connections.logoutSummary(id))
    clientAction('retired-history', (id: string) => connections.retiredHistory(id))
    clientAction('export-retired-history', async (id: string) => {
      const result = await dialog.showSaveDialog(win!, {
        title: '匯出舊版操作記錄',
        defaultPath: 'Yuki-retired-history.json',
        filters: [{ name: '舊版操作記錄', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, connections.exportRetiredHistory(id), {
        encoding: 'utf8',
        mode: 0o600,
      })
      return true
    })
    action('finish-logout', async (id: string, deviceId: string, choice: 'keep' | 'delete') => {
      await connections.finishLogout(id, deviceId, choice)
      native.forget(id)
      if (openTarget?.characterId === id) openTarget = null
    })

    clientAction('issue-link-code', (id: string) => connections.issueLinkCode(id))
    clientAction('link-code-requests', (id: string) => connections.linkCodes(id).list())
    clientAction('verify-link-code', (id: string, request: string) =>
      connections.verifyLinkCode(id, request),
    )
    clientAction('server-info', (id: string) => connections.serverInfo(id))
    clientAction('change-address', (id: string, server: string) =>
      connections.changeAddress(id, server),
    )
    action('export-diagnostics', async () => {
      const result = await dialog.showSaveDialog(win!, {
        title: '匯出診斷記錄',
        defaultPath: `Yuki-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        filters: [{ name: '診斷記錄', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return false
      const summary = diagnostics(
        store.preferences(),
        {
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
        },
        connections.diagnosticCounts(),
      )
      await writeFile(result.filePath, JSON.stringify(summary, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
      })
      return true
    })
    const loginItem = new LoginItem({
      platform: process.platform as BootInfo['platform'],
      packaged: app.isPackaged,
      executable: process.env.APPIMAGE || process.execPath,
      configHome: app.getPath('appData'),
      systemConfigDirectories: (process.env.XDG_CONFIG_DIRS || '/etc/xdg')
        .split(':')
        .filter((root) => root.startsWith('/')),
      get: () => app.getLoginItemSettings(),
      set: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled }),
    })
    action('login-item', (enabled?: boolean) =>
      enabled === undefined ? loginItem.read() : loginItem.set(enabled),
    )
    action('copy', (text: string) => clipboard.writeText(text))
    action('paste', () => clipboard.readText())
    action('application-menu', (position: { x: number; y: number }) => {
      const target = win,
        menu = Menu.getApplicationMenu()
      if (!target || target.isDestroyed() || !menu) return false
      const bounds = target.getContentBounds(),
        zoom = target.webContents.getZoomFactor()
      if (
        !position ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        position.x < 0 ||
        position.y < 0 ||
        position.x * zoom > bounds.width ||
        position.y * zoom > bounds.height
      )
        throw new ApiError('validation_error')
      return new Promise<boolean>((resolve) => {
        menu.popup({
          window: target,
          x: Math.round(position.x * zoom),
          y: Math.round(position.y * zoom),
          callback: () => resolve(true),
        })
      })
    })
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
      const previous = store.get<string>('selectedCharacterId')
      if (previous && previous !== id) connections.previews.close(previous)
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
      notifications.resume(result.characterId)
      pairLink = null
      return result
    })
    clientAction('read', (id: string, route: ApiRead) => connections.read(id, route))
    clientAction('models-read', (id: string) => connections.modelBundle(id))
    clientAction('models-apply', (id: string, input: ModelApplyInput) =>
      connections.applyModels(id, input),
    )
    clientAction('models-test', (id: string, input: ModelTestInput) =>
      connections.testModel(id, input),
    )
    clientAction('models-discover', (id: string, input: ModelDiscoverInput) =>
      connections.discoverModels(id, input),
    )
    clientAction('models-stats', (id: string) => connections.modelStats(id))
    clientAction('soul-document', (id: string) => connections.soulDocument(id))
    clientAction('soul-edit', (id: string, edit: SoulEdit) => connections.soulEdit(id, edit))
    clientAction('soul-draft', (id: string) => connections.soul(id).draft())
    clientAction('soul-command', (id: string, command: SoulCommand) =>
      connections.soulCommand(id, command),
    )
    clientAction('soul-commands', (id: string) => connections.soul(id).list())
    clientAction('verify-soul-command', (id: string, request: string) =>
      connections.verifySoulCommand(id, request),
    )
    clientAction(
      'letter-decoration',
      (id: string, revision: number, avatarRevision: number, bytes: Uint8Array) => {
        const profile = connections.box(id).cached<Profile>('character')
        if (
          !(bytes instanceof Uint8Array) ||
          bytes.byteLength < 24 ||
          Buffer.from(bytes.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a' ||
          Buffer.from(bytes).readUInt32BE(16) !== 128 ||
          Buffer.from(bytes).readUInt32BE(20) !== 128
        )
          throw new ApiError('validation_error')
        if (
          profile &&
          !profile.avatar &&
          profile.revision === revision &&
          profile.avatar_revision === avatarRevision
        )
          native.decorate(id, native.prepareCharacter(id, profile), bytes)
      },
    )
    clientAction('avatar-bytes', (id: string, sha: string, size: number) =>
      connections.avatarBytes(id, sha, size),
    )
    action('preview-avatar', (server: string) => connections.previewAvatar(server))
    action('pick-avatar', async () => {
      const picked = await dialog.showOpenDialog(win!, {
        title: '選擇頭像圖片',
        properties: ['openFile'],
        filters: [
          {
            name: '圖片',
            extensions: [
              'png',
              'jpg',
              'jpeg',
              'webp',
              ...(process.platform === 'darwin' ? ['heic', 'heif'] : []),
            ],
          },
        ],
      })
      return picked.canceled || !picked.filePaths[0] ? null : avatarInput(picked.filePaths[0])
    })
    action('drop-avatar', (path: string) => avatarInput(path))
    action('paste-avatar', () => {
      const image = clipboard.readImage()
      if (image.isEmpty()) throw new ApiError('unsupported_image')
      return { filename: '剪貼簿圖片.png', bytes: new Uint8Array(image.toPNG()) }
    })
    clientAction('avatar-command', (id: string, revision: number, bytes?: Uint8Array) =>
      connections.avatarCommand(id, revision, bytes),
    )
    clientAction('avatar-draft', (id: string, request: string) =>
      connections.characterCommands(id).avatarDraft(request),
    )
    clientAction('character-command', (id: string, command: CharacterCommand) =>
      connections.characterCommand(id, command),
    )
    clientAction('character-commands', (id: string) => connections.characterCommands(id).list())
    clientAction('verify-character-command', (id: string, request: string) =>
      connections.verifyCharacterCommand(id, request),
    )
    clientAction('computer-ticket', (id: string) => connections.computerTicket(id))
    clientAction('save-computer-file', async (id: string, path: string) => {
      const item = await connections.computerFile(id, path)
      const target = await dialog.showSaveDialog(win!, {
        defaultPath: item.filename ?? basename(path),
      })
      if (target.canceled || !target.filePath) return false
      await item.cache.save(item.path, item.sha256, target.filePath)
      return true
    })
    clientAction('computer-command', (id: string, command: ComputerCommand) =>
      connections.computerCommand(id, command),
    )
    clientAction('computer-commands', (id: string) => connections.computerCommands(id).list())
    clientAction('verify-computer-command', (id: string, request: string) =>
      connections.verifyComputerCommand(id, request),
    )
    action('keyboard-capture', (captured: boolean) => setKeyboardCapture(win!, captured))
    clientAction('save-screenshot', async (id: string, bytes: Uint8Array) => {
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
    clientAction('send', (id: string, text: string, uploads?: string[]) =>
      connections.send(id, text, uploads),
    )
    clientAction('uploads', (id: string) => connections.uploads(id).list())
    clientAction('work-command', (id: string, command: WorkCommand, question?: WorkDraftQuestion) =>
      connections.workCommand(id, command, question),
    )
    clientAction('work-commands', (id: string) => connections.commands(id).list())
    clientAction('work-question-drafts', (id: string, work: string) =>
      connections.commands(id).questionDrafts(work),
    )
    clientAction('verify-work-command', (id: string, request: string) =>
      connections.verifyWorkCommand(id, request),
    )
    clientAction(
      'work-draft',
      (id: string, work: string, text?: string, question?: WorkDraftQuestion) =>
        connections.commands(id).draft(work, text, question),
    )
    clientAction('attach', async (id: string) => {
      const picked = await dialog.showOpenDialog(win!, {
        title: '附加檔案',
        properties: ['openFile', 'multiSelections'],
      })
      return picked.canceled
        ? connections.uploads(id).list()
        : connections.stage(id, picked.filePaths)
    })
    clientAction('drop', (id: string, paths: string[]) => connections.stage(id, paths))
    clientAction('record', (id: string, bytes: Uint8Array) => connections.record(id, bytes))
    clientAction('retry-upload', (id: string, request: string) =>
      connections.retryUpload(id, request),
    )
    clientAction('remove-upload', (id: string, request: string) => {
      connections.uploads(id).remove(request)
    })
    clientAction('content', (id: string, source: AttachmentSource) =>
      connections.content(id, source),
    )
    clientAction('artifact-content', (id: string, source: ArtifactSource) =>
      connections.artifactContent(id, source),
    )
    clientAction('release-preview', (id: string, previewId: string) =>
      connections.previews.release(id, previewId),
    )
    clientAction('save-artifact', async (id: string, source: ArtifactSource) => {
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
    clientAction('reveal-artifact', async (id: string, source: ArtifactSource) => {
      const path = connections.savedArtifact(id, source)
      if (!path) throw new ApiError('local_file_missing')
      try {
        await stat(path)
      } catch {
        throw new ApiError('local_file_missing')
      }
      shell.showItemInFolder(path)
    })
    const materializeArtifact = async (id: string, source: ArtifactSource) => {
      const content = await connections.artifact(id, source)
      const directory = join(content.cache.exportRoot, content.sha256)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const path = join(directory, basename(content.filename))
      await content.cache.save(content.path, content.sha256, path)
      return path
    }
    clientAction('open-artifact', async (id: string, source: ArtifactSource) => {
      const error = await shell.openPath(await materializeArtifact(id, source))
      if (error) throw new ApiError('open_failed')
    })
    clientAction('drag-artifact', async (id: string, source: ArtifactSource) => {
      const target = win!
      const path = await materializeArtifact(id, source)
      const icon = await app.getFileIcon(path, { size: 'normal' })
      target.webContents.startDrag({ file: path, icon })
    })
    clientAction('save-content', async (id: string, source: AttachmentSource) => {
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
    clientAction('outbox', (id: string) => connections.box(id).list())
    clientAction('verify', (id: string, requestId: string) => connections.verify(id, requestId))
    clientAction('draft', (id: string, text?: string) => connections.box(id).draft(text))
    for (const connection of connections.list()) {
      native.characterName(connection.characterId, connection.name)
      connections.start(connection.characterId)
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
        nativeMaterial: platformMaterial(),
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
      if (patch.timeZone === 'Asia/Taipei' || patch.timeZone === 'system')
        current.timeZone = patch.timeZone
      if (
        (patch.updateChannel === 'stable' || patch.updateChannel === 'beta') &&
        !['preparing', 'installing'].includes(updates.state().phase)
      ) {
        current.updateChannel = patch.updateChannel
        void updates.channel(current.updateChannel).catch(() => {})
      }
      if (patch.sendKey === 'enter' || patch.sendKey === 'command-enter')
        current.sendKey = patch.sendKey
      if (typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth))
        current.sidebarWidth = Math.max(220, Math.min(320, patch.sidebarWidth))
      if (typeof patch.inspectorWidth === 'number' && Number.isFinite(patch.inspectorWidth))
        current.inspectorWidth = Math.max(320, Math.min(560, patch.inspectorWidth))
      store.set('appearance', current)
      native.update(current)
      nativeTheme.themeSource = current.theme
      if (win) applyWindowAppearance(win, current)
      return current
    })
    nativeTheme.on('updated', () => win?.webContents.send('yuki:theme', appearance()))
    const openWindow = () => {
      const created = createWindow(
        store,
        !connections.publicList().some((connection) => !connection.needsPairing),
      )
      win = created
      let closeAllowed = false
      created.on('close', (event) => {
        if (quitAllowed || closeAllowed) return
        if (!store.preferences().keepInTray) {
          event.preventDefault()
          app.quit()
        } else {
          event.preventDefault()
          void askToLeave().then((allowed) => {
            if (allowed && !created.isDestroyed()) {
              closeAllowed = true
              created.close()
            }
          })
        }
      })
      created.webContents.on('render-process-gone', () => {
        leaveReady = undefined
        leaving?.resolve(true)
      })
      created.on('session-end', () => {
        quitAllowed = true
      })
      created.once('closed', () => {
        leaving?.resolve(false)
        leaveReady = undefined
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
    let resourcesClosed = false
    let closing: Promise<void> | undefined
    app.on('will-quit', (event) => {
      if (resourcesClosed) return
      event.preventDefault()
      if (closing) return
      closingResources = true
      closing = notifications
        .close()
        .then(() => connections.close())
        .then(() => {
          native.close()
          if (store.db.open) store.db.close()
          resourcesClosed = true
          // Electron must finish cancelling this will-quit before a new quit request.
          setImmediate(() => app.quit())
        })
        .catch(() => {
          closing = undefined
          void dialog.showMessageBox({
            type: 'error',
            message: '本機資料尚未完成關閉，請重新嘗試結束 App。',
          })
        })
    })
  })
}
