import Database from 'better-sqlite3'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Me, MessageResult, OriginalRequest, OutboxItem, OutboxOwner } from '../../shared/api'
import { ApiClient, ApiError } from '../api/client'
import { payloadHash } from './fingerprint'
import { normalizeMessageText } from '../../shared/message'

interface Row {
  request_id: string
  body: string
  hash: string
  state: OutboxItem['state']
  event_id: number | null
  problem: string | null
  created: number
}
export class Outbox {
  readonly db: Database.Database
  constructor(
    path: string,
    readonly owner: OutboxOwner,
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new Database(path)
    chmodSync(path, 0o600)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests(request_id TEXT PRIMARY KEY,body TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL,event_id INTEGER,problem TEXT,created REAL NOT NULL); CREATE TABLE IF NOT EXISTS draft(id INTEGER PRIMARY KEY CHECK(id=1),text TEXT NOT NULL)',
    )
    this.db.exec('CREATE TABLE IF NOT EXISTS read_cache(key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const encoded = JSON.stringify(owner)
    this.db.prepare('INSERT OR IGNORE INTO owner VALUES(1,?)').run(encoded)
    if (
      (this.db.prepare('SELECT value FROM owner WHERE id=1').get() as { value: string }).value !==
      encoded
    )
      throw new ApiError('outbox_owner_mismatch')
  }
  list() {
    return (
      this.db.prepare('SELECT * FROM requests ORDER BY created,request_id').all() as Row[]
    ).map((row) => this.item(row))
  }
  item(row: Row): OutboxItem {
    return {
      requestId: row.request_id,
      body: JSON.parse(row.body),
      payloadHash: row.hash,
      state: row.state,
      eventId: row.event_id,
      problem: row.problem,
      createdAt: row.created,
    }
  }
  get(id: string) {
    const row = this.db.prepare('SELECT * FROM requests WHERE request_id=?').get(id) as
      Row | undefined
    if (!row) throw new ApiError('not_found')
    return this.item(row)
  }
  prepare(
    text: string,
    state: 'submitted' | 'draft' = 'submitted',
    draftSnapshot = this.draft(),
    attachments: string[] = [],
    linkUploads: () => void = () => {},
  ) {
    const id = randomUUID(),
      body = { request_id: id, text: normalizeMessageText(text), attachments }
    if (!body.text && !attachments.length) throw new ApiError('validation_error')
    const hash = payloadHash('message', this.owner.conversationId, {
      text: body.text,
      attachments: body.attachments,
    })
    return this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO requests VALUES(?,?,?,?,NULL,NULL,?)')
        .run(id, JSON.stringify(body), hash, state, Date.now())
      if (this.draft() === draftSnapshot) this.draft('')
      linkUploads()
      return this.get(id)
    })()
  }
  update(
    id: string,
    state: OutboxItem['state'],
    eventId: number | null = null,
    problem: string | null = null,
  ) {
    this.db
      .prepare(
        'UPDATE requests SET state=?,event_id=coalesce(?,event_id),problem=? WHERE request_id=?',
      )
      .run(state, eventId, problem, id)
    return this.get(id)
  }
  draft(text?: string) {
    if (text !== undefined)
      this.db
        .prepare('INSERT INTO draft VALUES(1,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text')
        .run(text)
    return (
      (this.db.prepare('SELECT text FROM draft WHERE id=1').get() as { text: string } | undefined)
        ?.text ?? ''
    )
  }
  cached<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM read_cache WHERE key=?').get(key) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : undefined
  }
  cache(key: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO read_cache VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value))
  }
  clearCache() {
    this.db.prepare('DELETE FROM read_cache').run()
  }
  async verifyOwner(client: ApiClient) {
    const me = await client.get<Me>('me')
    const binding = me.bindings.find(
      (binding) => binding.binding_id === this.owner.bindingId && binding.platform === 'app',
    )
    if (
      !binding ||
      binding.source_person_id !== this.owner.personId ||
      me.conversation_id !== this.owner.conversationId ||
      me.request_person_id !== this.owner.personId
    )
      throw new ApiError('outbox_owner_mismatch')
  }
  async send(client: ApiClient, id: string): Promise<OutboxItem> {
    const row = this.get(id)
    if (row.state !== 'submitted' && row.state !== 'draft') return row
    try {
      await this.verifyOwner(client)
      if (row.state === 'draft') this.update(id, 'submitted')
      const result = await client.post<MessageResult>('messages', row.body)
      return this.update(id, 'accepted', result.event_id)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'transport_unknown'
      return this.update(
        id,
        code === 'request_conflict' || code === 'not_found' || code === 'precondition_failed'
          ? 'result'
          : 'submitted',
        null,
        code,
      )
    }
  }
  async verify(client: ApiClient, id: string): Promise<OutboxItem> {
    const row = this.get(id)
    try {
      await this.verifyOwner(client)
      if (row.state === 'draft') return this.send(client, id)
      const original = await client.get<OriginalRequest>(`requests/${encodeURIComponent(id)}`)
      if (!original.found)
        return row.state === 'submitted' &&
          !['not_found', 'outbox_owner_mismatch', 'request_conflict'].includes(row.problem ?? '')
          ? this.send(client, id)
          : row
      if (
        original.payload_hash !== row.payloadHash ||
        original.operation_kind !== 'message' ||
        original.target !== this.owner.conversationId
      )
        return this.update(id, 'result', null, 'request_conflict')
      const terminal = original.turn?.state === 'ended'
      return this.update(
        id,
        terminal ? 'result' : 'accepted',
        original.event_id ?? null,
        original.problem_code ?? null,
      )
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'transport_unknown'
      return this.update(id, row.state, null, code)
    }
  }
}
