import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BootInfo, Command, DesktopBridge } from '../shared/desktop'

const bridge: DesktopBridge = {
  client: {
    issueLinkCode: (id) => ipcRenderer.invoke('yuki:issue-link-code', id),
    linkCodeRequests: (id) => ipcRenderer.invoke('yuki:link-code-requests', id),
    verifyLinkCode: (id, request) => ipcRenderer.invoke('yuki:verify-link-code', id, request),
    serverInfo: (id) => ipcRenderer.invoke('yuki:server-info', id),
    changeAddress: (id, server) => ipcRenderer.invoke('yuki:change-address', id, server),
    promptDocuments: (id) => ipcRenderer.invoke('yuki:prompt-documents', id),
    promptEdit: (id, edit) => ipcRenderer.invoke('yuki:prompt-edit', id, edit),
    promptDrafts: (id) => ipcRenderer.invoke('yuki:prompt-drafts', id),
    promptCommand: (id, command) => ipcRenderer.invoke('yuki:prompt-command', id, command),
    promptCommands: (id) => ipcRenderer.invoke('yuki:prompt-commands', id),
    verifyPromptCommand: (id, request) =>
      ipcRenderer.invoke('yuki:verify-prompt-command', id, request),
    letterDecoration: (id, revision, avatarRevision, bytes) =>
      ipcRenderer.invoke('yuki:letter-decoration', id, revision, avatarRevision, bytes),
    pickAvatar: () => ipcRenderer.invoke('yuki:pick-avatar'),
    dropAvatar: (file) => ipcRenderer.invoke('yuki:drop-avatar', webUtils.getPathForFile(file)),
    pasteAvatar: () => ipcRenderer.invoke('yuki:paste-avatar'),
    avatarBytes: (id, sha, size) => ipcRenderer.invoke('yuki:avatar-bytes', id, sha, size),
    previewAvatar: (server) => ipcRenderer.invoke('yuki:preview-avatar', server),
    avatarCommand: (id, revision, bytes) =>
      ipcRenderer.invoke('yuki:avatar-command', id, revision, bytes),
    avatarCommands: (id) => ipcRenderer.invoke('yuki:avatar-commands', id),
    avatarDraft: (id, request) => ipcRenderer.invoke('yuki:avatar-draft', id, request),
    acknowledgeAvatarCommand: (id, request) =>
      ipcRenderer.invoke('yuki:acknowledge-avatar-command', id, request),
    verifyAvatarCommand: (id, request) =>
      ipcRenderer.invoke('yuki:verify-avatar-command', id, request),
    characterCommand: (id, command) => ipcRenderer.invoke('yuki:character-command', id, command),
    characterCommands: (id) => ipcRenderer.invoke('yuki:character-commands', id),
    verifyCharacterCommand: (id, request) =>
      ipcRenderer.invoke('yuki:verify-character-command', id, request),
    computerTicket: (id) => ipcRenderer.invoke('yuki:computer-ticket', id),
    saveComputerFile: (id, path) => ipcRenderer.invoke('yuki:save-computer-file', id, path),
    computerCommand: (id, command) => ipcRenderer.invoke('yuki:computer-command', id, command),
    computerCommands: (id) => ipcRenderer.invoke('yuki:computer-commands', id),
    verifyComputerCommand: (id, request) =>
      ipcRenderer.invoke('yuki:verify-computer-command', id, request),
    keyboardCapture: (captured) => ipcRenderer.invoke('yuki:keyboard-capture', captured),
    saveScreenshot: (id, bytes) => ipcRenderer.invoke('yuki:save-screenshot', id, bytes),
    reconnect: () => ipcRenderer.invoke('yuki:reconnect'),
    external: (url) => ipcRenderer.invoke('yuki:external', url),
    copy: (text) => ipcRenderer.invoke('yuki:copy', text),
    paste: () => ipcRenderer.invoke('yuki:paste'),
    selected: (id) => ipcRenderer.invoke('yuki:selected', id),
    acknowledgeTarget: (target) => ipcRenderer.invoke('yuki:acknowledge-target', target),
    contextMenu: (options) => ipcRenderer.invoke('yuki:context-menu', options),
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
    saveArtifact: (id, source) => ipcRenderer.invoke('yuki:save-artifact', id, source),
    revealArtifact: (id, source) => ipcRenderer.invoke('yuki:reveal-artifact', id, source),
    openArtifact: (id, source) => ipcRenderer.invoke('yuki:open-artifact', id, source),
    outbox: (id) => ipcRenderer.invoke('yuki:outbox', id),
    verify: (id, requestId) => ipcRenderer.invoke('yuki:verify', id, requestId),
    workCommand: (id, command) => ipcRenderer.invoke('yuki:work-command', id, command),
    workCommands: (id) => ipcRenderer.invoke('yuki:work-commands', id),
    verifyWorkCommand: (id, request) => ipcRenderer.invoke('yuki:verify-work-command', id, request),
    workDraft: (id, work, text) => ipcRenderer.invoke('yuki:work-draft', id, work, text),
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
