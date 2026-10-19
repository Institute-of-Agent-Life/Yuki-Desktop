import { createHash, randomUUID } from 'node:crypto'
import type { Outbox } from './index'
import { ApiClient, ApiError } from '../api/client'
import { payloadHash } from './fingerprint'
import { normalizeMessageText } from '../../shared/message'
import type {
  OriginalRequest,
  PromptCommand,
  PromptCommandItem,
  PromptDocument,
  PromptDocuments,
  PromptDraft,
  PromptEdit,
  PromptKey,
} from '../../shared/api'

const validKey = (key: string): key is PromptKey => ['system_prompt', 'persona'].includes(key)
const revision = (content: string) => `sha256:${createHash('sha256').update(content).digest('hex')}`
export function promptRequest(command: PromptCommand) {
  return command.kind === 'reload'
    ? {
        target: 'character_prompt:reload',
        path: 'character/prompts/reload',
        method: 'POST' as const,
        hash: payloadHash('client.character_prompt.reload', 'reload', {}),
        payload: {},
      }
    : {
        target: `character_prompt:${command.key}`,
        path: `character/prompts/${command.key}`,
        method: 'PUT' as const,
        hash: payloadHash('client.character_prompt', command.key, {
          expected_revision: command.expectedRevision,
          content: command.content,
        }),
        payload: { expected_revision: command.expectedRevision, content: command.content },
      }
}

