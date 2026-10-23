import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import type {
  ApiRead,
  AttachmentSource,
  ArtifactSource,
  Connection,
  PendingPairing,
  CharacterCommand,
  EventsPage,
  Me,
  Meta,
  OutboxItem,
  WorkCommand,
  WorkDraftQuestion,
  Profile,
  SoulCommand,
  SoulDocument,
  SoulEdit,
  LogoutSummary,
} from '../shared/api'
import { REQUIRED_API_REVISION } from '../shared/api'
import { ApiClient, ApiError, normalizeServer } from './api/client'
import { meetsMinimum } from '../shared/version'
import { readStream } from './api/stream'
import { Credentials } from './credentials'
import { Outbox } from './outbox'
import { WorkCommands } from './outbox/work-commands'
import { CharacterCommands } from './outbox/character-commands'
import { Soul } from './outbox/soul'
import { LinkCodes } from './outbox/link-codes'
import { localSummary, retiredSummary, exportRetired } from './outbox/local-summary'
import type { LocalStore } from './store'
import { Uploads } from './media/uploads'
import { ContentCache } from './media/content'
import { previewMime } from '../shared/media'

const uuid = (value: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new ApiError('invalid_response')
  return value
}
const artifactIdentity = (value: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new ApiError('validation_error')
  return value.toLowerCase()
}

