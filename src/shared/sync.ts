import type { components } from './contract.gen'

export interface SyncHint {
  conversations: components['schemas']['Conversation'][]
  works: { work_id: string; revision: number }[]
  activity: components['schemas']['Activity'][]
  character?: {
    id: string
    revision: number
    avatar_revision: number
    is_owner: boolean
    soul?: { revision: string; active_revision: string }
  }
}
