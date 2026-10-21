import { randomUUID } from 'node:crypto'
import type { LinkCodeReply, LinkCodeRequest, OriginalRequest } from '../../shared/api'
import type { components } from '../../shared/contract.gen'
import { ApiClient, ApiError } from '../api/client'
import type { Outbox } from './index'
import { payloadHash } from './fingerprint'

type Issued = components['schemas']['LinkCode']
const terminal = new Set([
  'not_found',
  'unauthenticated',
  'outbox_owner_mismatch',
  'request_conflict',
  'validation_error',
  'precondition_failed',
])
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
function metadata(value: unknown): NonNullable<LinkCodeRequest['result']> {
  const result = value as Partial<Issued> | null
  if (
    !result ||
    !uuid(result.code_id) ||
    typeof result.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(result.expires_at))
  )
    throw new ApiError('invalid_response')
  return { code_id: result.code_id, expires_at: result.expires_at }
}
export class LinkCodes {
  private readonly pending = new Map<string, Promise<LinkCodeReply>>()
  constructor(readonly box: Outbox) {
    box.db.exec(
      'CREATE TABLE IF NOT EXISTS link_code_commands(request_id TEXT PRIMARY KEY, hash TEXT NOT NULL, state TEXT NOT NULL, problem TEXT, result TEXT)',
    )
  }
  get(id: string): LinkCodeRequest {
    const row = this.box.db
      .prepare('SELECT * FROM link_code_commands WHERE request_id=?')
      .get(id) as
      | {
          request_id: string
          hash: string
          state: LinkCodeRequest['state']
          problem: string | null
          result: string | null
        }
      | undefined
    if (!row) throw new ApiError('not_found')
    return {
      requestId: row.request_id,
      payloadHash: row.hash,
      state: row.state,
      problem: row.problem,
      result: row.result ? JSON.parse(row.result) : null,
    }
  }
  list() {
    return (
      this.box.db.prepare('SELECT request_id FROM link_code_commands ORDER BY rowid').all() as {
        request_id: string
      }[]
    ).map((row) => this.get(row.request_id))
  }
  prepare() {
    const id = randomUUID(),
      hash = payloadHash('client.link_code', this.box.owner.personId, {
        source_binding_id: this.box.owner.bindingId,
      })
    this.box.db
      .prepare("INSERT INTO link_code_commands VALUES(?,?,'submitted',NULL,NULL)")
      .run(id, hash)
    return this.get(id)
  }
  private update(
    id: string,
    state: LinkCodeRequest['state'],
    problem: string | null,
    result: LinkCodeRequest['result'] = null,
  ) {
    // Never serialize the raw response or error details: an issued code is a secret.
    this.box.db
      .prepare('UPDATE link_code_commands SET state=?,problem=?,result=? WHERE request_id=?')
      .run(
        state,
        problem,
        result ? JSON.stringify({ code_id: result.code_id, expires_at: result.expires_at }) : null,
        id,
      )
    return this.get(id)
  }
  run(client: ApiClient, id: string) {
    const existing = this.pending.get(id)
    if (existing) return existing
    const work = this.dispatch(client, id).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }
  private async dispatch(client: ApiClient, id: string): Promise<LinkCodeReply> {
    const item = this.get(id)
    if (item.state === 'result') return { request: item, code: null }
    try {
      await this.box.verifyOwner(client)
      const receipt = await client.get<OriginalRequest>(`requests/${id}`)
      if (receipt.found) {
        if (
          receipt.operation_kind !== 'client.link_code' ||
          receipt.payload_hash !== item.payloadHash
        )
          throw new ApiError('request_conflict')
        if (receipt.status === 'succeeded') {
          const result = metadata(receipt.result)
          if (receipt.target !== result.code_id) throw new ApiError('request_conflict')
          return { request: this.update(id, 'result', null, result), code: null }
        }
        return {
          request: this.update(
            id,
            receipt.status === 'failed' ? 'result' : 'submitted',
            receipt.problem_code ?? null,
          ),
          code: null,
        }
      }
      const result = await client.post<Issued>('link-codes', { request_id: id }),
        safe = metadata(result)
      if (
        (result.request_id && result.request_id !== id) ||
        typeof result.replay !== 'boolean' ||
        (result.code !== null &&
          (typeof result.code !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(result.code))) ||
        (result.replay && result.code !== null)
      )
        throw new ApiError('invalid_response')
      return { request: this.update(id, 'result', null, safe), code: result.code }
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'transport_unknown'
      return {
        request: this.update(id, terminal.has(code) ? 'result' : 'submitted', code),
        code: null,
      }
    }
  }
  settled() {
    return Promise.allSettled(this.pending.values())
  }
}
