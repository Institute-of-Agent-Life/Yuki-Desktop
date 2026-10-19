import { contextBridge, ipcRenderer } from 'electron'
import type { BootInfo, Command, DesktopBridge } from '../shared/desktop'

const bridge: DesktopBridge = {
  client: {
    reconnect: () => ipcRenderer.invoke('yuki:reconnect'),
    external: (url) => ipcRenderer.invoke('yuki:external', url),
    connections: () => ipcRenderer.invoke('yuki:connections'),
    meta: (server) => ipcRenderer.invoke('yuki:meta', server),
    pair: (server, code, label) => ipcRenderer.invoke('yuki:pair', server, code, label),
    read: (id, route) => ipcRenderer.invoke('yuki:read', id, route),
    send: (id, text) => ipcRenderer.invoke('yuki:send', id, text),
    outbox: (id) => ipcRenderer.invoke('yuki:outbox', id),
    verify: (id, requestId) => ipcRenderer.invoke('yuki:verify', id, requestId),
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
}
contextBridge.exposeInMainWorld('yuki', bridge)
