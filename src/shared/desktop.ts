import type { ConversationBridge } from './api'

export type Theme = 'system' | 'light' | 'dark'
export type DisplayTimeZone = 'Asia/Taipei' | 'system'
export interface LoginItemState {
  enabled: boolean
  available: boolean
  reason: 'install-required' | 'system-approval-required' | null
}
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
  timeZone: DisplayTimeZone
  opaque: boolean
  reducedMotion: boolean
  highContrast: boolean
  sidebarWidth: number
  inspectorWidth: number
  keepInTray: boolean
  sendKey: 'enter' | 'command-enter'
  notifyProactive: boolean
  notifyWaiting: boolean
  notifyCompleted: boolean
  notifyHelp: boolean
}

export const defaultPreferences: Preferences = {
  theme: 'system',
  timeZone: 'Asia/Taipei',
  opaque: false,
  reducedMotion: false,
  highContrast: false,
  sidebarWidth: 260,
  inspectorWidth: 380,
  keepInTray: true,
  sendKey: 'enter',
  notifyProactive: true,
  notifyWaiting: true,
  notifyCompleted: true,
  notifyHelp: true,
}
export interface NavigationTarget {
  characterId: string
  view: View
  conversationId?: string
  workId?: string
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
  openTarget: NavigationTarget | null
}

export interface DesktopBridge {
  client: ConversationBridge
  boot(): Promise<BootInfo>
  preferences(patch: Partial<Preferences>): Promise<Preferences>
  loginItem(enabled?: boolean): Promise<import('./api').ApiReply<LoginItemState>>
  exportDiagnostics(): Promise<import('./api').ApiReply<boolean>>
  onCommand(callback: (command: Command) => void): () => void
  onLeaveRequest(callback: (requestId: string) => void): () => void
  leaveResponse(requestId: string, allowed: boolean): void
  onTheme(
    callback: (theme: Pick<BootInfo, 'dark' | 'reducedTransparency' | 'highContrast'>) => void,
  ): () => void
  onPairLink(callback: (link: string) => void): () => void
  onOpenTarget(callback: (target: NavigationTarget) => void): () => void
}

declare global {
  interface Window {
    yuki: DesktopBridge
  }
}
