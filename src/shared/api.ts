import type { components as ServerComponents } from './contract.gen'
import type { components } from './contract.gen'
import type { NavigationTarget } from './desktop'
import type { ExecutorAction, ExecutorCommandItem, LocalExecutorState } from './executor'
import type { MessageReference } from './message'

export const REQUIRED_API_REVISION = 6

export type Meta = ServerComponents['schemas']['Meta']
export type Me = components['schemas']['Me']
export type ProactiveRoute = components['schemas']['ProactiveRoute']
export interface LinkCodeRequest {
  purpose: 'chat' | 'connector'
  requestId: string
  payloadHash: string
  state: 'submitted' | 'result'
  problem: string | null
  result: { code_id: string; expires_at: string } | null
}
export interface LinkCodeReply {
  request: LinkCodeRequest
  code: string | null
}
export type Home = components['schemas']['Home']
export type Profile = ServerComponents['schemas']['CharacterProfile']
export type CharacterStatus = components['schemas']['CharacterStatus']
export type SoulDocument = ServerComponents['schemas']['SoulDocument']
export interface SoulEdit {
  baseRevision: string
  baseContent: string
  draft: string
}
export interface SoulDraft extends SoulEdit {
  remote: SoulDocument
}
export type SoulCommand =
  { kind: 'save'; expectedRevision: string; content: string } | { kind: 'reload' }
export interface SoulCommandItem {
  requestId: string
  command: SoulCommand
  payloadHash: string
  state: 'submitted' | 'result'
  problem: string | null
  result: ServerComponents['schemas']['SoulResult'] | null
  details: Record<string, components['schemas']['JsonValue']> | null
}
export interface AvatarInput {
  filename: string
  bytes: Uint8Array
  sourceSize?: number
}
export interface AvatarCommandItem {
  requestId: string
  action: 'set' | 'reset'
  expectedRevision: number
  state: 'submitted' | 'result'
  problem: string | null
  current: Profile | null
}
export type MemoryFact = components['schemas']['MemoryFactView']
export type MemoryDetail = components['schemas']['MemoryDetail']
export type MemoryPage = components['schemas']['MemoryPage']
export type Automation = components['schemas']['AutomationView']
export type AutomationPage = components['schemas']['AutomationPage']
export type Capabilities = components['schemas']['CharacterCapabilities']
export type CharacterCommand =
  | { kind: 'device-revoke'; deviceId: string }
  | { kind: 'proactive-route'; expectedRevision: number; bindingId: string }
  | {
      kind: 'profile'
      expectedRevision: number
      displayName: string
      bio: string
      accent: Profile['accent']
    }
  | {
      kind: 'memory'
      factId: number
      expectedRevision: string
      action: 'correct' | 'retract'
      text?: string
    }
  | {
      kind: 'automation'
      automationId: number
      expectedRevision: string
      action: 'pause' | 'resume' | 'delete'
    }
  | {
      kind: 'avatar'
      action: 'set' | 'reset'
      expectedRevision: number
      sha256: string | null
      size: number | null
    }
export interface CharacterCommandItem {
  requestId: string
  command: CharacterCommand
  payloadHash: string
  state: 'submitted' | 'result'
  problem: string | null
  result: components['schemas']['JsonValue'] | null
  details: Record<string, components['schemas']['JsonValue']> | null
}
export type Activity = components['schemas']['Activity']
export type EventsPage = components['schemas']['Events']
export type PublicEvent = components['schemas']['Event']
export type OriginalRequest = components['schemas']['RequestReceipt']
export type MessageResult = components['schemas']['MessageReceipt']
export type Work = components['schemas']['Work']
export type WorkSteps = components['schemas']['WorkSteps']
export type WorkPage = components['schemas']['WorkPage']
export type ArtifactPage = components['schemas']['ArtifactPage']
export type Computer = components['schemas']['ComputerView']
export type ComputerResult = components['schemas']['ComputerResult']
export type ComputerFiles = components['schemas']['ComputerFiles']
export type ComputerCommand =
  | { action: 'take'; note?: string }
  | { action: 'return' | 'transfer'; leaseId: string; note?: string }
  | { action: 'wake' }
  | { action: 'sleep'; confirmActiveWorkTabs: boolean }
