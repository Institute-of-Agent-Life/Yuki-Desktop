import type { components } from './contract.gen'

export const REQUIRED_API_REVISION = 3

export type Meta = components['schemas']['Meta']
export type Me = components['schemas']['Me']
export type Home = components['schemas']['Home']
export type Profile = components['schemas']['CharacterProfile']
export type EventsPage = components['schemas']['EventsPage']
export type PublicEvent = components['schemas']['PublicEvent']
export type OriginalRequest = components['schemas']['OriginalRequest']
export type MessageResult = components['schemas']['MessageResult']

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
export type ApiReply<T> = { ok: true; value: T } | { ok: false; code: string }
export type ApiRead =
  | { kind: 'me' | 'home' | 'character' }
  | { kind: 'events'; conversationId: string; after?: number; before?: number; limit?: 1 | 50 }
  | { kind: 'request'; requestId: string }

export interface ConversationBridge {
  connections(): Promise<ApiReply<Connection[]>>
  meta(server: string): Promise<ApiReply<Meta>>
  pair(server: string, code: string, label: string): Promise<ApiReply<Connection>>
  read<T>(characterId: string, route: ApiRead): Promise<ApiReply<T>>
  send(characterId: string, text: string): Promise<ApiReply<OutboxItem>>
  outbox(characterId: string): Promise<ApiReply<OutboxItem[]>>
  verify(characterId: string, requestId: string): Promise<ApiReply<OutboxItem>>
  draft(characterId: string, text?: string): Promise<ApiReply<string>>
  onHint(callback: (characterId: string, kind: string, data: unknown) => void): () => void
  reconnect(): Promise<ApiReply<void>>
  external(url: string): Promise<ApiReply<void>>
}
