export type UpdateChannel = 'stable' | 'beta'
export interface UpdateState {
  phase:
    | 'idle'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'preparing'
    | 'installing'
    | 'error'
    | 'unavailable'
  mode: 'managed' | 'manual' | 'development'
  channel: UpdateChannel
  currentVersion: string
  version?: string
  releaseUrl: string
  progress?: { percent: number; transferred: number; total: number }
  problem?: 'no-release' | 'network' | 'integrity' | 'download' | 'installation'
}
export const DESKTOP_RELEASES = 'https://github.com/Institute-of-Agent-Life/Yuki-Desktop/releases'
