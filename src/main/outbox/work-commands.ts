import { randomUUID } from 'node:crypto'
import type {
  OriginalRequest,
  WorkCommand,
  WorkCommandItem,
  WorkDraftQuestion,
  WorkQuestionDraft,
} from '../../shared/api'
import { normalizeMessageText } from '../../shared/message'
import { ApiClient, ApiError } from '../api/client'
import type { Outbox } from './index'
import { payloadHash } from './fingerprint'

interface Row {
  request_id: string
  command: string
  hash: string
  state: WorkCommandItem['state']
  result: string | null
  problem: string | null
  created: number
}
const terminalProblems = new Set([
  'not_found',
  'outbox_owner_mismatch',
  'request_conflict',
  'version_conflict',
  'precondition_failed',
  'validation_error',
  'owner_required',
])
function checkQuestion(question: WorkDraftQuestion | undefined) {
  if (
    question !== undefined &&
    (!question ||
      typeof question.conversationId !== 'string' ||
      !question.conversationId ||
      !Number.isSafeInteger(question.eventId) ||
      question.eventId <= 0)
  )
    throw new ApiError('validation_error')
}
export class WorkCommands {
  private readonly pending = new Map<string, Promise<WorkCommandItem>>()
  constructor(readonly box: Outbox) {
    box.db.exec(`CREATE TABLE IF NOT EXISTS work_commands(
      request_id TEXT PRIMARY KEY, command TEXT NOT NULL, hash TEXT NOT NULL,
      state TEXT NOT NULL, result TEXT, problem TEXT, created REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS work_drafts(work_id TEXT PRIMARY KEY, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS work_question_drafts(
        work_id TEXT NOT NULL, conversation_id TEXT NOT NULL, event_id INTEGER NOT NULL,
        text TEXT NOT NULL, PRIMARY KEY(work_id,conversation_id,event_id))`)
  }
  private item(row: Row): WorkCommandItem {
    return {
      requestId: row.request_id,
      command: JSON.parse(row.command),
      payloadHash: row.hash,
      state: row.state,
      result: row.result === null ? null : JSON.parse(row.result),
      problem: row.problem,
      createdAt: row.created,
    }
  }
  list() {
    return (
      this.box.db.prepare('SELECT * FROM work_commands ORDER BY created,request_id').all() as Row[]
    ).map((row) => this.item(row))
  }
  get(id: string) {
    const row = this.box.db.prepare('SELECT * FROM work_commands WHERE request_id=?').get(id) as
      Row | undefined
    if (!row) throw new ApiError('not_found')
    return this.item(row)
  }
  draft(workId: string, text?: string, question?: WorkDraftQuestion) {
    checkQuestion(question)
    if (question) {
      const scope = [workId, question.conversationId, question.eventId]
      if (text !== undefined)
        this.box.db
          .prepare(
            'INSERT INTO work_question_drafts VALUES(?,?,?,?) ON CONFLICT(work_id,conversation_id,event_id) DO UPDATE SET text=excluded.text',
          )
          .run(...scope, text)
      return (
        (
          this.box.db
            .prepare(
              'SELECT text FROM work_question_drafts WHERE work_id=? AND conversation_id=? AND event_id=?',
            )
            .get(...scope) as { text: string } | undefined
        )?.text ?? ''
      )
    }
    if (text !== undefined)
      this.box.db
        .prepare(
          'INSERT INTO work_drafts VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET text=excluded.text',
        )
        .run(workId, text)
    return (
      (
        this.box.db.prepare('SELECT text FROM work_drafts WHERE work_id=?').get(workId) as
          { text: string } | undefined
      )?.text ?? ''
    )
  }
  questionDrafts(workId: string): WorkQuestionDraft[] {
    return (
      this.box.db
        .prepare(
          'SELECT conversation_id,event_id,text FROM work_question_drafts WHERE work_id=? AND length(text)>0 ORDER BY event_id DESC,conversation_id',
        )
        .all(workId) as { conversation_id: string; event_id: number; text: string }[]
    ).map((row) => ({
      question: { conversationId: row.conversation_id, eventId: row.event_id },
      text: row.text,
    }))
  }
  prepare(
    command: WorkCommand,
    state: 'draft' | 'submitted',
    draftSnapshot?: string,
    question?: WorkDraftQuestion,
  ) {
    checkQuestion(question)
    if (command.kind === 'input') {
      command = { ...command, text: normalizeMessageText(command.text) }
      if (!command.text) throw new ApiError('validation_error')
    } else if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0)
      throw new ApiError('validation_error')
    const id = randomUUID(),
      { operation, payload } = this.request(command)
    return this.box.db.transaction(() => {
      this.box.db
        .prepare('INSERT INTO work_commands VALUES(?,?,?,?,NULL,NULL,?)')
        .run(
          id,
          JSON.stringify(command),
          payloadHash(operation, command.workId, payload),
          state,
          Date.now(),
        )
      if (
        command.kind === 'input' &&
        draftSnapshot !== undefined &&
        this.draft(command.workId, undefined, question) === draftSnapshot
      )
        this.draft(command.workId, '', question)
      return this.get(id)
    })()
  }
  private request(command: WorkCommand) {
    return command.kind === 'input'
      ? {
          operation: 'client.work_input',
          path: `works/${command.workId}/inputs`,
          payload: { text: command.text },
        }
      : {
          operation: 'client.work_cancel',
          path: `works/${command.workId}/cancel`,
          payload: { expected_revision: command.expectedRevision },
        }
  }
  private update(
    id: string,
    state: WorkCommandItem['state'],
    problem: string | null,
    result: WorkCommandItem['result'] = null,
  ) {
    this.box.db
      .prepare('UPDATE work_commands SET state=?,problem=?,result=? WHERE request_id=?')
      .run(state, problem, result === null ? null : JSON.stringify(result), id)
    return this.get(id)
  }
  private once(id: string, action: () => Promise<WorkCommandItem>) {
    const previous = this.pending.get(id)
    if (previous) return previous
    const work = action().finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }
  private async dispatch(client: ApiClient, item: WorkCommandItem) {
    if (item.state === 'result') return item
    await this.box.verifyOwner(client)
    const { path, payload } = this.request(item.command)
    this.update(item.requestId, 'submitted', null)
    const result = await client.post<WorkCommandItem['result']>(path, {
      request_id: item.requestId,
      ...payload,
    })
    if (result === undefined || result === null) throw new ApiError('transport_unknown')
    return this.update(item.requestId, 'result', null, result)
  }
  private failed(id: string, error: unknown) {
    const code = error instanceof ApiError ? error.code : 'transport_unknown'
    const original = this.get(id)
    if (
      original.state === 'result' &&
      original.problem === 'not_found' &&
      !terminalProblems.has(code)
    )
      return original
    return this.update(id, terminalProblems.has(code) ? 'result' : this.get(id).state, code)
  }
  send(client: ApiClient, id: string) {
    return this.once(id, async () => {
      try {
        return await this.dispatch(client, this.get(id))
      } catch (error) {
        return this.failed(id, error)
      }
    })
  }
  verify(client: ApiClient, id: string) {
    return this.once(id, async () => {
      const item = this.get(id)
      if (item.state === 'result' && item.problem !== 'not_found') return item
      try {
        await this.box.verifyOwner(client)
        if (item.state === 'draft') return await this.dispatch(client, item)
        const original = await client.get<OriginalRequest>(`requests/${id}`)
        if (!original.found)
          return item.state === 'submitted' && !terminalProblems.has(item.problem ?? '')
            ? await this.dispatch(client, item)
            : item
        const { operation } = this.request(item.command)
        if (
          original.operation_kind !== operation ||
          original.target !== item.command.workId ||
          original.payload_hash !== item.payloadHash
        )
          return this.update(id, 'result', 'request_conflict')
        return this.update(
          id,
          original.status === 'succeeded' || original.status === 'failed' ? 'result' : 'submitted',
          original.problem_code ?? null,
          original.result ?? null,
        )
      } catch (error) {
        return this.failed(id, error)
      }
    })
  }
  settle() {
    return Promise.allSettled(this.pending.values())
  }
}
