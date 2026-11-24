import type { ConversationBridge } from './api'
import type { Language, LanguagePreference } from './locales'

export type Theme = 'system' | 'light' | 'dark'
// The pattern laid over the conversation, behind its glass; chosen in Appearance and kept.
export const backdrops = ['plain', 'lens', 'aurora', 'sunset', 'grid'] as const
// 'custom' is a picture of the person's own (`customBackdrop`), offered after the patterns.
export type Backdrop = (typeof backdrops)[number] | 'custom'
export const backdropFits = ['fill', 'fit', 'tile'] as const
/**
 * A picture of the person's own behind the conversation: kept by the app under the SHA-256 of
 * its bytes, one for both themes or one each; how it fills the chat, its blur (0–20px) and how
 * much the page's colour is laid over it (0–60%).
 */
export interface CustomBackdrop {
  light?: string
  dark?: string
  fit: (typeof backdropFits)[number]
  blur: number
  dim: number
}
/**
 * What the app keeps of a picture beside its smaller copy, made when it is imported: the mean,
 * 5th and 95th percentile of relative luminance in each cell of a `grid` × `grid` raster, row by
 * row, and the picture's average colour.
 */
export interface BackdropTable {
  grid: number
  cells: [number, number, number][]
  average: string
}
export type DisplayTimeZone = 'Asia/Taipei' | 'system'
export interface LoginItemState {
  enabled: boolean
  available: boolean
  reason: 'install-required' | 'system-approval-required' | null
}
export type View = 'chat' | 'works' | 'computer' | 'local' | 'files' | 'about' | 'settings'
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
  | 'previous-character'
  | 'next-character'

export interface Preferences {
  /** The interface language; independent of the display time zone. */
  language: LanguagePreference
  theme: Theme
  backdrop: Backdrop
  timeZone: DisplayTimeZone
  /** How much of the desktop shows through the window: 0 (opaque) to 100. */
  transparency: number
  customBackdrop: CustomBackdrop
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
  updateChannel: import('./updates').UpdateChannel
}

/**
 * A change to the preferences: each given field replaces its own; a custom backdrop's parts do the
 * same, so a picture given as undefined is removed and the parts not given are kept.
 */
export type PreferencesPatch = Partial<Omit<Preferences, 'customBackdrop'>> & {
  customBackdrop?: Partial<CustomBackdrop>
}

export const defaultPreferences: Preferences = {
  language: 'system',
  theme: 'system',
  backdrop: 'plain',
  timeZone: 'Asia/Taipei',
  transparency: 70,
  customBackdrop: { fit: 'fill', blur: 0, dim: 0 },
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
  updateChannel: 'stable',
}
export interface NavigationTarget {
  characterId: string
  view: View
  conversationId?: string
  workId?: string
}

export type NativeMaterial = 'none' | 'vibrancy' | 'mica'

export interface BootInfo {
  nativeMaterial: NativeMaterial
  /** Whether Chromium composites on the GPU; without it the glass does not bend (glass.ts). */
  gpuCompositing: boolean
  platform: 'darwin' | 'win32' | 'linux'
  version: string
  deviceLabel: string
  dark: boolean
  reducedTransparency: boolean
  highContrast: boolean
  /** macOS's Liquid Glass slider, 0 (clear) to 1 (tinted); 0.49 where there is none. */
  glassTint: number
  preferences: Preferences
  /** The language shown now: the preference, or the system's when it follows the system. */
  language: Language
  pairLink: string | null
  openTarget: NavigationTarget | null
}

export interface DesktopBridge {
  localBot: import('./local-bot').LocalBotBridge
  ssh: import('./ssh').SshBridge
  remoteDeploy: import('./ssh').RemoteDeployBridge
  connector: import('./connector').ConnectorBridge
  client: ConversationBridge
  updates: {
    state(): Promise<import('./api').ApiReply<import('./updates').UpdateState>>
    check(): Promise<import('./api').ApiReply<import('./updates').UpdateState>>
    download(): Promise<import('./api').ApiReply<import('./updates').UpdateState>>
    cancel(): Promise<import('./api').ApiReply<import('./updates').UpdateState>>
    install(): Promise<import('./api').ApiReply<boolean>>
    onChange(callback: (state: import('./updates').UpdateState) => void): () => void
  }
  boot(): Promise<BootInfo>
  applicationMenu(position: { x: number; y: number }): Promise<import('./api').ApiReply<boolean>>
  preferences(patch: PreferencesPatch): Promise<Preferences>
  backgrounds: {
    /** A picture chosen in the system's file dialog, or null if none was. */
    pick(): Promise<import('./api').ApiReply<import('./api').AvatarInput | null>>
    drop(file: File): Promise<import('./api').ApiReply<import('./api').AvatarInput>>
    /** Keeps a picture, its smaller copy (WebP) and its table; gives back its id. */
    store(
      original: Uint8Array,
      copy: Uint8Array,
      table: BackdropTable,
    ): Promise<import('./api').ApiReply<string>>
    /** Keeps a blurred copy of a kept picture. */
    blur(id: string, radius: number, copy: Uint8Array): Promise<import('./api').ApiReply<void>>
    /** The chat's own menu over its empty space; whether 「更換背景…」 was chosen. */
    menu(): Promise<import('./api').ApiReply<boolean>>
  }
  loginItem(enabled?: boolean): Promise<import('./api').ApiReply<LoginItemState>>
  exportDiagnostics(): Promise<import('./api').ApiReply<boolean>>
  onCommand(callback: (command: Command) => void): () => void
  onLeaveRequest(callback: (requestId: string) => void): () => void
  leaveResponse(requestId: string, allowed: boolean): void
  /** Whether the person can see this window now; remote screens are watched only then. */
  windowShown(): boolean
  onWindowShown(callback: (shown: boolean) => void): () => void
  onTheme(
    callback: (
      theme: Pick<BootInfo, 'dark' | 'reducedTransparency' | 'highContrast' | 'glassTint'>,
    ) => void,
  ): () => void
  onLanguage(callback: (language: Language) => void): () => void
  onPairLink(callback: (link: string) => void): () => void
  onOpenTarget(callback: (target: NavigationTarget) => void): () => void
}

declare global {
  interface Window {
    yuki: DesktopBridge
  }
}
