import { join } from 'node:path'
import type {
  ApiRead,
  AttachmentSource,
  ArtifactSource,
  Connection,
  ComputerCommand,
  EventsPage,
  Me,
  Meta,
  OutboxItem,
  WorkCommand,
} from '../shared/api'
import { REQUIRED_API_REVISION } from '../shared/api'
import { ApiClient, ApiError, normalizeServer } from './api/client'
import { meetsMinimum } from '../shared/version'
import { readStream } from './api/stream'
import { Credentials } from './credentials'
import { Outbox } from './outbox'
import { WorkCommands } from './outbox/work-commands'
import { ComputerCommands } from './outbox/computer-commands'
import { ComputerTickets } from './computer-tickets'
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
  readonly credentials: Credentials
  private readonly outboxes = new Map<string, Outbox>()
  private readonly streams = new Map<string, AbortController>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly checking = new Map<string, Promise<OutboxItem>>()
  private readonly identified = new Map<string, Promise<void>>()
  private readonly states = new Map<string, unknown>()
  private readonly uploadStores = new Map<Outbox, Uploads>()
  private readonly commandStores = new Map<Outbox, WorkCommands>()
  private readonly computerStores = new Map<Outbox, ComputerCommands>()
  readonly computerTickets = new ComputerTickets()
  private closed = false
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
  computerCommands(id: string) {
    const box = this.box(id)
    let commands = this.computerStores.get(box)
    if (!commands) {
      commands = new ComputerCommands(box)
      this.computerStores.set(box, commands)
    }
    return commands
  }
  async computerCommand(id: string, command: ComputerCommand) {
    await this.identify(id)
    const client = this.client(id)
    await this.box(id).verifyOwner(client)
    const commands = this.computerCommands(id)
    const item = commands.prepare(command)
    const result = await commands.run(client, item.requestId)
    this.emit(id, 'computer-command', {})
    return result
  }
  async verifyComputerCommand(id: string, requestId: string) {
    await this.identify(id)
    const result = await this.computerCommands(id).run(this.client(id), uuid(requestId), true)
    this.emit(id, 'computer-command', {})
    return result
  }
  async computerTicket(id: string) {
    await this.identify(id)
    await this.box(id).verifyOwner(this.client(id))
    return this.computerTickets.issue(this.client(id))
  }
  async computerFile(id: string, path: string) {
    await this.identify(id)
    await this.box(id).verifyOwner(this.client(id))
    const cache = new ContentCache(join(this.contentCache(id).root, 'computer'))
    const item = await cache.download(
      this.client(id),
      `computer/files/content?${new URLSearchParams({ path })}`,
    )
    return { ...item, cache }
  }
  async workCommand(id: string, command: WorkCommand) {
    uuid(command.workId)
    const commands = this.commands(id),
      client = this.client(id)
    const draftSnapshot = commands.draft(command.workId)
    let offline = false
    try {
      await this.identify(id)
      await this.box(id).verifyOwner(client)
    } catch (error) {
      if (error instanceof ApiError && ['transport_unknown', 'unavailable'].includes(error.code))
        offline = true
      else throw error
    }
    const item = commands.prepare(command, offline ? 'draft' : 'submitted', draftSnapshot)
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
    return new ContentCache(
      join(this.root, 'connections', uuid(id), 'cache', uuid(this.connection(id).personId)),
    )
  }
  async artifact(id: string, source: ArtifactSource) {
    const identity = artifactIdentity(source.artifactId)
    if (!/^[a-f0-9]{64}$/.test(source.version)) throw new ApiError('validation_error')
    await this.identify(id)
    const cache = new ContentCache(join(this.contentCache(id).root, 'artifacts'))
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
    return {
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
    if (attachment.availability !== 'available') {
      if (previous) await cache.remove(previous)
      throw new ApiError(
        'media_unavailable',
        attachment.availability === 'expired' ? 'expired' : 'source_unavailable',
      )
    }
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
      typeof meta.min_client?.desktop !== 'string'
    )
      throw new ApiError('invalid_response')
    uuid(meta.character.id)
    if (meta.api_revision < REQUIRED_API_REVISION) throw new ApiError('server_upgrade_required')
    const compatible = meetsMinimum(this.version, meta.min_client.desktop)
    if (compatible === null) throw new ApiError('invalid_response')
    if (!compatible) throw new ApiError('client_upgrade_required')
    return meta
  }
  private identify(id: string) {
    let pending = this.identified.get(id)
    if (!pending) {
      pending = this.meta(this.connection(id).baseUrl)
        .then((meta) => {
          if (meta.character.id !== id) throw new ApiError('different_character')
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
    const baseUrl = normalizeServer(server),
      meta = await this.meta(baseUrl)
    const paired = await new ApiClient(baseUrl, undefined, undefined, this.version).post<{
      device_id: string
      token: string
    }>('pair', { code, device_label: label })
    let me = await new ApiClient(baseUrl, paired.token, undefined, this.version).get<Me>('me')
    const characterId = uuid(meta.character.id)
    const existing = this.list().find((item) => item.characterId === characterId)
    if (existing) {
      try {
        // A merged Person's new token may default to another App binding. Prove
        // access to the original owner namespace before touching its local data.
        me = await new ApiClient(baseUrl, paired.token, existing.bindingId, this.version).get<Me>(
          'me',
        )
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
        await new ApiClient(baseUrl, paired.token, undefined, this.version).response(
          `devices/${uuid(paired.device_id)}`,
          { method: 'DELETE' },
        )
        if (
          error instanceof ApiError &&
          ['not_found', 'different_person', 'outbox_owner_mismatch'].includes(error.code)
        )
          throw new ApiError('different_person')
        throw error
      }
    }
    const persistentCredentials = this.credentials.set(
      `device/${characterId}/${me.request_person_id}`,
      paired.token,
    )
    const connection: Connection = {
      characterId,
      baseUrl,
      name: meta.character.display_name,
      personId: uuid(me.request_person_id),
      bindingId: uuid(me.binding_id),
      conversationId: uuid(me.conversation_id),
      persistentCredentials,
      deviceId: uuid(paired.device_id),
    }
    this.store.set('connections', [
      ...this.list().filter((item) => item.characterId !== characterId),
      connection,
    ])
    this.start(characterId)
    return connection
  }
  async read<T>(id: string, route: ApiRead, offlineCache = true): Promise<T> {
    let path: string
    if (route.kind === 'me' || route.kind === 'character' || route.kind === 'computer')
      path = route.kind
    else if (route.kind === 'computer-files') {
      const params = new URLSearchParams({ path: route.path })
      if (route.cursor) params.set('cursor', route.cursor)
      path = `computer/files?${params}`
    } else if (route.kind === 'home') path = 'home?works=active'
    else if (route.kind === 'request') path = `requests/${uuid(route.requestId)}`
    else if (route.kind === 'work') path = `works/${uuid(route.workId)}`
    else if (route.kind === 'activity')
      path = `activity?conversation_id=${uuid(route.conversationId)}`
    else if (route.kind === 'works') {
      const params = new URLSearchParams({ group: route.group, origin: route.origin, limit: '50' })
      if (route.before) params.set('before', route.before)
      path = `works?${params}`
    } else if (route.kind === 'steps') {
      const params = new URLSearchParams({ limit: '100' })
      if (route.after) params.set('after', route.after)
      path = `works/${uuid(route.workId)}/steps?${params}`
    } else if (route.kind === 'artifacts') {
      const params = new URLSearchParams({ kind: route.category, limit: '50' })
      if (route.cursor) params.set('cursor', route.cursor)
      path = `artifacts?${params}`
    } else if (route.kind === 'events') {
      const query = new URLSearchParams({ limit: route.limit === 1 ? '1' : '50' })
      if (route.after !== undefined) query.set('after', String(route.after))
      if (route.before !== undefined) query.set('before', String(route.before))
      path = `conversations/${uuid(route.conversationId)}/events?${query}`
    } else throw new ApiError('validation_error')
    const box = this.box(id)
    try {
      await this.identify(id)
      const value = await this.client(id).get<T>(path)
      if (route.kind !== 'me' && route.kind !== 'request') box.cache(path, value)
      return value
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'owner_required' && route.kind.startsWith('computer')) {
          box.db
            .prepare("DELETE FROM read_cache WHERE key='computer' OR key GLOB 'computer/*'")
            .run()
          await new ContentCache(join(this.contentCache(id).root, 'computer')).clear()
        }
        if (['unauthenticated', 'not_found', 'outbox_owner_mismatch'].includes(error.code)) {
          box.clearCache()
          await this.contentCache(id).clear()
        }
        if (['transport_unknown', 'unavailable'].includes(error.code)) {
          this.emit(id, 'connection', { state: 'offline', code: error.code })
          const cached =
            offlineCache && !route.kind.startsWith('computer') ? box.cached<T>(path) : undefined
          if (cached !== undefined) return cached
        }
      }
      throw error
    }
  }
  async send(id: string, text: string, uploadIds: string[] = []): Promise<OutboxItem> {
    const box = this.box(id),
      client = this.client(id),
      draftSnapshot = box.draft()
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
    this.retry(id, 1000)
  }
  private retry(id: string, delay: number) {
    if (this.closed) return
    this.retries.set(
      id,
      setTimeout(() => {
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
          ...work.map((item) => this.verify(id, item.requestId).catch(() => {})),
          ...this.commands(id)
            .list()
            .filter((item) => item.state !== 'result')
            .map((item) => this.verifyWorkCommand(id, item.requestId).catch(() => {})),
        ]).finally(() => this.retry(id, Math.min(delay * 2, 60000)))
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
          if (kind === 'sync') {
            delay = 1000
            this.emit(id, 'connection', { state: 'online' })
          }
          if (['sync', 'conversation', 'work'].includes(kind)) {
            for (const item of this.computerCommands(id)
              .list()
              .filter((item) => item.state !== 'result'))
              void this.verifyComputerCommand(id, item.requestId).catch(() => {})
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
        )
          break
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
  close() {
    this.closed = true
    this.streams.forEach((controller) => controller.abort())
    this.retries.forEach((timer) => clearTimeout(timer))
    // Reads already in flight settle before their database is closed.
    void Promise.allSettled([
      ...this.checking.values(),
      ...[...this.uploadStores.values()].map((uploads) => uploads.settled()),
      ...[...this.commandStores.values()].map((commands) => commands.settle()),
    ]).then(() => this.outboxes.forEach((box) => box.db.close()))
  }
}
