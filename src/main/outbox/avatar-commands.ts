import { createHash, randomUUID } from 'node:crypto'
import type { AvatarCommandItem, OriginalRequest, Profile } from '../../shared/api'
import type { Outbox } from './index'
import { ApiClient, ApiError } from '../api/client'
import { payloadHash } from './fingerprint'

const terminal = new Set([
  'not_found',
  'unauthenticated',
  'owner_required',
  'outbox_owner_mismatch',
  'request_conflict',
  'version_conflict',
  'precondition_failed',
  'validation_error',
  'unsupported_image',
  'image_dimensions',
])
export class AvatarCommands {
  private pending = new Map<string, Promise<AvatarCommandItem>>()
  constructor(readonly box: Outbox) {
    box.db.exec(`CREATE TABLE IF NOT EXISTS avatar_commands(request_id TEXT PRIMARY KEY,
      action TEXT NOT NULL, expected_revision INTEGER NOT NULL, sha256 TEXT, size INTEGER,
      hash TEXT NOT NULL, png BLOB, state TEXT NOT NULL, problem TEXT, result TEXT, current TEXT);
      CREATE TABLE IF NOT EXISTS avatar_command_acknowledgements(request_id TEXT PRIMARY KEY)`)
  }
  get(id: string): AvatarCommandItem {
    const row = this.box.db
      .prepare(
        'SELECT request_id,action,expected_revision,sha256,size,hash,state,problem,result,current,EXISTS(SELECT 1 FROM avatar_command_acknowledgements ack WHERE ack.request_id=avatar_commands.request_id) AS acknowledged FROM avatar_commands WHERE request_id=?',
      )
      .get(id) as
      | {
          request_id: string
          action: AvatarCommandItem['action']
          expected_revision: number
          sha256: string | null
          size: number | null
          hash: string
          state: AvatarCommandItem['state']
          problem: string | null
          result: string | null
          current: string | null
          acknowledged: number
        }
      | undefined
    if (!row) throw new ApiError('not_found')
    return {
      requestId: id,
      action: row.action,
      expectedRevision: row.expected_revision,
      sha256: row.sha256,
      size: row.size,
      payloadHash: row.hash,
      state: row.state,
      problem: row.problem,
      result: row.result ? JSON.parse(row.result) : null,
      current: row.current ? JSON.parse(row.current) : null,
      acknowledged: !!row.acknowledged,
    }
  }
  list() {
    return (
      this.box.db.prepare('SELECT request_id FROM avatar_commands ORDER BY rowid').all() as {
        request_id: string
      }[]
    ).map((row) => this.get(row.request_id))
  }
  draft(id: string) {
    const item = this.get(id)
    if (item.action === 'reset') return null
    const row = this.box.db
      .prepare('SELECT png FROM avatar_commands WHERE request_id=?')
      .get(id) as { png: Buffer }
    if (createHash('sha256').update(row.png).digest('hex') !== item.sha256)
      throw new ApiError('content_hash_mismatch')
    return { filename: '這次更新.png', bytes: new Uint8Array(row.png) }
  }
  acknowledge(id: string) {
    if (this.get(id).state !== 'result') throw new ApiError('precondition_failed')
    this.box.db.prepare('INSERT OR IGNORE INTO avatar_command_acknowledgements VALUES(?)').run(id)
  }
  prepare(expectedRevision: number, bytes?: Uint8Array) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new ApiError('validation_error')
    if (
      bytes !== undefined &&
      (!(bytes instanceof Uint8Array) ||
        bytes.length < 24 ||
        Buffer.from(bytes.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a')
    )
      throw new ApiError('unsupported_image')
    if (
      bytes &&
      (Buffer.from(bytes).readUInt32BE(16) !== 1024 || Buffer.from(bytes).readUInt32BE(20) !== 1024)
    )
      throw new ApiError('image_dimensions')
    const action = bytes ? 'set' : 'reset',
      sha = bytes ? createHash('sha256').update(bytes).digest('hex') : null,
      size = bytes?.byteLength ?? null
    const hash = payloadHash('client.character_avatar', action, {
      expected_revision: expectedRevision,
      sha256: sha,
      size,
    })
    const previous = this.box.db
      .prepare(
        "SELECT request_id FROM avatar_commands WHERE hash=? AND state='submitted' ORDER BY rowid LIMIT 1",
      )
      .get(hash) as { request_id: string } | undefined
    if (previous) return this.get(previous.request_id)
    const id = randomUUID()
    this.box.db
      .prepare("INSERT INTO avatar_commands VALUES(?,?,?,?,?,?,?,'submitted',NULL,NULL,NULL)")
      .run(id, action, expectedRevision, sha, size, hash, bytes ? Buffer.from(bytes) : null)
    return this.get(id)
  }
  private update(
    id: string,
    state: AvatarCommandItem['state'],
    problem: string | null,
    result: Profile | null = null,
    current: Profile | null = null,
  ) {
    this.box.db
      .prepare('UPDATE avatar_commands SET state=?,problem=?,result=?,current=? WHERE request_id=?')
      .run(
        state,
        problem,
        result ? JSON.stringify(result) : null,
        current ? JSON.stringify(current) : null,
        id,
      )
    return this.get(id)
  }
  run(client: ApiClient, id: string, verify = true) {
    const previous = this.pending.get(id)
    if (previous) return previous
    const work = this.dispatch(client, id, verify).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }
  private async dispatch(client: ApiClient, id: string, verify: boolean) {
    const item = this.get(id)
    if (item.state === 'result') return item
    try {
      await this.box.verifyOwner(client)
      if (verify) {
        const original = await client.get<OriginalRequest>(`requests/${id}`)
        if (original.found) {
          if (
            original.operation_kind !== 'client.character_avatar' ||
            original.target !== this.box.owner.characterId ||
            original.payload_hash !== item.payloadHash
          )
            return this.update(id, 'result', 'request_conflict')
          return this.update(
            id,
            original.status === 'succeeded' || original.status === 'failed'
              ? 'result'
              : 'submitted',
            original.problem_code ?? null,
            original.result as Profile | null,
          )
        }
      }
      let result: Profile
      if (item.action === 'reset')
        result = await client.mutate<Profile>(
          'character/avatar',
          { request_id: id, expected_revision: item.expectedRevision },
          'DELETE',
        )
      else {
        const row = this.box.db
          .prepare('SELECT png FROM avatar_commands WHERE request_id=?')
          .get(id) as { png: Buffer }
        if (createHash('sha256').update(row.png).digest('hex') !== item.sha256)
          throw new ApiError('content_hash_mismatch')
        const params = new URLSearchParams({
          request_id: id,
          expected_revision: String(item.expectedRevision),
          sha256: item.sha256!,
          size: String(item.size),
        })
        const response = await client.response(`character/avatar?${params}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: Uint8Array.from(row.png).buffer,
        })
        try {
          result = ((await response.json()) as { data: Profile }).data
        } catch {
          throw new ApiError('transport_unknown')
        }
      }
      if (!result) throw new ApiError('transport_unknown')
      return this.update(id, 'result', null, result)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'transport_unknown'
      return this.update(
        id,
        terminal.has(code) || code === 'content_hash_mismatch' ? 'result' : 'submitted',
        code,
        null,
        error instanceof ApiError
          ? ((error.details?.current as Profile | undefined) ?? null)
          : null,
      )
    }
  }
  settle() {
    return Promise.allSettled(this.pending.values())
  }
}
