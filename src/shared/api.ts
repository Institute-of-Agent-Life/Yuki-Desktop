import type { components } from './contract.gen'
import type { NavigationTarget } from './desktop'

export const REQUIRED_API_REVISION = 3

export type Meta = components['schemas']['Meta']
export type Me = components['schemas']['Me']
export type Home = components['schemas']['Home']
export type Profile = components['schemas']['CharacterProfile']
export type Activity = components['schemas']['Activity']
export type EventsPage = components['schemas']['EventsPage']
export type PublicEvent = components['schemas']['PublicEvent']
export type OriginalRequest = components['schemas']['OriginalRequest']
export type MessageResult = components['schemas']['MessageResult']
export type Work = components['schemas']['WorkView']
export type WorkSteps = components['schemas']['WorkSteps']
export type WorkPage = components['schemas']['WorkPage']
export type ArtifactPage = components['schemas']['ArtifactPage']
export type WorkCommand =
  | { kind: 'input'; workId: string; text: string }
  | { kind: 'cancel'; workId: string; expectedRevision: number }
export interface WorkCommandItem {
  requestId: string
  command: WorkCommand
  payloadHash: string
  state: 'draft' | 'submitted' | 'result'
  result: components['schemas']['JsonValue'] | null
  problem: string | null
  createdAt: number
}

export interface Connection {
  characterId: string
  baseUrl: string
  name: string
  personId: string
  bindingId: string
  conversationId: string
  persistentCredentials: boolean
  deviceId?: string
  needsPairing?: boolean
  credentialProblem?: string
}
export interface OutboxOwner {
  characterId: string
  personId: string
  bindingId: string
  conversationId: string
}
export interface OutboxItem {
  requestId: string
  body: components['schemas']['MessageBody']
  payloadHash: string
  state: 'draft' | 'submitted' | 'accepted' | 'result'
  eventId: number | null
  problem: string | null
  createdAt: number
}
export type ApiReply<T> = { ok: true; value: T } | { ok: false; code: string; reason?: string }
export interface UploadDraft {
  requestId: string
  filename: string
  kind: 'image' | 'video' | 'file' | 'record'
  sha256: string
  size: number
  state: 'draft' | 'submitted' | 'ready' | 'failed'
  mediaId: string | null
  expiresAt: number | null
  problem: string | null
}
export interface AttachmentSource {
  conversationId: string
  eventId: number
  index: number
}
export interface CachedContent {
  bytes: Uint8Array | null
  sha256: string
  mime: string
  filename: string
}
export type ApiRead =
  | { kind: 'me' | 'home' | 'character' }
  | { kind: 'events'; conversationId: string; after?: number; before?: number; limit?: 1 | 50 }
  | { kind: 'request'; requestId: string }
  | { kind: 'work'; workId: string }
  | {
      kind: 'works'
      group: 'active' | 'ended'
      origin: 'all' | 'this_entry' | 'other'
      before?: string
    }
  | { kind: 'steps'; workId: string; after?: string }
  | { kind: 'artifacts'; category: 'all' | 'image' | 'document' | 'code'; cursor?: string }
  | { kind: 'activity'; conversationId: string }

export interface ConversationBridge {
  connections(): Promise<ApiReply<Connection[]>>
  meta(server: string): Promise<ApiReply<Meta>>
  pair(server: string, code: string, label: string): Promise<ApiReply<Connection>>
  read<T>(characterId: string, route: ApiRead): Promise<ApiReply<T>>
  send(characterId: string, text: string, uploads?: string[]): Promise<ApiReply<OutboxItem>>
  uploads(characterId: string): Promise<ApiReply<UploadDraft[]>>
  attach(characterId: string): Promise<ApiReply<UploadDraft[]>>
  drop(characterId: string, files: File[]): Promise<ApiReply<UploadDraft[]>>
  record(characterId: string, bytes: Uint8Array): Promise<ApiReply<UploadDraft>>
  microphone(): Promise<ApiReply<void>>
  retryUpload(characterId: string, requestId: string): Promise<ApiReply<UploadDraft>>
  removeUpload(characterId: string, requestId: string): Promise<ApiReply<void>>
  content(characterId: string, source: AttachmentSource): Promise<ApiReply<CachedContent>>
  saveContent(characterId: string, source: AttachmentSource): Promise<ApiReply<boolean>>
  outbox(characterId: string): Promise<ApiReply<OutboxItem[]>>
  verify(characterId: string, requestId: string): Promise<ApiReply<OutboxItem>>
  workCommand(characterId: string, command: WorkCommand): Promise<ApiReply<WorkCommandItem>>
  workCommands(characterId: string): Promise<ApiReply<WorkCommandItem[]>>
  verifyWorkCommand(characterId: string, requestId: string): Promise<ApiReply<WorkCommandItem>>
  workDraft(characterId: string, workId: string, text?: string): Promise<ApiReply<string>>
  draft(characterId: string, text?: string): Promise<ApiReply<string>>
  onHint(callback: (characterId: string, kind: string, data: unknown) => void): () => void
  reconnect(): Promise<ApiReply<void>>
  external(url: string): Promise<ApiReply<void>>
  copy(text: string): Promise<ApiReply<void>>
  paste(): Promise<ApiReply<string>>
  selected(characterId: string): Promise<ApiReply<void>>
  acknowledgeTarget(target: NavigationTarget): Promise<ApiReply<void>>
  contextMenu(options: {
    text: string
    link?: string
    save?: boolean
  }): Promise<ApiReply<'save' | null>>
}
