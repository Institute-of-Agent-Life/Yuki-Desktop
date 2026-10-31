import { createHash, randomUUID } from 'node:crypto'
import type { Outbox } from './index'
import { ApiClient, ApiError } from '../api/client'
import { payloadHash } from './fingerprint'
import type {
  OriginalRequest,
  SoulCommand,
  SoulCommandItem,
  SoulDocument,
  SoulDraft,
  SoulEdit,
} from '../../shared/api'

const revision = (content: string) => `sha256:${createHash('sha256').update(content).digest('hex')}`
export function soulRequest(command: SoulCommand) {
  const reload = command.kind === 'reload'
  const payload = reload
    ? {}
    : { expected_revision: command.expectedRevision, content: command.content }
  return {
    target: reload ? 'character_soul:reload' : 'character_soul',
    path: reload ? 'character/soul/reload' : 'character/soul',
    method: reload ? ('POST' as const) : ('PUT' as const),
    hash: payloadHash(
      reload ? 'client.character_soul.reload' : 'client.character_soul',
      'soul',
      payload,
    ),
    payload,
  }
}

export class Soul {
  private pending = new Map<string, Promise<SoulCommandItem>>()
  private readVersion = 0
  captureRead() {
    return ++this.readVersion
  }
  constructor(readonly box: Outbox) {
    box.db
      .exec(`CREATE TABLE IF NOT EXISTS soul_draft(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS soul_commands(request_id TEXT PRIMARY KEY,command TEXT NOT NULL,
      hash TEXT NOT NULL,state TEXT NOT NULL,problem TEXT,result TEXT,details TEXT)`)
  }
  draft(): SoulDraft | null {
    const row = this.box.db.prepare('SELECT value FROM soul_draft WHERE id=1').get() as
      { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  }
  private put(draft: SoulDraft) {
    this.box.db
      .prepare(
        'INSERT INTO soul_draft VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(JSON.stringify(draft))
    return draft
  }
  observe(remote: SoulDocument, version = this.readVersion) {
    if (version !== this.readVersion) return this.draft()
    return this.box.db.transaction(() => {
      const previous = this.draft()
      const draft =
        previous && previous.draft !== previous.baseContent
          ? { ...previous, remote }
          : {
              baseRevision: remote.revision,
              baseContent: remote.content,
              draft: remote.content,
              remote,
            }
      this.put(draft)
      return draft
    })()
  }
  edit(edit: SoulEdit) {
    if (
      typeof edit.baseContent !== 'string' ||
      typeof edit.draft !== 'string' ||
      edit.baseRevision !== revision(edit.baseContent)
    )
      throw new ApiError('validation_error')
    const previous = this.draft()
    if (!previous) throw new ApiError('not_found')
    return this.put({ ...edit, remote: previous.remote })
  }
  get(id: string): SoulCommandItem {
    const row = this.box.db.prepare('SELECT * FROM soul_commands WHERE request_id=?').get(id) as
      | {
          command: string
          hash: string
          state: SoulCommandItem['state']
          problem: string | null
          result: string | null
          details: string | null
        }
      | undefined
    if (!row) throw new ApiError('not_found')
    return {
      requestId: id,
      command: JSON.parse(row.command),
      payloadHash: row.hash,
      state: row.state,
      problem: row.problem,
      result: row.result ? JSON.parse(row.result) : null,
      details: row.details ? JSON.parse(row.details) : null,
    }
  }
  list() {
    return (
      this.box.db.prepare('SELECT request_id FROM soul_commands ORDER BY rowid').all() as {
        request_id: string
      }[]
    ).map((row) => this.get(row.request_id))
  }
  prepare(command: SoulCommand) {
    if (
      command.kind !== 'reload' &&
      (command.kind !== 'save' ||
        typeof command.content !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(command.expectedRevision))
    )
      throw new ApiError('validation_error')
    const id = randomUUID()
    this.box.db
      .prepare("INSERT INTO soul_commands VALUES(?,?,?,'submitted',NULL,NULL,NULL)")
      .run(id, JSON.stringify(command), soulRequest(command).hash)
    return this.get(id)
  }
  private update(
    id: string,
    state: SoulCommandItem['state'],
    problem: string | null,
    result: SoulCommandItem['result'] = null,
    details: SoulCommandItem['details'] = null,
  ) {
    this.readVersion++
    this.box.db.transaction(() => {
      this.box.db
        .prepare('UPDATE soul_commands SET state=?,problem=?,result=?,details=? WHERE request_id=?')
        .run(
          state,
          problem,
          result ? JSON.stringify(result) : null,
          details ? JSON.stringify(details) : null,
          id,
        )
      const command = this.get(id).command,
        draft = this.draft()
      if (!draft) return
      const applied = result?.active_revision
      const matches =
        command.kind === 'save'
          ? draft.baseRevision === command.expectedRevision && draft.draft === command.content
          : this.list().some(
              (item) =>
                item.command.kind === 'save' &&
                item.details?.written === true &&
                item.command.content === draft.draft &&
                item.command.expectedRevision === draft.baseRevision,
            )
      if (!problem && result && matches && applied === revision(draft.draft))
        this.put({
          ...draft,
          baseContent: draft.draft,
          baseRevision: applied,
          remote: {
            ...draft.remote,
            content: draft.draft,
            revision: applied,
            active_revision: applied,
            updated_at: result.applied_at,
          },
        })
    })()
    return this.get(id)
  }
  run(client: ApiClient, id: string) {
    const previous = this.pending.get(id)
    if (previous) return previous
    this.readVersion++
    const work = this.dispatch(client, id).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }
  private async dispatch(client: ApiClient, id: string) {
    const item = this.get(id)
    if (item.state === 'result') return item
    try {
      await this.box.verifyOwner(client)
      const request = soulRequest(item.command),
        original = await client.get<OriginalRequest>(`requests/${id}`)
      if (original.found) {
        if (
          original.operation_kind !== 'control' ||
          original.target !== request.target ||
          original.payload_hash !== item.payloadHash
        )
          return this.update(id, 'result', 'request_conflict')
        if (original.status === 'succeeded' || original.status === 'failed') {
          const result = original.result as unknown as SoulCommandItem['result']
          if (original.status === 'succeeded') this.checkResult(item.command, result)
          return this.update(
            id,
            'result',
            original.problem_code ?? null,
            result,
            original.problem as SoulCommandItem['details'],
          )
        }
      }
      const result = await client.mutate<SoulCommandItem['result']>(
        request.path,
        { request_id: id, ...request.payload },
        request.method,
      )
      this.checkResult(item.command, result)
      return this.update(id, 'result', null, result)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'transport_unknown'
      const terminal = [
        'not_found',
        'unauthenticated',
        'owner_required',
        'forbidden',
        'outbox_owner_mismatch',
        'request_conflict',
        'version_conflict',
        'precondition_failed',
        'validation_error',
      ].includes(code)
      return this.update(
        id,
        terminal ? 'result' : 'submitted',
        code,
        null,
        error instanceof ApiError ? (error.details ?? null) : null,
      )
    }
  }
  private checkResult(command: SoulCommand, result: SoulCommandItem['result']) {
    if (
      !result ||
      typeof result.applied_at !== 'string' ||
      typeof result.active_revision !== 'string' ||
      (command.kind === 'save' && result.revision !== revision(command.content))
    )
      throw new ApiError('transport_unknown')
  }
  settled() {
    return Promise.allSettled(this.pending.values())
  }
}
