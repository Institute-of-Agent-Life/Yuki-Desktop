import { join } from 'node:path'
import type { ApiRead, Connection, Me, Meta, OutboxItem } from '../shared/api'
import { REQUIRED_API_REVISION } from '../shared/api'
import { ApiClient, ApiError, normalizeServer } from './api/client'
import { meetsMinimum } from '../shared/version'
import { readStream } from './api/stream'
import { Credentials } from './credentials'
import { Outbox } from './outbox'
import type { LocalStore } from './store'

const uuid = (value: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new ApiError('invalid_response')
  return value
}

export class Connections {
  readonly credentials: Credentials
  private readonly outboxes = new Map<string, Outbox>()
  private readonly streams = new Map<string, AbortController>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly checking = new Map<string, Promise<OutboxItem>>()
  private readonly identified = new Map<string, Promise<void>>()
  private readonly states = new Map<string, unknown>()
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
    return this.list().map((connection) => {
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
  async read<T>(id: string, route: ApiRead): Promise<T> {
    let path: string
    if (route.kind === 'me' || route.kind === 'character') path = route.kind
    else if (route.kind === 'home') path = 'home?works=active'
    else if (route.kind === 'request') path = `requests/${uuid(route.requestId)}`
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
      if (route.kind !== 'me' && route.kind !== 'request') box.cache(path, value)
      return value
    } catch (error) {
      if (error instanceof ApiError) {
        if (['unauthenticated', 'not_found', 'outbox_owner_mismatch'].includes(error.code))
          box.clearCache()
        if (['transport_unknown', 'unavailable'].includes(error.code)) {
          this.emit(id, 'connection', { state: 'offline', code: error.code })
          const cached = box.cached<T>(path)
          if (cached !== undefined) return cached
        }
      }
      throw error
    }
  }
  async send(id: string, text: string): Promise<OutboxItem> {
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
    const item = box.prepare(text, offline ? 'draft' : 'submitted', draftSnapshot)
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
        const work = this.box(id)
          .list()
          .filter(
            (item) =>
              item.state !== 'result' &&
              (!item.problem ||
                ['transport_unknown', 'unavailable', 'unknown'].includes(item.problem)),
          )
        void Promise.all(
          work.map((item) => this.verify(id, item.requestId).catch(() => {})),
        ).finally(() => this.retry(id, Math.min(delay * 2, 60000)))
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
            for (const item of this.box(id)
              .list()
              .filter((item) => item.state !== 'result'))
              void this.verify(id, item.requestId).catch(() => {})
          }
          this.emit(id, kind, data)
        })
      } catch (error) {
        this.identified.delete(id)
        if (controller.signal.aborted) break
        const code = error instanceof ApiError ? error.code : 'transport_unknown'
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
    void Promise.allSettled(this.checking.values()).then(() =>
      this.outboxes.forEach((box) => box.db.close()),
    )
  }
}
