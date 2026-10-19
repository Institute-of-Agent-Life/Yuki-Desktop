import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BootInfo, Command, DesktopBridge } from '../shared/desktop'

const bridge: DesktopBridge = {
  client: {
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
  preferences: (patch) => ipcRenderer.invoke('yuki:preferences', patch),
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
