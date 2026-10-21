import { randomUUID } from 'node:crypto'
import type {
  ExecutorCommand,
  ExecutorCommandItem,
  ExecutorConfig,
  ExecutorCreated,
} from '../../shared/executor'
import type { OriginalRequest } from '../../shared/api'
import { ApiClient, ApiError } from '../api/client'
import type { ExecutorInstallation } from '../executor/installation'
import type { Outbox } from './index'
import { payloadHash } from './fingerprint'
const terminal = new Set([
  'not_found',
  'unauthenticated',
  'outbox_owner_mismatch',
  'request_conflict',
  'validation_error',
  'version_conflict',
  'precondition_failed',
])
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export function executorRequest(command: ExecutorCommand) {
  if (command.kind === 'create')
    return {
      operation: 'client.executor.create',
      target: '',
      path: 'executors',
      method: 'POST' as const,
      payload: { label: command.label, platform: command.platform },
    }
  const base = `executors/${command.executorId}`
  if (command.kind === 'grants')
    return {
      operation: 'client.executor.grants',
      target: command.executorId,
      path: `${base}/grants`,
      method: 'PUT' as const,
      payload: {
        expected_revision: command.expectedRevision,
        grants: command.grants.map((g) => ({
          capability: g.capability,
          ...(g.scope ? { scope: { alias: g.scope.alias, digest: g.scope.digest } } : {}),
        })),
      },
    }
  return {
    operation: `client.executor.${command.kind}`,
    target: command.executorId,
    path: command.kind === 'delete' ? base : `${base}/${command.kind}`,
    method: command.kind === 'delete' ? ('DELETE' as const) : ('POST' as const),
    payload: {},
  }
}
function safeResult(
  command: ExecutorCommand,
  value: unknown,
): NonNullable<ExecutorCommandItem['result']> {
  const result = value as ExecutorCreated & ExecutorConfig
  if (!result || !uuid(result.executor_id)) throw new ApiError('invalid_response')
  if (command.kind === 'create') {
    if (
      typeof result.label !== 'string' ||
      typeof result.platform !== 'string' ||
      !Number.isFinite(Date.parse(result.created_at))
    )
      throw new ApiError('invalid_response')
    return {
      executor_id: result.executor_id,
      label: result.label,
      platform: result.platform,
      created_at: result.created_at,
      replay: result.replay === true,
    }
  }
  if (
    result.executor_id !== command.executorId ||
    !Number.isSafeInteger(result.revision) ||
    typeof result.paused !== 'boolean' ||
    !Array.isArray(result.grants) ||
    typeof result.grants_digest !== 'string'
  )
    throw new ApiError('invalid_response')
  return {
    executor_id: result.executor_id,
    revision: result.revision,
    paused: result.paused,
    grants_digest: result.grants_digest,
    grants: result.grants.map((grant) => ({
      capability: grant.capability,
      ...(grant.scope ? { scope: { alias: grant.scope.alias, digest: grant.scope.digest } } : {}),
    })),
  }
}
export class ExecutorCommands {
  private pending = new Map<string, Promise<ExecutorCommandItem>>()
  constructor(
    readonly box: Outbox,
    private installation: ExecutorInstallation,
  ) {
    if (JSON.stringify(box.owner) !== JSON.stringify(installation.owner))
      throw new ApiError('outbox_owner_mismatch')
    box.db.exec(`CREATE TABLE IF NOT EXISTS executor_commands(
      request_id TEXT PRIMARY KEY, command TEXT NOT NULL, hash TEXT NOT NULL,
      state TEXT NOT NULL, problem TEXT, result TEXT)`)
  }
  get(id: string): ExecutorCommandItem {
    const row = this.box.db
      .prepare('SELECT * FROM executor_commands WHERE request_id=?')
      .get(id) as
      | {
          command: string
          hash: string
          state: ExecutorCommandItem['state']
          problem: string | null
          result: string | null
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
    }
  }
  list() {
    return (
      this.box.db.prepare('SELECT request_id FROM executor_commands ORDER BY rowid').all() as {
        request_id: string
      }[]
    ).map((row) => this.get(row.request_id))
  }
  prepare(command: ExecutorCommand) {
    if (command.kind === 'create') {
      if (!command.label.trim() || !command.platform.trim()) throw new ApiError('validation_error')
    } else if (!uuid(command.executorId)) throw new ApiError('validation_error')
    if (
      command.kind === 'grants' &&
      (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1)
    )
      throw new ApiError('validation_error')
    const request = executorRequest(command),
      id = randomUUID()
    this.box.db
      .prepare("INSERT INTO executor_commands VALUES(?,?,?,'submitted',NULL,NULL)")
      .run(
        id,
        JSON.stringify(command),
        payloadHash(request.operation, request.target, request.payload),
      )
    return this.get(id)
  }
  private update(
    item: ExecutorCommandItem,
    state: ExecutorCommandItem['state'],
    problem: string | null,
    result: ExecutorCommandItem['result'] = null,
  ) {
    // Serialize only selected non-secret fields, never a whole HTTP response/error.
    this.box.db
      .prepare('UPDATE executor_commands SET state=?,problem=?,result=? WHERE request_id=?')
      .run(state, problem, result ? JSON.stringify(result) : null, item.requestId)
    return this.get(item.requestId)
  }
  run(client: ApiClient, id: string) {
    const current = this.pending.get(id)
    if (current) return current
    const work = this.dispatch(client, id).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }
  private async dispatch(client: ApiClient, id: string): Promise<ExecutorCommandItem> {
    const item = this.get(id),
      request = executorRequest(item.command)
    if (item.state === 'result') return item
    try {
      await this.box.verifyOwner(client)
      const receipt = await client.get<OriginalRequest>(`requests/${id}`)
      if (receipt.found) {
        if (
          receipt.operation_kind !== request.operation ||
          receipt.payload_hash !== item.payloadHash ||
          (item.command.kind !== 'create' && receipt.target !== request.target)
        )
          throw new ApiError('request_conflict')
        if (receipt.status === 'succeeded') {
          const safe = safeResult(item.command, receipt.result)
          if (receipt.target !== safe.executor_id) throw new ApiError('request_conflict')
          return this.update(item, 'result', null, safe)
        }
        return this.update(
          item,
          receipt.status === 'failed' ? 'result' : 'submitted',
          receipt.problem_code ?? null,
        )
      }
      const value = await client.mutate<ExecutorCreated & ExecutorConfig>(
        request.path,
        { request_id: id, ...request.payload },
        request.method,
      )
      const safe = safeResult(item.command, value)
      if (item.command.kind === 'create' && value.token) {
        if (typeof value.token !== 'string' || value.replay) throw new ApiError('invalid_response')
        this.installation.install(safe.executor_id, value.token)
      }
      return this.update(item, 'result', null, safe)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'transport_unknown'
      return this.update(item, terminal.has(code) ? 'result' : 'submitted', code)
    }
  }
  settled() {
    return Promise.allSettled(this.pending.values())
  }
}
