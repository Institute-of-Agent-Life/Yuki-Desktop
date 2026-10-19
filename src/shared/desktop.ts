import type { ConversationBridge } from './api'

export type Theme = 'system' | 'light' | 'dark'
export type View = 'chat' | 'works' | 'computer' | 'files' | 'about' | 'settings'
export type Command =
  | View
  | 'focus-composer'
  | 'search'
  | 'find'
  | 'sidebar'
  | 'inspector'
  | 'focus-mode'
  | 'back'
  | 'forward'

export interface Preferences {
  theme: Theme
  opaque: boolean
  reducedMotion: boolean
  highContrast: boolean
  sidebarWidth: number
  inspectorWidth: number
}

export const defaultPreferences: Preferences = {
  theme: 'system',
  opaque: false,
  reducedMotion: false,
  highContrast: false,
  sidebarWidth: 260,
  inspectorWidth: 380,
}

export interface BootInfo {
  platform: 'darwin' | 'win32' | 'linux'
  version: string
  deviceLabel: string
  dark: boolean
  reducedTransparency: boolean
  highContrast: boolean
  preferences: Preferences
  pairLink: string | null
}

export interface DesktopBridge {
  client: ConversationBridge
  boot(): Promise<BootInfo>
  preferences(patch: Partial<Preferences>): Promise<Preferences>
  onCommand(callback: (command: Command) => void): () => void
  onTheme(
    callback: (theme: Pick<BootInfo, 'dark' | 'reducedTransparency' | 'highContrast'>) => void,
  ): () => void
  onPairLink(callback: (link: string) => void): () => void
}

declare global {
  interface Window {
    yuki: DesktopBridge
  }
}
