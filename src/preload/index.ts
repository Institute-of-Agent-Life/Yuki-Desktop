import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BootInfo, Command, DesktopBridge } from '../shared/desktop'
import type { ConnectorDriver } from '../shared/connector'

const bridge: DesktopBridge = {
  connector: {
    state: (id) => ipcRenderer.invoke('yuki:connector-state', id),
    install: (separate) => ipcRenderer.invoke('yuki:connector-install', separate),
    adopt: () => ipcRenderer.invoke('yuki:connector-adopt'),
    useInstallation: (input) => ipcRenderer.invoke('yuki:connector-use-installation', input),
    connect: (input) => ipcRenderer.invoke('yuki:connector-connect', input),
    pair: (input) => ipcRenderer.invoke('yuki:connector-pair', input),
    server: (input) => ipcRenderer.invoke('yuki:connector-server', input),
    service: (action) => ipcRenderer.invoke('yuki:connector-service', action),
    fullAccess: (enabled, id) => ipcRenderer.invoke('yuki:connector-full-access', enabled, id),
    discover: (driver?: ConnectorDriver) => ipcRenderer.invoke('yuki:connector-discover', driver),
    configure: (input, start) => ipcRenderer.invoke('yuki:connector-configure', input, start),
    diagnose: (id) => ipcRenderer.invoke('yuki:connector-diagnose', id),
    revealNative: (id) => ipcRenderer.invoke('yuki:connector-reveal-native', id),
    chooseProject: () => ipcRenderer.invoke('yuki:connector-choose-project'),
    chooseExecutable: () => ipcRenderer.invoke('yuki:connector-choose-executable'),
    sessions: (id, instance, cursor) =>
      ipcRenderer.invoke('yuki:connector-sessions', id, instance, cursor),
    operations: (id, work, cursor, device) =>
      ipcRenderer.invoke('yuki:connector-operations', id, work, cursor, device),
    operation: (id, operation, cursor) =>
      ipcRenderer.invoke('yuki:connector-operation', id, operation, cursor),
    terminals: (id, device, cursor) =>
      ipcRenderer.invoke('yuki:connector-terminals', id, device, cursor),
    terminal: (id, run, cursor) => ipcRenderer.invoke('yuki:connector-terminal', id, run, cursor),
    controlTerminal: (id, run, request, action) =>
      ipcRenderer.invoke('yuki:connector-terminal-control', id, run, request, action),
    terminalControl: (id, run, request) =>
      ipcRenderer.invoke('yuki:connector-terminal-control-read', id, run, request),
    submit: (id, input) => ipcRenderer.invoke('yuki:connector-submit', id, input),
  },
  localBot: {
    state: () => ipcRenderer.invoke('yuki:local-bot-state'),
    chooseDirectory: () => ipcRenderer.invoke('yuki:local-bot-directory'),
    deploy: (input) => ipcRenderer.invoke('yuki:local-bot-deploy', input),
    start: () => ipcRenderer.invoke('yuki:local-bot-start'),
    stop: () => ipcRenderer.invoke('yuki:local-bot-stop'),
    connect: () => ipcRenderer.invoke('yuki:local-bot-connect'),
    onProgress(callback) {
      const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message)
      ipcRenderer.on('yuki:local-bot-progress', listener)
      return () => ipcRenderer.removeListener('yuki:local-bot-progress', listener)
    },
  },
  client: {
    pendingPairings: () => ipcRenderer.invoke('yuki:pending-pairings'),
    resumePairing: (id, device) => ipcRenderer.invoke('yuki:resume-pairing', id, device),
    forgetPairing: (id, device) => ipcRenderer.invoke('yuki:forget-pairing', id, device),
    prepareLogout: (id) => ipcRenderer.invoke('yuki:prepare-logout', id),
    logoutSummary: (id) => ipcRenderer.invoke('yuki:logout-summary', id),
    retiredHistory: (id) => ipcRenderer.invoke('yuki:retired-history', id),
    exportRetiredHistory: (id) => ipcRenderer.invoke('yuki:export-retired-history', id),
    finishLogout: (id, device, choice) =>
      ipcRenderer.invoke('yuki:finish-logout', id, device, choice),
    issueLinkCode: (id) => ipcRenderer.invoke('yuki:issue-link-code', id),
    linkCodeRequests: (id) => ipcRenderer.invoke('yuki:link-code-requests', id),
    verifyLinkCode: (id, request) => ipcRenderer.invoke('yuki:verify-link-code', id, request),
    serverInfo: (id) => ipcRenderer.invoke('yuki:server-info', id),
    changeAddress: (id, server) => ipcRenderer.invoke('yuki:change-address', id, server),
    soulDocument: (id) => ipcRenderer.invoke('yuki:soul-document', id),
    soulEdit: (id, edit) => ipcRenderer.invoke('yuki:soul-edit', id, edit),
    soulDraft: (id) => ipcRenderer.invoke('yuki:soul-draft', id),
    soulCommand: (id, command) => ipcRenderer.invoke('yuki:soul-command', id, command),
    soulCommands: (id) => ipcRenderer.invoke('yuki:soul-commands', id),
    verifySoulCommand: (id, request) => ipcRenderer.invoke('yuki:verify-soul-command', id, request),
    letterDecoration: (id, revision, avatarRevision, bytes) =>
      ipcRenderer.invoke('yuki:letter-decoration', id, revision, avatarRevision, bytes),
    avatarBytes: (id, sha, size) => ipcRenderer.invoke('yuki:avatar-bytes', id, sha, size),
    previewAvatar: (server) => ipcRenderer.invoke('yuki:preview-avatar', server),
    pickAvatar: () => ipcRenderer.invoke('yuki:pick-avatar'),
    dropAvatar: (file) => ipcRenderer.invoke('yuki:drop-avatar', webUtils.getPathForFile(file)),
    pasteAvatar: () => ipcRenderer.invoke('yuki:paste-avatar'),
    avatarCommand: (id, revision, bytes) =>
      ipcRenderer.invoke('yuki:avatar-command', id, revision, bytes),
    avatarDraft: (id, request) => ipcRenderer.invoke('yuki:avatar-draft', id, request),
    characterCommand: (id, command) => ipcRenderer.invoke('yuki:character-command', id, command),
    characterCommands: (id) => ipcRenderer.invoke('yuki:character-commands', id),
    verifyCharacterCommand: (id, request) =>
      ipcRenderer.invoke('yuki:verify-character-command', id, request),
    reconnect: () => ipcRenderer.invoke('yuki:reconnect'),
    external: (url) => ipcRenderer.invoke('yuki:external', url),
    copy: (text) => ipcRenderer.invoke('yuki:copy', text),
    paste: () => ipcRenderer.invoke('yuki:paste'),
    selected: (id) => ipcRenderer.invoke('yuki:selected', id),
    acknowledgeTarget: (target) => ipcRenderer.invoke('yuki:acknowledge-target', target),
    contextMenu: (options) => ipcRenderer.invoke('yuki:context-menu', options),
    computerTicket: (id) => ipcRenderer.invoke('yuki:computer-ticket', id),
    saveComputerFile: (id, path) => ipcRenderer.invoke('yuki:save-computer-file', id, path),
    computerCommand: (id, command) => ipcRenderer.invoke('yuki:computer-command', id, command),
    computerCommands: (id) => ipcRenderer.invoke('yuki:computer-commands', id),
    verifyComputerCommand: (id, request) =>
      ipcRenderer.invoke('yuki:verify-computer-command', id, request),
    keyboardCapture: (captured) => ipcRenderer.invoke('yuki:keyboard-capture', captured),
    saveScreenshot: (id, bytes) => ipcRenderer.invoke('yuki:save-screenshot', id, bytes),
    connections: () => ipcRenderer.invoke('yuki:connections'),
    meta: (server) => ipcRenderer.invoke('yuki:meta', server),
    pair: (server, code, label) => ipcRenderer.invoke('yuki:pair', server, code, label),
    read: (id, route) => ipcRenderer.invoke('yuki:read', id, route),
    send: (id, text, uploads) => ipcRenderer.invoke('yuki:send', id, text, uploads),
    uploads: (id) => ipcRenderer.invoke('yuki:uploads', id),
    attach: (id) => ipcRenderer.invoke('yuki:attach', id),
    drop: (id, files) =>
      ipcRenderer.invoke(
        'yuki:drop',
        id,
        files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
      ),
    record: (id, bytes) => ipcRenderer.invoke('yuki:record', id, bytes),
    microphone: () => ipcRenderer.invoke('yuki:microphone'),
    retryUpload: (id, request) => ipcRenderer.invoke('yuki:retry-upload', id, request),
    removeUpload: (id, request) => ipcRenderer.invoke('yuki:remove-upload', id, request),
    content: (id, source) => ipcRenderer.invoke('yuki:content', id, source),
    saveContent: (id, source) => ipcRenderer.invoke('yuki:save-content', id, source),
    artifactContent: (id, source) => ipcRenderer.invoke('yuki:artifact-content', id, source),
    releasePreview: (id, previewId) => ipcRenderer.invoke('yuki:release-preview', id, previewId),
    saveArtifact: (id, source) => ipcRenderer.invoke('yuki:save-artifact', id, source),
    revealArtifact: (id, source) => ipcRenderer.invoke('yuki:reveal-artifact', id, source),
    openArtifact: (id, source) => ipcRenderer.invoke('yuki:open-artifact', id, source),
    dragArtifact: (id, source) => ipcRenderer.invoke('yuki:drag-artifact', id, source),
    outbox: (id) => ipcRenderer.invoke('yuki:outbox', id),
    verify: (id, requestId) => ipcRenderer.invoke('yuki:verify', id, requestId),
    workCommand: (id, command, question) =>
      ipcRenderer.invoke('yuki:work-command', id, command, question),
    workCommands: (id) => ipcRenderer.invoke('yuki:work-commands', id),
    workQuestionDrafts: (id, work) => ipcRenderer.invoke('yuki:work-question-drafts', id, work),
    verifyWorkCommand: (id, request) => ipcRenderer.invoke('yuki:verify-work-command', id, request),
    workDraft: (id, work, text, question) =>
      ipcRenderer.invoke('yuki:work-draft', id, work, text, question),
    draft: (id, text) => ipcRenderer.invoke('yuki:draft', id, text),
    onHint(callback) {
      const listener = (
        _event: Electron.IpcRendererEvent,
        id: string,
        kind: string,
        data: unknown,
      ) => callback(id, kind, data)
      ipcRenderer.on('yuki:hint', listener)
      void ipcRenderer.invoke('yuki:subscribe')
      return () => ipcRenderer.removeListener('yuki:hint', listener)
    },
  },
  updates: {
    state: () => ipcRenderer.invoke('yuki:update-state'),
    check: () => ipcRenderer.invoke('yuki:update-check'),
    download: () => ipcRenderer.invoke('yuki:update-download'),
    cancel: () => ipcRenderer.invoke('yuki:update-cancel'),
    install: () => ipcRenderer.invoke('yuki:update-install'),
    onChange(callback) {
      const listener = (
        _event: Electron.IpcRendererEvent,
        state: import('../shared/updates').UpdateState,
      ) => callback(state)
      ipcRenderer.on('yuki:update', listener)
      return () => ipcRenderer.removeListener('yuki:update', listener)
    },
  },
  boot: () => ipcRenderer.invoke('yuki:boot'),
  onLeaveRequest(callback) {
    const listener = (_event: Electron.IpcRendererEvent, request: string) => callback(request)
    ipcRenderer.on('yuki:leave-request', listener)
    void ipcRenderer.invoke('yuki:leave-ready').catch(() => {})
    return () => ipcRenderer.removeListener('yuki:leave-request', listener)
  },
  leaveResponse: (request, allowed) => {
    void ipcRenderer.invoke('yuki:leave-response', request, allowed).catch(() => {})
  },
  applicationMenu: (position) => ipcRenderer.invoke('yuki:application-menu', position),
  preferences: (patch) => ipcRenderer.invoke('yuki:preferences', patch),
  loginItem: (enabled) => ipcRenderer.invoke('yuki:login-item', enabled),
  exportDiagnostics: () => ipcRenderer.invoke('yuki:export-diagnostics'),
  onCommand(callback) {
    const listener = (_event: Electron.IpcRendererEvent, command: Command) => callback(command)
    ipcRenderer.on('yuki:command', listener)
    return () => ipcRenderer.removeListener('yuki:command', listener)
  },
  onTheme(callback) {
    const listener = (
      _event: Electron.IpcRendererEvent,
      theme: Pick<BootInfo, 'dark' | 'reducedTransparency' | 'highContrast'>,
    ) => callback(theme)
    ipcRenderer.on('yuki:theme', listener)
    return () => ipcRenderer.removeListener('yuki:theme', listener)
  },
  onPairLink(callback) {
    const listener = (_event: Electron.IpcRendererEvent, link: string) => callback(link)
    ipcRenderer.on('yuki:pair-link', listener)
    return () => ipcRenderer.removeListener('yuki:pair-link', listener)
  },
  onOpenTarget(callback) {
    let active = true
    const listener = (
      _event: Electron.IpcRendererEvent,
      target: import('../shared/desktop').NavigationTarget,
    ) => callback(target)
    ipcRenderer.on('yuki:open-target', listener)
    void ipcRenderer.invoke('yuki:open-target').then((result) => {
      if (active && result.ok && result.value) callback(result.value)
    })
    return () => {
      active = false
      ipcRenderer.removeListener('yuki:open-target', listener)
    }
  },
}
contextBridge.exposeInMainWorld('yuki', bridge)