export class Connections {
  diagnosticCounts() {
    const messages: Record<string, number> = {}
    for (const box of this.outboxes.values()) {
      const rows = box.db
        .prepare(
          "SELECT state, count(*) AS total FROM requests WHERE state IN ('draft','submitted','accepted','result') GROUP BY state",
        )
        .all() as { state: string; total: number }[]
      for (const row of rows) messages[row.state] = (messages[row.state] ?? 0) + row.total
    }
    return { connections: this.list().length, subscriptions: this.streams.size, messages }
  }
  onProfile?: (id: string, profile: Profile) => void
  onIdentity?: (id: string, name: string) => void
  readonly credentials: Credentials
  private readonly outboxes = new Map<string, Outbox>()
  private readonly streams = new Map<string, AbortController>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly checking = new Map<string, Promise<OutboxItem>>()
  private readonly identified = new Map<string, Promise<Meta>>()
  private readonly states = new Map<string, unknown>()
  private readonly uploadStores = new Map<Outbox, Uploads>()
  private readonly commandStores = new Map<Outbox, WorkCommands>()
  private readonly characterStores = new Map<Outbox, CharacterCommands>()
  private readonly avatarReads = new Map<string, Promise<Uint8Array>>()
  private readonly soulStores = new Map<Outbox, Soul>()
  private readonly linkCodeStores = new Map<Outbox, LinkCodes>()
  private readonly soulReads = new Set<Promise<unknown>>()
  private closed = false
  private readonly frozen = new Set<string>()
  private readonly epochs = new Map<string, number>()
  private readonly activities = new Map<string, Set<Promise<unknown>>>()
  private readonly logouts = new Map<string, Promise<LogoutSummary>>()
  private readonly finishes = new Map<string, { key: string; work: Promise<void> }>()
  constructor(
    readonly store: LocalStore,
    readonly root: string,
    readonly version: string,
    readonly hint: (id: string, kind: string, data: unknown) => void,
  ) {
    this.credentials = new Credentials(store)
  }
  private emit(id: string, kind: string, data: unknown) {
    if (kind === 'connection') this.states.set(id, data)
    this.hint(id, kind, data)
  }
  publishStates() {
    for (const [id, state] of this.states) this.hint(id, 'connection', state)
  }
  list() {
    return this.store.get<Connection[]>('connections') ?? []
  }
  pendingPairings() {
    return this.store.get<PendingPairing[]>('pending-pairings') ?? []
  }
  forgetPairing(characterId: string, deviceId: string) {
    this.credentials.remove(`pending-device/${characterId}/${deviceId}`)
    this.store.set(
      'pending-pairings',
      this.pendingPairings().filter(
        (item) => item.characterId !== characterId || item.deviceId !== deviceId,
      ),
    )
  }
  async resumePairing(characterId: string, deviceId: string) {
    const pending = this.pendingPairings().find(
      (item) => item.characterId === characterId && item.deviceId === deviceId,
    )
    if (!pending) throw new ApiError('not_found')
    if (
      this.frozen.has(characterId) ||
      this.list().some((item) => item.characterId === characterId && item.logout)
    )
      throw new ApiError('logout_pending')
    const meta = await this.meta(pending.baseUrl)
    if (meta.character.id !== characterId) throw new ApiError('different_character')
    return this.trackActivity(characterId, () => this.completePairing(pending, meta))
  }
  activity<T>(id: string, run: () => T | Promise<T>): Promise<T> {
    if (this.frozen.has(id) || this.connection(id).logout)
      return Promise.reject(new ApiError('logout_pending'))
    return this.trackActivity(id, run)
  }
  private trackActivity<T>(id: string, run: () => T | Promise<T>): Promise<T> {
    let active = this.activities.get(id)
    if (!active) {
      active = new Set()
      this.activities.set(id, active)
    }
    const work = Promise.resolve()
      .then(run)
      .finally(() => active!.delete(work))
    active.add(work)
    return work
  }
  private freeze(id: string) {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1)
    this.frozen.add(id)
    this.streams.get(id)?.abort()
    this.streams.delete(id)
    clearTimeout(this.retries.get(id))
    this.retries.delete(id)
  }
  private async drain(id: string) {
    await Promise.allSettled(this.activities.get(id) ?? [])
    const connection = this.connection(id),
      box = this.outboxes.get(`${id}/${connection.personId}/${connection.bindingId}`)
    if (!box) return
    await Promise.allSettled([
      ...[...this.avatarReads].filter(([key]) => key.startsWith(id + '/')).map(([, work]) => work),
      ...[...this.checking].filter(([key]) => key.startsWith(id + '/')).map(([, work]) => work),
      this.uploadStores.get(box)?.settled(),
      this.commandStores.get(box)?.settle(),
      this.characterStores.get(box)?.settle(),
      this.soulStores.get(box)?.settled(),
      this.linkCodeStores.get(box)?.settled(),
    ])
  }
  retiredHistory(id: string) {
    return retiredSummary(this.box(id))
  }
  exportRetiredHistory(id: string) {
    return exportRetired(this.box(id))
  }
  logoutSummary(id: string): LogoutSummary {
    const connection = this.connection(id)
    if (!connection.logout) throw new ApiError('precondition_failed')
    return {
      connection,
      drafts: connection.logout.drafts,
      pending: connection.logout.pending,
      attachments: connection.logout.attachments,
    }
  }
  prepareLogout(id: string, pause: () => Promise<void> = async () => {}) {
    const existing = this.logouts.get(id)
    if (existing) return existing
    const work = this.beginLogout(id, pause).finally(() => this.logouts.delete(id))
    this.logouts.set(id, work)
    return work
  }
  private async beginLogout(id: string, pause: () => Promise<void>) {
    let connection = this.connection(id)
    this.freeze(id)
    try {
      await pause()
      await this.drain(id)
      connection = this.connection(id)
      if (!connection.logout) {
        if (!connection.deviceId) throw new ApiError('precondition_failed')
        await this.identify(id)
        const client = this.client(id),
          box = this.box(id)
        let invalid = false
        try {
          await box.verifyOwner(client)
        } catch (error) {
          if (error instanceof ApiError && error.code === 'unauthenticated') invalid = true
          else throw error
        }
        if (!invalid) {
          const commands = this.characterCommands(id),
            item = commands.prepare({ kind: 'device-revoke', deviceId: connection.deviceId })
          const result = await commands.run(client, item.requestId, true)
          if (result.state !== 'result' || result.problem) {
            try {
              await client.get<Me>('me')
            } catch (error) {
              if (error instanceof ApiError && error.code === 'unauthenticated') invalid = true
              else throw error
            }
            if (!invalid) throw new ApiError(result.problem ?? 'unknown')
          }
        }
        this.store.set(
          'connections',
          this.list().map((item) =>
            item.characterId === id ? { ...item, logout: localSummary(box) } : item,
          ),
        )
      }
      return this.logoutSummary(id)
    } catch (error) {
      if (!this.connection(id).logout) {
        this.frozen.delete(id)
        this.start(id)
      }
      throw error
    }
  }
  finishLogout(id: string, deviceId: string, choice: 'keep' | 'delete') {
    const key = `${deviceId}/${choice}`,
      previous = this.finishes.get(id)
    if (previous)
      return previous.key === key
        ? previous.work
        : Promise.reject(new ApiError('precondition_failed'))
    const work = this.completeLogout(id, deviceId, choice).finally(() => this.finishes.delete(id))
    this.finishes.set(id, { key, work })
    return work
  }
  private async completeLogout(id: string, deviceId: string, choice: 'keep' | 'delete') {
    const connection = this.connection(id)
    if (
      !connection.logout ||
      connection.deviceId !== deviceId ||
      !['keep', 'delete'].includes(choice)
    )
      throw new ApiError('precondition_failed')
    this.freeze(id)
    await this.drain(id)
    if (connection.logout.choice && connection.logout.choice !== choice)
      throw new ApiError('precondition_failed')
    this.store.set(
      'connections',
      this.list().map((item) =>
        item.characterId === id ? { ...item, logout: { ...connection.logout!, choice } } : item,
      ),
    )
    const key = `${id}/${connection.personId}/${connection.bindingId}`,
      box = this.outboxes.get(key)
    const file = join(
      this.root,
      'connections',
      uuid(id),
      'outbox',
      uuid(connection.personId),
      uuid(connection.bindingId) + '.sqlite3',
    )
    if (box) {
      box.db.close()
      this.outboxes.delete(key)
      this.uploadStores.delete(box)
      this.commandStores.delete(box)
      this.characterStores.delete(box)
      this.soulStores.delete(box)
      this.linkCodeStores.delete(box)
    }
    if (choice === 'delete') {
      await rm(
        join(
          this.root,
          'connections',
          uuid(id),
          'uploads',
          uuid(connection.personId),
          uuid(connection.bindingId),
        ),
        { recursive: true, force: true },
      )
      await this.contentCache(id).clear()
      for (const suffix of ['', '-wal', '-shm', '.soul-upgrade.json', '.soul-draft.md'])
        await rm(file + suffix, { force: true })
    }
    this.credentials.remove(`device/${id}/${connection.personId}`)
    this.activities.delete(id)
    this.identified.delete(id)
    this.states.delete(id)
    this.store.set(
      'connections',
      this.list().filter((item) => item.characterId !== id),
    )
    if (this.store.get<string>('selectedCharacterId') === id)
      this.store.set('selectedCharacterId', null)
    this.frozen.delete(id)
  }
  publicList() {
    const selected = this.store.get<string>('selectedCharacterId')
    return this.list()
      .sort((a, b) => Number(b.characterId === selected) - Number(a.characterId === selected))
      .map((connection) => {
        try {
          return {
            ...connection,
            needsPairing: !this.credentials.get(
              `device/${connection.characterId}/${connection.personId}`,
            ),
          }
        } catch {
          return { ...connection, needsPairing: true, credentialProblem: 'credentials_unavailable' }
        }
      })
  }
  connection(id: string) {
    const connection = this.list().find((item) => item.characterId === id)
    if (!connection) throw new ApiError('not_found')
    return connection
  }
  private readonly addressChanges = new Map<string, symbol>()
  async serverInfo(id: string) {
    const value = await this.meta(this.connection(id).baseUrl)
    if (value.character.id !== id) throw new ApiError('different_character')
    return value
  }
  async changeAddress(id: string, server: string) {
    const attempt = Symbol(),
      original = this.connection(id),
      baseUrl = normalizeServer(server)
    this.addressChanges.set(id, attempt)
    // A new address receives no credential until its public identity and minimum
    // versions have been checked. The original App namespace must then still match.
    const meta = await this.meta(baseUrl)
    if (meta.character.id !== id) throw new ApiError('different_character')
    const key = `device/${id}/${original.personId}`,
      token = this.credentials.get(key)
    if (!token) throw new ApiError('unauthenticated')
    const me = await this.box(id).verifyOwner(
      new ApiClient(baseUrl, token, original.bindingId, this.version),
    )
    if (me.source_person_id !== original.personId) throw new ApiError('outbox_owner_mismatch')
    const current = this.connection(id)
    if (
      this.addressChanges.get(id) !== attempt ||
      current.baseUrl !== original.baseUrl ||
      current.personId !== original.personId ||
      current.bindingId !== original.bindingId ||
      current.conversationId !== original.conversationId ||
      this.credentials.get(key) !== token
    )
      throw new ApiError('precondition_failed')
    const updated = { ...current, baseUrl }
    this.store.set(
      'connections',
      this.list().map((item) => (item.characterId === id ? updated : item)),
    )
    this.start(id)
    this.emit(id, 'address', { baseUrl })
    return updated
  }
  client(id: string, entry?: string) {
    const connection = this.connection(id)
    const token = this.credentials.get(`device/${connection.characterId}/${connection.personId}`)
    if (!token) throw new ApiError('unauthenticated')
    return new ApiClient(connection.baseUrl, token, entry ?? connection.bindingId, this.version)
  }
  box(id: string) {
    const connection = this.connection(id),
      key = `${id}/${connection.personId}/${connection.bindingId}`
    let box = this.outboxes.get(key)
    if (!box) {
      box = new Outbox(
        join(
          this.root,
          'connections',
          uuid(id),
          'outbox',
          uuid(connection.personId),
          uuid(connection.bindingId) + '.sqlite3',
        ),
        {
          characterId: id,
          personId: connection.personId,
          bindingId: connection.bindingId,
          conversationId: connection.conversationId,
        },
      )
      this.outboxes.set(key, box)
    }
    return box
  }
  commands(id: string) {
    const box = this.box(id)
    let commands = this.commandStores.get(box)
    if (!commands) {
      commands = new WorkCommands(box)
      this.commandStores.set(box, commands)
    }
    return commands
  }
  characterCommands(id: string) {
    const box = this.box(id)
    let commands = this.characterStores.get(box)
    if (!commands) {
      commands = new CharacterCommands(box)
      this.characterStores.set(box, commands)
    }
    return commands
  }
  soul(id: string) {
    const box = this.box(id)
    let soul = this.soulStores.get(box)
    if (!soul) {
      soul = new Soul(box)
      this.soulStores.set(box, soul)
    }
    return soul
  }
  soulDocument(id: string) {
    if (this.closed) return Promise.reject(new ApiError('unavailable'))
    const work = this.fetchSoulDocument(id).finally(() => this.soulReads.delete(work))
    this.soulReads.add(work)
    return work
  }
  private async fetchSoulDocument(id: string) {
    const soul = this.soul(id),
      version = soul.captureRead()
    await this.identify(id)
    const documents = await this.client(id).get<SoulDocument>('character/soul')
    return { document: documents, draft: soul.observe(documents, version) }
  }
  soulEdit(id: string, edit: SoulEdit) {
    return this.soul(id).edit(edit)
  }
  async soulCommand(id: string, command: SoulCommand) {
    await this.identify(id)
    const soul = this.soul(id),
      item = soul.prepare(command)
    const result = await soul.run(this.client(id), item.requestId)
    this.emit(id, 'soul-command', {})
    return result
  }
  async verifySoulCommand(id: string, requestId: string) {
    await this.identify(id)
    const result = await this.soul(id).run(this.client(id), uuid(requestId))
    this.emit(id, 'soul-command', {})
    return result
  }
  avatarBytes(id: string, sha: string, size: number) {
    if (this.closed) return Promise.reject(new ApiError('unavailable'))
    const connection = this.connection(id)
    const key = `${id}/${connection.personId}/${connection.bindingId}/${sha}/${size}`
    const previous = this.avatarReads.get(key)
    if (previous) return previous
    const work = this.fetchAvatarBytes(id, sha, size).finally(() => this.avatarReads.delete(key))
    this.avatarReads.set(key, work)
    return work
  }
  private async fetchAvatarBytes(id: string, sha: string, size: number) {
    if (!/^[a-f0-9]{64}$/.test(sha) || ![64, 128, 256, 512, 1024].includes(size))
      throw new ApiError('validation_error')
    const box = this.box(id),
      key = `avatar/${sha}/${size}`
    try {
      await this.identify(id)
      const response = await this.client(id).response(`character/avatar/${sha}/${size}.png`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (response.headers.get('Content-Type')?.split(';')[0] !== 'image/png')
        throw new ApiError('invalid_response')
      const length = response.headers.get('Content-Length')
      if (length !== null && bytes.byteLength !== Number(length))
        throw new ApiError('content_hash_mismatch')
      box.cache(key, {
        bytes: bytes.toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
      return new Uint8Array(bytes)
    } catch (error) {
      if (
        error instanceof ApiError &&
        ['unauthenticated', 'not_found', 'different_character', 'outbox_owner_mismatch'].includes(
          error.code,
        )
      )
        box.clearCache()
      if (error instanceof ApiError && ['transport_unknown', 'unavailable'].includes(error.code)) {
        const cached = box.cached<{ bytes: string; sha256: string }>(key)
        if (cached) {
          const bytes = Buffer.from(cached.bytes, 'base64')
          if (createHash('sha256').update(bytes).digest('hex') !== cached.sha256)
            throw new ApiError('content_hash_mismatch')
          return new Uint8Array(bytes)
        }
      }
      throw error
    }
  }
  async previewAvatar(server: string) {
    const meta = await this.meta(server)
    const path = meta.character.avatar_url
    if (path === null) return null
    if (!/^\/client\/v1\/character\/avatar\/[a-f0-9]{64}\/128\.png$/.test(path))
      throw new ApiError('invalid_response')
    const response = await new ApiClient(server).response(path.slice('/client/v1/'.length))
    return new Uint8Array(await response.arrayBuffer())
  }
  async characterCommand(id: string, command: CharacterCommand) {
    await this.identify(id)
    const commands = this.characterCommands(id)
    const item = commands.prepare(command)
    const result = await commands.run(this.client(id), item.requestId, true)
    this.emit(id, 'character-command', {})
    return result
  }
  linkCodes(id: string) {
    const box = this.box(id)
    let store = this.linkCodeStores.get(box)
    if (!store) {
      store = new LinkCodes(box)
      this.linkCodeStores.set(box, store)
    }
    return store
  }
  async issueLinkCode(id: string, purpose: 'chat' | 'connector' = 'chat') {
    await this.identify(id)
    const codes = this.linkCodes(id),
      item = codes.prepare(purpose)
    return this.verifyLinkCode(id, item.requestId)
  }
  async verifyLinkCode(id: string, requestId: string) {
    await this.identify(id)
    const result = await this.linkCodes(id).run(this.client(id), uuid(requestId))
    this.emit(id, 'link-code', {})
    return result
  }
  async authorizeConnector(id: string) {
    const result = await this.issueLinkCode(id, 'connector')
    if (!result.code) throw new ApiError('connector_authorization_unconfirmed')
    return { server: this.connection(id).baseUrl, code: result.code }
  }
  async agentRead<T>(id: string, path: string): Promise<T> {
    await this.identify(id)
    const client = this.client(id)
    await this.box(id).verifyOwner(client)
    const agents = new ApiClient(
      client.base,
      client.token,
      undefined,
      this.version,
      fetch,
      'agents/v1',
    )
    const response = await agents.response(path)
    return (await response.json()) as T
  }
  async connectorAdmission(id: string, server: string, deviceId: string) {
    if (normalizeServer(server) !== this.connection(id).baseUrl)
      return { matched: false, connected: false, problem: 'connector_other_server' }
    const catalog = await this.agentRead<{
      devices: { id: string; online: boolean }[]
      instances: {
        id: string
        device_id: string
        label: string
        driver: string
        local_id?: string
      }[]
    }>(id, 'devices')
    const device = catalog.devices.find((item) => item.id === deviceId)
    return {
      matched: !!device,
      connected: device?.online ?? false,
      ...(!device ? { problem: 'connector_other_person' } : {}),
      instances: catalog.instances
        .filter((item) => item.device_id === deviceId)
        .map((item) => ({
          id: item.id,
          label: item.label,
          driver: item.driver,
          localId: item.local_id,
        })),
    }
  }
  async verifyCharacterCommand(id: string, requestId: string) {
    await this.identify(id)
    const result = await this.characterCommands(id).run(this.client(id), uuid(requestId), true)
    this.emit(id, 'character-command', {})
    return result
  }
  async workCommand(id: string, command: WorkCommand, question?: WorkDraftQuestion) {
    uuid(command.workId)
    const commands = this.commands(id),
      client = this.client(id)
    const draftSnapshot = commands.draft(command.workId, undefined, question)
    let offline = false
    try {
      await this.identify(id)
      await this.box(id).verifyOwner(client)
    } catch (error) {
      if (error instanceof ApiError && ['transport_unknown', 'unavailable'].includes(error.code))
        offline = true
      else throw error
    }
    const item = commands.prepare(command, offline ? 'draft' : 'submitted', draftSnapshot, question)
    const result = offline ? item : await commands.send(client, item.requestId)
    this.emit(id, 'commands', {})
    return result
  }
  async verifyWorkCommand(id: string, requestId: string) {
    await this.identify(id)
    const result = await this.commands(id).verify(this.client(id), uuid(requestId))
    if (!this.closed) this.emit(id, 'commands', {})
    return result
  }
  uploads(id: string) {
    const box = this.box(id)
    let uploads = this.uploadStores.get(box)
    if (!uploads) {
      uploads = new Uploads(
        box,
        join(
          this.root,
          'connections',
          uuid(id),
          'uploads',
          uuid(box.owner.personId),
          uuid(box.owner.bindingId),
        ),
      )
      this.uploadStores.set(box, uploads)
    }
    return uploads
  }
  private contentCache(id: string) {
    const root = join(
      this.root,
      'connections',
      uuid(id),
      'cache',
      uuid(this.connection(id).personId),
    )
    // Native Windows drop targets can truncate paths under the nested private cache.
    return new ContentCache(
      root,
      join(tmpdir(), 'yuki-originals-' + createHash('sha256').update(root).digest('hex')),
    )
  }
  async artifact(id: string, source: ArtifactSource) {
    const identity = artifactIdentity(source.artifactId)
    if (!/^[a-f0-9]{64}$/.test(source.version)) throw new ApiError('validation_error')
    await this.identify(id)
    const parent = this.contentCache(id)
    const cache = new ContentCache(
      join(parent.root, 'artifacts'),
      join(parent.exportRoot, 'artifacts'),
    )
    try {
      const content = await cache.download(
        this.client(id),
        `artifacts/${identity}?version=${source.version}`,
        source.version,
      )
      const filename = content.filename ?? identity
      return {
        ...content,
        cache,
        filename,
        mime: previewMime(
          filename,
          content.mime === 'application/octet-stream' ? undefined : content.mime,
        ),
      }
    } catch (error) {
      if (
        error instanceof ApiError &&
        ['not_found', 'unauthenticated', 'outbox_owner_mismatch'].includes(error.code)
      )
        await cache.remove(source.version)
      throw error
    }
  }
  async artifactContent(id: string, source: ArtifactSource) {
    const item = await this.artifact(id, source)
    const path = this.savedArtifact(id, source)
    const saved =
      !!path &&
      (await stat(path).then(
        (info) => info.isFile(),
        () => false,
      ))
    return {
      saved,
      bytes: /^(image\/|text\/|application\/(json|pdf)$)/.test(item.mime)
        ? await item.cache.bytes(item.path, item.sha256)
        : null,
      sha256: item.sha256,
      filename: item.filename,
      mime: item.mime,
    }
  }
  savedArtifact(id: string, source: ArtifactSource, path?: string) {
    const identity = artifactIdentity(source.artifactId)
    if (!/^[a-f0-9]{64}$/.test(source.version)) throw new ApiError('validation_error')
    const key = `saved-artifact/${identity}/${source.version}`
    if (path) this.box(id).cache(key, path)
    return this.box(id).cached<string>(key)
  }
  async retryUpload(id: string, requestId: string) {
    await this.identify(id)
    const result = await this.uploads(id).upload(this.client(id), uuid(requestId))
    this.emit(id, 'outbox', {})
    return result
  }
  async stage(id: string, paths: string[]) {
    const uploads = this.uploads(id)
    for (const path of paths) {
      const item = await uploads.stage(path)
      void this.retryUpload(id, item.requestId).catch(() => {})
    }
    this.emit(id, 'outbox', {})
    return uploads.list()
  }
  async record(id: string, bytes: Uint8Array) {
    const item = await this.uploads(id).record(bytes)
    void this.retryUpload(id, item.requestId).catch(() => {})
    this.emit(id, 'outbox', {})
    return item
  }
  async attachment(id: string, source: AttachmentSource) {
    if (
      !Number.isSafeInteger(source.eventId) ||
      source.eventId < 1 ||
      !Number.isSafeInteger(source.index) ||
      source.index < 0
    )
      throw new ApiError('validation_error')
    const page = await this.read<EventsPage>(id, {
      kind: 'events',
      conversationId: uuid(source.conversationId),
      after: source.eventId - 1,
      limit: 1,
    })
    const event = page.items.find((item) => item.event_id === source.eventId),
      attachment = event?.attachments.find((item) => item.attachment_index === source.index)
    const key = `content/${source.conversationId}/${source.eventId}/${source.index}`,
      cache = this.contentCache(id),
      previous = this.box(id).cached<string>(key)
    if (!attachment) {
      if (previous) await cache.remove(previous)
      throw new ApiError('not_found')
    }
    if (attachment.artifact_id) throw new ApiError('validation_error')
    let downloaded: Awaited<ReturnType<ContentCache['download']>>
    try {
      downloaded = await cache.download(
        this.client(id),
        `conversations/${source.conversationId}/events/${source.eventId}/attachments/${source.index}`,
      )
    } catch (error) {
      if (
        previous &&
        error instanceof ApiError &&
        ['not_found', 'media_unavailable'].includes(error.code)
      )
        await cache.remove(previous)
      throw error
    }
    this.box(id).cache(key, downloaded.sha256)
    return {
      ...downloaded,
      cache,
      filename: attachment.filename ?? 'attachment',
      mime: previewMime(attachment.filename ?? '', attachment.mime_type),
    }
  }
  async content(id: string, source: AttachmentSource) {
    const item = await this.attachment(id, source)
    return {
      bytes: /^(image\/|video\/|text\/|application\/(json|pdf)$)/.test(item.mime)
        ? await item.cache.bytes(item.path, item.sha256)
        : null,
      sha256: item.sha256,
      mime: item.mime,
      filename: item.filename,
    }
  }
  async meta(server: string) {
    const meta = await new ApiClient(server, undefined, undefined, this.version).get<Meta>('meta')
    if (
      !meta?.character ||
      typeof meta.character.display_name !== 'string' ||
      !Number.isInteger(meta.api_revision) ||
      (meta.min_client?.desktop !== null && typeof meta.min_client?.desktop !== 'string')
    )
      throw new ApiError('invalid_response')
    uuid(meta.character.id)
    if (meta.api_revision < REQUIRED_API_REVISION) throw new ApiError('server_upgrade_required')
    const compatible =
      meta.min_client.desktop === null || meetsMinimum(this.version, meta.min_client.desktop)
    if (compatible === null) throw new ApiError('invalid_response')
    if (!compatible) throw new ApiError('client_upgrade_required')
    return meta
  }
  private rememberName(id: string, name: string) {
    if (this.connection(id).name === name) return
    this.store.set(
      'connections',
      this.list().map((item) => (item.characterId === id ? { ...item, name } : item)),
    )
    this.emit(id, 'connection-name', { name })
  }
  private identify(id: string) {
    let pending = this.identified.get(id)
    if (!pending) {
      pending = this.meta(this.connection(id).baseUrl)
        .then((meta) => {
          if (meta.character.id !== id) throw new ApiError('different_character')
          this.rememberName(id, meta.character.display_name)
          this.onIdentity?.(id, meta.character.display_name)
          return meta
        })
        .catch((error) => {
          this.identified.delete(id)
          throw error
        })
      this.identified.set(id, pending)
    }
    return pending
  }

  async pair(server: string, code: string, label: string) {
    const epochs = new Map(this.epochs),
      baseUrl = normalizeServer(server),
      meta = await this.meta(baseUrl)
    if (
      (epochs.get(meta.character.id) ?? 0) !== (this.epochs.get(meta.character.id) ?? 0) ||
      this.frozen.has(meta.character.id) ||
      this.list().some((item) => item.characterId === meta.character.id && item.logout)
    )
      throw new ApiError('logout_pending')
    return this.trackActivity(meta.character.id, () =>
      this.pairVerified(baseUrl, meta, code, label),
    )
  }
  private async pairVerified(baseUrl: string, meta: Meta, code: string, label: string) {
    await this.credentials.preparePersistence()
    const paired = await new ApiClient(baseUrl, undefined, undefined, this.version).post<{
      device_id: string
      token: string
    }>('pair', { code, device_label: label })
    const pending: PendingPairing = {
      characterId: uuid(meta.character.id),
      baseUrl,
      name: meta.character.display_name,
      deviceId: uuid(paired.device_id),
      persistentCredentials: this.credentials.set(
        `pending-device/${meta.character.id}/${paired.device_id}`,
        paired.token,
      ),
    }
    this.store.set('pending-pairings', [...this.pendingPairings(), pending])
    return this.completePairing(pending, meta)
  }
  private async completePairing(pending: PendingPairing, meta: Meta) {
    const baseUrl = pending.baseUrl,
      token = this.credentials.get(`pending-device/${pending.characterId}/${pending.deviceId}`)
    if (!token) throw new ApiError('credentials_unavailable')
    let me = await new ApiClient(baseUrl, token, undefined, this.version).get<Me>('me')
    const characterId = uuid(meta.character.id)
    const existing = this.list().find((item) => item.characterId === characterId)
    if (existing) {
      try {
        // A merged Person's new token may default to another App binding. Prove
        // access to the original owner namespace before touching its local data.
        me = await new ApiClient(baseUrl, token, existing.bindingId, this.version).get<Me>('me')
        const binding = me.bindings.find(
          (item) => item.binding_id === existing.bindingId && item.platform === 'app',
        )
        if (
          !binding ||
          binding.source_person_id !== existing.personId ||
          me.request_person_id !== existing.personId ||
          me.conversation_id !== existing.conversationId
        )
          throw new ApiError('different_person')
      } catch (error) {
        if (
          error instanceof ApiError &&
          ['not_found', 'different_person', 'outbox_owner_mismatch'].includes(error.code)
        ) {
          await new ApiClient(baseUrl, token, undefined, this.version).response(
            `devices/${pending.deviceId}`,
            { method: 'DELETE' },
          )
          this.forgetPairing(pending.characterId, pending.deviceId)
          throw new ApiError('different_person')
        }
        throw error
      }
    }
    const persistentCredentials = this.credentials.set(
      `device/${characterId}/${me.request_person_id}`,
      token,
    )
    const connection: Connection = {
      characterId,
      baseUrl,
      name: meta.character.display_name,
      personId: uuid(me.request_person_id),
      bindingId: uuid(me.binding_id),
      conversationId: uuid(me.conversation_id),
      persistentCredentials,
      deviceId: pending.deviceId,
    }
    this.store.set('connections', [
      ...this.list().filter((item) => item.characterId !== characterId),
      connection,
    ])
    this.forgetPairing(pending.characterId, pending.deviceId)
    this.onIdentity?.(characterId, meta.character.display_name)
    this.start(characterId)
    return connection
  }
  async read<T>(id: string, route: ApiRead, offlineCache = true): Promise<T> {
    let path: string
    if (route.kind === 'me' || route.kind === 'character') path = route.kind
    else if (route.kind === 'home') path = 'home'
    else if (route.kind === 'request') path = `requests/${uuid(route.requestId)}`
    else if (route.kind === 'work') path = `works/${uuid(route.workId)}`
    else if (route.kind === 'activity')
      path = `activity?conversation_id=${uuid(route.conversationId)}`
    else if (route.kind === 'events') {
      const query = new URLSearchParams({ limit: route.limit === 1 ? '1' : '50' })
      if (route.after !== undefined) query.set('after', String(route.after))
      if (route.before !== undefined) query.set('before', String(route.before))
      path = `conversations/${uuid(route.conversationId)}/events?${query}`
    } else throw new ApiError('validation_error')
    const box = this.box(id)
    try {
      await this.identify(id)
      const value = await this.client(id).get<T>(path)
      if (!['me', 'request'].includes(route.kind)) box.cache(path, value)
      if (route.kind === 'character') {
        this.rememberName(id, (value as Profile).display_name)
        this.onProfile?.(id, value as Profile)
      }
      return value
    } catch (error) {
      if (error instanceof ApiError) {
        if (['unauthenticated', 'not_found', 'outbox_owner_mismatch'].includes(error.code)) {
          box.clearCache()
          await this.contentCache(id).clear()
        }
        if (['transport_unknown', 'unavailable'].includes(error.code)) {
          this.emit(id, 'connection', { state: 'offline', code: error.code })
          const cached = offlineCache ? box.cached<T>(path) : undefined
          if (cached !== undefined) {
            if (route.kind === 'character') this.onProfile?.(id, cached as Profile)
            return cached
          }
        }
      }
      throw error
    }
  }
  async send(
    id: string,
    text: string,
    uploadIds: string[] = [],
    agentTarget?: OutboxItem['body']['agent_target'],
  ): Promise<OutboxItem> {
    const box = this.box(id),
      client = this.client(id),
      draftSnapshot = agentTarget ? null : box.draft()
    let offline = false
    try {
      await this.identify(id)
      await box.verifyOwner(client)
    } catch (error) {
      if (error instanceof ApiError && ['transport_unknown', 'unavailable'].includes(error.code))
        offline = true
      else throw error
    }
    const uploads = this.uploads(id),
      attachments = uploads.references(uploadIds)
    const item = box.prepare(
      text,
      offline ? 'draft' : 'submitted',
      draftSnapshot,
      attachments,
      () => uploadIds.forEach((item) => uploads.remove(item)),
      agentTarget,
    )
    const result = offline ? item : await box.send(client, item.requestId)
    this.emit(id, 'outbox', {})
    return result
  }
  async verify(id: string, requestId: string) {
    const key = `${id}/${uuid(requestId)}`
    const previous = this.checking.get(key)
    if (previous) return previous
    const pending = this.identify(id)
      .then(() => this.box(id).verify(this.client(id), requestId))
      .then((result) => {
        if (!this.closed) this.emit(id, 'outbox', {})
        return result
      })
      .finally(() => this.checking.delete(key))
    this.checking.set(key, pending)
    return pending
  }
  start(id: string) {
    if (this.frozen.has(id) || this.connection(id).logout) return
    this.identified.delete(id)
    try {
      if (!this.credentials.get(`device/${id}/${this.connection(id).personId}`)) return
    } catch {
      this.emit(id, 'connection', { state: 'offline', code: 'credentials_unavailable' })
      return
    }
    this.streams.get(id)?.abort()
    const controller = new AbortController()
    this.streams.set(id, controller)
    void this.stream(id, controller)
    clearTimeout(this.retries.get(id))
    this.retry(id, 1000, controller)
  }
  private retry(id: string, delay: number, controller: AbortController) {
    if (
      this.closed ||
      controller.signal.aborted ||
      this.streams.get(id) !== controller ||
      this.frozen.has(id) ||
      !this.list().some((item) => item.characterId === id && !item.logout)
    )
      return
    this.retries.set(
      id,
      setTimeout(() => {
        if (controller.signal.aborted || this.streams.get(id) !== controller || this.closed) return
        for (const item of this.uploads(id)
          .list()
          .filter((item) => item.state !== 'ready' && item.state !== 'failed'))
          void this.retryUpload(id, item.requestId).catch(() => {})
        const work = this.box(id)
          .list()
          .filter(
            (item) =>
              item.state !== 'result' &&
              (!item.problem ||
                ['transport_unknown', 'unavailable', 'unknown'].includes(item.problem)),
          )
        void Promise.all([
          ...this.linkCodes(id)
            .list()
            .filter((item) => item.state !== 'result')
            .map((item) => this.verifyLinkCode(id, item.requestId).catch(() => {})),
          ...work.map((item) => this.verify(id, item.requestId).catch(() => {})),
          ...this.commands(id)
            .list()
            .filter((item) => item.state !== 'result')
            .map((item) => this.verifyWorkCommand(id, item.requestId).catch(() => {})),
        ]).finally(() => this.retry(id, Math.min(delay * 2, 60000), controller))
      }, delay),
    )
  }
  reconnect() {
    for (const item of this.list()) this.start(item.characterId)
  }
  private async stream(id: string, controller: AbortController) {
    let delay = 1000
    while (!controller.signal.aborted) {
      try {
        await this.identify(id)
        const client = this.client(id)
        await readStream(client, controller.signal, (kind, data) => {
          if (controller.signal.aborted || this.streams.get(id) !== controller) return
          if (kind === 'sync') {
            delay = 1000
            this.emit(id, 'connection', { state: 'online' })
          }
          if (['sync', 'conversation', 'work'].includes(kind)) {
            for (const item of this.linkCodes(id)
              .list()
              .filter((item) => item.state !== 'result'))
              void this.verifyLinkCode(id, item.requestId).catch(() => {})
            for (const item of this.soul(id)
              .list()
              .filter((item) => item.state !== 'result'))
              void this.verifySoulCommand(id, item.requestId).catch(() => {})
            for (const item of this.characterCommands(id)
              .list()
              .filter((item) => item.state !== 'result'))
              void this.verifyCharacterCommand(id, item.requestId).catch(() => {})
            for (const item of this.commands(id)
              .list()
              .filter((item) => item.state !== 'result'))
              void this.verifyWorkCommand(id, item.requestId).catch(() => {})
            for (const item of this.box(id)
              .list()
              .filter((item) => item.state !== 'result'))
              void this.verify(id, item.requestId).catch(() => {})
          }
          this.emit(id, kind, data)
        })
        if (!controller.signal.aborted) this.emit(id, 'connection', { state: 'offline' })
      } catch (error) {
        this.identified.delete(id)
        if (controller.signal.aborted) break
        const code = error instanceof ApiError ? error.code : 'transport_unknown'
        if (code === 'unauthenticated') {
          this.box(id).clearCache()
          await this.contentCache(id).clear()
        }
        this.emit(id, 'connection', { state: 'offline', code })
        if (
          [
            'unauthenticated',
            'different_character',
            'server_upgrade_required',
            'client_upgrade_required',
          ].includes(code)
        ) {
          break
        }
      }
      if (controller.signal.aborted) break
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          controller.signal.removeEventListener('abort', done)
          resolve()
        }
        const timer = setTimeout(done, delay)
        controller.signal.addEventListener('abort', done, { once: true })
      })
      delay = Math.min(delay * 2, 30000)
    }
  }
  suspendForUpdate() {
    const owned = this.list()
      .filter((item) => !this.frozen.has(item.characterId) && !item.logout)
      .map((item) => item.characterId)
    for (const id of owned) this.freeze(id)
    return { ids: owned, settled: Promise.all(owned.map((id) => this.drain(id))) }
  }
  resumeAfterUpdate(ids: string[]) {
    for (const id of ids) {
      this.frozen.delete(id)
      if (!this.closed && this.list().some((item) => item.characterId === id && !item.logout))
        this.start(id)
    }
  }
  close() {
    this.closed = true
    this.streams.forEach((controller) => controller.abort())
    this.retries.forEach((timer) => clearTimeout(timer))
    // Reads already in flight settle before their database is closed.
    return Promise.allSettled([
      ...[...this.activities.values()].flatMap((active) => [...active]),
      ...this.logouts.values(),
      ...[...this.finishes.values()].map((value) => value.work),
      ...this.avatarReads.values(),
      ...this.soulReads,
      ...this.checking.values(),
      ...[...this.uploadStores.values()].map((uploads) => uploads.settled()),
      ...[...this.commandStores.values()].map((commands) => commands.settle()),
      ...[...this.characterStores.values()].map((commands) => commands.settle()),
      ...[...this.soulStores.values()].map((soul) => soul.settled()),
      ...[...this.linkCodeStores.values()].map((codes) => codes.settled()),
    ]).then(() =>
      this.outboxes.forEach((box) => {
        if (box.db.open) box.db.close()
      }),
    )
  }
}