export class Prompts {
  private pending = new Map<string, Promise<PromptCommandItem>>()
  private readVersion = 0
  captureRead() {
    return ++this.readVersion
  }
  constructor(readonly box: Outbox) {
    box.db.exec(`CREATE TABLE IF NOT EXISTS prompt_drafts(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS prompt_commands(request_id TEXT PRIMARY KEY,command TEXT NOT NULL,
      hash TEXT NOT NULL,state TEXT NOT NULL,problem TEXT,result TEXT,details TEXT)`)
  }
  drafts(): PromptDraft[] {
    return (
      this.box.db.prepare('SELECT value FROM prompt_drafts ORDER BY key').all() as {
        value: string
      }[]
    ).map((row) => JSON.parse(row.value))
  }
  private put(draft: PromptDraft) {
    this.box.db
      .prepare(
        'INSERT INTO prompt_drafts VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(draft.key, JSON.stringify(draft))
    return draft
  }
  observe(documents: PromptDocuments, version = this.readVersion) {
    if (version !== this.readVersion) return this.drafts()
    return this.box.db.transaction(() =>
      documents.documents.map((remote) => {
        const previous = this.drafts().find((item) => item.key === remote.key)
        return this.put(
          previous && previous.draft !== previous.baseContent
            ? { ...previous, remote }
            : {
                key: remote.key,
                baseRevision: remote.revision,
                baseContent: remote.content,
                draft: remote.content,
                remote,
              },
        )
      }),
    )()
  }
  edit(edit: PromptEdit) {
    if (
      !validKey(edit.key) ||
      typeof edit.baseContent !== 'string' ||
      typeof edit.draft !== 'string' ||
      edit.baseRevision !== revision(edit.baseContent)
    )
      throw new ApiError('validation_error')
    const previous = this.drafts().find((item) => item.key === edit.key)
    if (!previous) throw new ApiError('not_found')
    // The editor supplies its captured baseline even if a clean remote read just advanced SQLite.
    return this.put({ ...edit, remote: previous.remote })
  }
  get(id: string): PromptCommandItem {
    const row = this.box.db.prepare('SELECT * FROM prompt_commands WHERE request_id=?').get(id) as
      | {
          request_id: string
          command: string
          hash: string
          state: PromptCommandItem['state']
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
      this.box.db.prepare('SELECT request_id FROM prompt_commands ORDER BY rowid').all() as {
        request_id: string
      }[]
    ).map((row) => this.get(row.request_id))
  }
  prepare(command: PromptCommand) {
    if (
      command.kind !== 'reload' &&
      (command.kind !== 'save' ||
        !validKey(command.key) ||
        !/^sha256:[a-f0-9]{64}$/.test(command.expectedRevision) ||
        typeof command.content !== 'string' ||
        !normalizeMessageText(command.content))
    )
      throw new ApiError('validation_error')
    const request = promptRequest(command)
    const previous = this.list().find(
      (item) => item.state === 'submitted' && promptRequest(item.command).target === request.target,
    )
    if (previous) {
      if (previous.payloadHash === request.hash) return previous
      throw new ApiError('precondition_failed')
    }
    const id = randomUUID()
    this.box.db
      .prepare("INSERT INTO prompt_commands VALUES(?,?,?,'submitted',NULL,NULL,NULL)")
      .run(id, JSON.stringify(command), request.hash)
    return this.get(id)
  }
  private update(
    id: string,
    state: PromptCommandItem['state'],
    problem: string | null,
    result: PromptCommandItem['result'] = null,
    details: PromptCommandItem['details'] = null,
  ) {
    this.readVersion++
    this.box.db.transaction(() => {
      this.box.db
        .prepare(
          'UPDATE prompt_commands SET state=?,problem=?,result=?,details=? WHERE request_id=?',
        )
        .run(
          state,
          problem,
          result ? JSON.stringify(result) : null,
          details ? JSON.stringify(details) : null,
          id,
        )
      const command = this.get(id).command
      if (command.kind === 'reload') {
        if (!problem && result && 'active' in result)
          for (const draft of this.drafts()) {
            const written = this.list().some(
              (item) =>
                item.command.kind === 'save' &&
                item.problem &&
                item.details?.written === true &&
                item.command.key === draft.key &&
                item.command.expectedRevision === draft.baseRevision &&
                item.command.content === draft.draft,
            )
            const appliedRevision = result.active[draft.key]
            if (written && appliedRevision === revision(draft.draft))
              this.put({
                ...draft,
                baseContent: draft.draft,
                baseRevision: appliedRevision,
                remote: {
                  ...draft.remote,
                  content: draft.draft,
                  revision: appliedRevision,
                  updated_at: result.applied_at,
                },
              })
          }
        return
      }
      const draft = this.drafts().find((item) => item.key === command.key)
      const remote = details?.current as PromptDocument | undefined
      if (draft && remote?.key === command.key) this.put({ ...draft, remote })
      if (
        draft &&
        !problem &&
        result &&
        'revision' in result &&
        draft.baseRevision === command.expectedRevision &&
        draft.draft === command.content
      ) {
        this.put({
          ...draft,
          baseRevision: result.revision,
          baseContent: command.content,
          remote: {
            ...draft.remote,
            content: command.content,
            revision: result.revision,
            updated_at: result.applied_at,
          },
        })
      }
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
      const request = promptRequest(item.command)
      const original = await client.get<OriginalRequest>(`requests/${id}`)
      if (original.found) {
        if (
          original.operation_kind !== 'control' ||
          original.target !== request.target ||
          original.payload_hash !== item.payloadHash
        )
          return this.update(id, 'result', 'request_conflict')
        if (original.status === 'succeeded' || original.status === 'failed') {
          const result = original.result as unknown as PromptCommandItem['result']
          if (original.status === 'succeeded') this.checkResult(item.command, result)
          return this.update(
            id,
            'result',
            original.problem_code ?? null,
            result,
            original.problem as PromptCommandItem['details'],
          )
        }
        // Running/unknown control receipts resume A/B/C/D using this exact UUID and body.
      }
      const result = await client.mutate<PromptCommandItem['result']>(
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
  private checkResult(command: PromptCommand, result: PromptCommandItem['result']) {
    if (
      !result ||
      typeof result.applied_at !== 'string' ||
      !Array.isArray(result.warnings) ||
      (command.kind === 'save'
        ? !('revision' in result) || result.revision !== revision(command.content)
        : !('active' in result) ||
          typeof result.active?.persona !== 'string' ||
          typeof result.active?.system_prompt !== 'string')
    )
      throw new ApiError('transport_unknown')
  }
  settled() {
    return Promise.allSettled(this.pending.values())
  }
}
