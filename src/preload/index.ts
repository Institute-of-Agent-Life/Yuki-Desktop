import { contextBridge, ipcRenderer } from 'electron'
import type { BootInfo, Command, DesktopBridge } from '../shared/desktop'

const bridge: DesktopBridge = {
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