export interface ComputerCommandItem {
  requestId: string
  command: ComputerCommand
  payloadHash: string
  state: 'submitted' | 'result'
  problem: string | null
  result: ComputerResult | null
}
export type WorkCommand =
  | {
      kind: 'input'
      workId: string
      text: string
      agentTarget?: components['schemas']['AgentTarget']
    }
  | { kind: 'cancel'; workId: string; expectedRevision: number }
export type WorkDraftQuestion = MessageReference
export interface WorkQuestionDraft {
  question: WorkDraftQuestion
  text: string
}
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
  logout?: { drafts: number; pending: number; attachments: number; choice?: 'keep' | 'delete' }
}
export interface LogoutSummary {
  connection: Connection
  drafts: number
  pending: number
  attachments: number
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
  saved?: boolean
  bytes: Uint8Array | null
  sha256: string
  mime: string
  filename: string
}
export interface ArtifactSource {
  artifactId: string
  version: string
}
export type ApiRead =
  | {
      kind:
        | 'me'
        | 'home'
        | 'character'
        | 'character-status'
        | 'computer'
        | 'proactive-route'
        | 'executors'
    }
  | { kind: 'executor-operations'; executorId: string; cursor?: string }
  | { kind: 'memory'; about: 'me' | 'self'; cursor?: string }
  | { kind: 'memory-fact'; factId: number }
  | { kind: 'automations'; scope: 'mine' | 'self' }
  | { kind: 'capabilities' }
  | { kind: 'computer-files'; path: string; cursor?: string }
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
  pendingPairings(): Promise<ApiReply<PendingPairing[]>>
  resumePairing(characterId: string, deviceId: string): Promise<ApiReply<Connection>>
  forgetPairing(characterId: string, deviceId: string): Promise<ApiReply<void>>
  prepareLogout(characterId: string): Promise<ApiReply<LogoutSummary>>
  logoutSummary(characterId: string): Promise<ApiReply<LogoutSummary>>
  retiredHistory(characterId: string): Promise<ApiReply<{ table: string; count: number }[]>>
  exportRetiredHistory(characterId: string): Promise<ApiReply<boolean>>
  finishLogout(
    characterId: string,
    deviceId: string,
    choice: 'keep' | 'delete',
  ): Promise<ApiReply<void>>
  issueLinkCode(characterId: string): Promise<ApiReply<LinkCodeReply>>
  linkCodeRequests(characterId: string): Promise<ApiReply<LinkCodeRequest[]>>
  verifyLinkCode(characterId: string, requestId: string): Promise<ApiReply<LinkCodeReply>>
  serverInfo(characterId: string): Promise<ApiReply<Meta>>
  changeAddress(characterId: string, server: string): Promise<ApiReply<Connection>>
  soulDocument(
    characterId: string,
  ): Promise<ApiReply<{ document: SoulDocument; draft: SoulDraft | null }>>
  soulEdit(characterId: string, edit: SoulEdit): Promise<ApiReply<SoulDraft>>
  soulDraft(characterId: string): Promise<ApiReply<SoulDraft | null>>
  soulCommand(characterId: string, command: SoulCommand): Promise<ApiReply<SoulCommandItem>>
  soulCommands(characterId: string): Promise<ApiReply<SoulCommandItem[]>>
  verifySoulCommand(characterId: string, requestId: string): Promise<ApiReply<SoulCommandItem>>
  letterDecoration(
    characterId: string,
    revision: number,
    avatarRevision: number,
    bytes: Uint8Array,
  ): Promise<ApiReply<void>>
  avatarBytes(characterId: string, sha256: string, size: number): Promise<ApiReply<Uint8Array>>
  previewAvatar(server: string): Promise<ApiReply<Uint8Array | null>>
  pickAvatar(): Promise<ApiReply<AvatarInput | null>>
  dropAvatar(file: File): Promise<ApiReply<AvatarInput>>
  pasteAvatar(): Promise<ApiReply<AvatarInput>>
  avatarCommand(
    characterId: string,
    expectedRevision: number,
    bytes?: Uint8Array,
  ): Promise<ApiReply<CharacterCommandItem>>
  avatarDraft(characterId: string, requestId: string): Promise<ApiReply<AvatarInput | null>>
  characterCommand(
    characterId: string,
    command: CharacterCommand,
  ): Promise<ApiReply<CharacterCommandItem>>
  characterCommands(characterId: string): Promise<ApiReply<CharacterCommandItem[]>>
  verifyCharacterCommand(
    characterId: string,
    requestId: string,
  ): Promise<ApiReply<CharacterCommandItem>>
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
  artifactContent(characterId: string, source: ArtifactSource): Promise<ApiReply<CachedContent>>
  saveArtifact(characterId: string, source: ArtifactSource): Promise<ApiReply<boolean>>
  revealArtifact(characterId: string, source: ArtifactSource): Promise<ApiReply<void>>
  openArtifact(characterId: string, source: ArtifactSource): Promise<ApiReply<void>>
  dragArtifact(characterId: string, source: ArtifactSource): Promise<ApiReply<void>>
  outbox(characterId: string): Promise<ApiReply<OutboxItem[]>>
  verify(characterId: string, requestId: string): Promise<ApiReply<OutboxItem>>
  workCommand(
    characterId: string,
    command: WorkCommand,
    question?: WorkDraftQuestion,
  ): Promise<ApiReply<WorkCommandItem>>
  workCommands(characterId: string): Promise<ApiReply<WorkCommandItem[]>>
  workQuestionDrafts(characterId: string, workId: string): Promise<ApiReply<WorkQuestionDraft[]>>
  verifyWorkCommand(characterId: string, requestId: string): Promise<ApiReply<WorkCommandItem>>
  workDraft(
    characterId: string,
    workId: string,
    text?: string,
    question?: WorkDraftQuestion,
  ): Promise<ApiReply<string>>
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
  executorState(characterId: string): Promise<ApiReply<LocalExecutorState>>
  clearUnavailableExecutor(characterId: string): Promise<ApiReply<LocalExecutorState>>
  enableExecutor(characterId: string): Promise<ApiReply<LocalExecutorState>>
  executorAction(
    characterId: string,
    action: ExecutorAction,
  ): Promise<ApiReply<ExecutorCommandItem>>
  executorCommands(characterId: string): Promise<ApiReply<ExecutorCommandItem[]>>
  verifyExecutorCommand(
    characterId: string,
    requestId: string,
  ): Promise<ApiReply<ExecutorCommandItem>>
  pickExecutorFolder(
    characterId: string,
    alias: string,
  ): Promise<ApiReply<{ alias: string; digest: string } | null>>
  removeExecutorFolder(characterId: string, digest: string): Promise<ApiReply<LocalExecutorState>>
  computerTicket(characterId: string): Promise<ApiReply<string>>
  saveComputerFile(characterId: string, path: string): Promise<ApiReply<boolean>>
  computerCommand(
    characterId: string,
    command: ComputerCommand,
  ): Promise<ApiReply<ComputerCommandItem>>
  computerCommands(characterId: string): Promise<ApiReply<ComputerCommandItem[]>>
  verifyComputerCommand(
    characterId: string,
    requestId: string,
  ): Promise<ApiReply<ComputerCommandItem>>
  keyboardCapture(captured: boolean): Promise<ApiReply<void>>
  saveScreenshot(characterId: string, bytes: Uint8Array): Promise<ApiReply<boolean>>
}

export interface PendingPairing {
  characterId: string
  baseUrl: string
  name: string
  deviceId: string
  persistentCredentials: boolean
}
