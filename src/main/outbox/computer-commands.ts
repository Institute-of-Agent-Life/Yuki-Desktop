import { createHash, randomUUID } from 'node:crypto'
import type {
  ComputerCommand,
  ComputerCommandItem,
  ComputerResult,
  OriginalRequest,
} from '../../shared/api'
import { ApiClient, ApiError } from '../api/client'
import { payloadHash } from './fingerprint'
import type { Outbox } from './index'

const namespace = Buffer.from('c4c26f961160513585e2861feb4a9ce7', 'hex')
export function computerKey(scope: string, request: string) {
  const hash = createHash('sha1')
    .update(namespace)
    .update(`client:${scope}:${request}`)
    .digest()
    .subarray(0, 16)
  hash[6] = (hash[6]! & 15) | 80
  hash[8] = (hash[8]! & 63) | 128
  const h = hash.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
export function computerRequest(command: ComputerCommand) {
  if (['take', 'return', 'transfer'].includes(command.action)) {
    const control = command as Extract<ComputerCommand, { action: 'take' | 'return' | 'transfer' }>
    return {
      path: 'computer/control',
      operation: 'client.computer.control',
      payload: {
        action: control.action,
        lease_id: control.action === 'take' ? null : control.leaseId,
        note: control.note ?? null,
      },
    }
  }
  return {
    path: `computer/${command.action}`,
    operation: `client.computer.${command.action}`,
    payload:
      command.action === 'sleep'
        ? { action: 'sleep', confirm_active_work_tabs: command.confirmActiveWorkTabs }
        : { action: 'wake' },
  }
}
const terminal = new Set([
  'not_found',
  'unauthenticated',
  'owner_required',
  'outbox_owner_mismatch',
  'request_conflict',
  'precondition_failed',
  'validation_error',
  'control_held',
])
export class ComputerCommands {
  private pending = new Map<string, Promise<ComputerCommandItem>>()
  constructor(readonly box: Outbox) {
    box.db.exec(`CREATE TABLE IF NOT EXISTS computer_commands(
      request_id TEXT PRIMARY KEY, command TEXT NOT NULL, hash TEXT NOT NULL,
      state TEXT NOT NULL, problem TEXT, result TEXT)`)
  }
  list(): ComputerCommandItem[] {
    return (
      this.box.db.prepare('SELECT request_id FROM computer_commands ORDER BY rowid').all() as {
        request_id: string
      }[]
    ).map((row) => this.get(row.request_id))
  }
  get(id: string): ComputerCommandItem {
    const row = this.box.db
      .prepare('SELECT * FROM computer_commands WHERE request_id=?')
      .get(id) as
      | {
          request_id: string
          command: string
          hash: string
          state: ComputerCommandItem['state']
          problem: string | null
          result: string | null
        }
      | undefined
    if (!row) throw new ApiError('not_found')
    return {
      requestId: row.request_id,
      command: JSON.parse(row.command),
      payloadHash: row.hash,
      state: row.state,
      problem: row.problem,
      result: row.result ? JSON.parse(row.result) : null,
    }
  }
  prepare(command: ComputerCommand) {
    if (
      !['take', 'return', 'transfer', 'wake', 'sleep'].includes(command.action) ||
      ('leaseId' in command && !/^[a-f0-9-]{36}$/i.test(command.leaseId))
    )
      throw new ApiError('validation_error')
    const request = computerRequest(command),
      hash = payloadHash(request.operation, this.box.owner.personId, request.payload)
    const previous = this.box.db
      .prepare(
        "SELECT request_id FROM computer_commands WHERE hash=? AND state='submitted' ORDER BY rowid LIMIT 1",
      )
      .get(hash) as { request_id: string } | undefined
    if (previous) return this.get(previous.request_id)
    const id = randomUUID()
    this.box.db
      .prepare("INSERT INTO computer_commands VALUES(?,?,?,'submitted',NULL,NULL)")
      .run(id, JSON.stringify(command), hash)
    return this.get(id)
  }
  private update(
    id: string,
    state: ComputerCommandItem['state'],
    problem: string | null,
    result: ComputerResult | null = null,
  ) {
    this.box.db
      .prepare('UPDATE computer_commands SET state=?,problem=?,result=? WHERE request_id=?')
      .run(state, problem, result === null ? null : JSON.stringify(result), id)
    return this.get(id)
  }
  run(client: ApiClient, id: string, verify = true) {
    const active = this.pending.get(id)
    if (active) return active
    const task = this.dispatch(client, id, verify).finally(() => this.pending.delete(id))
    this.pending.set(id, task)
    return task
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
            original.operation_kind !== 'control' ||
            original.payload_hash !== item.payloadHash ||
            original.target !== computerKey(this.box.owner.personId, id)
          )
            return this.update(id, 'result', 'request_conflict')
          if (original.status === 'succeeded' || original.status === 'failed')
            return this.update(
              id,
              'result',
              original.problem_code ?? null,
              original.result as ComputerResult | null,
            )
          // A/B crash recovery explicitly resubmits this exact original request.
          // The Bot queries the original Manager key before starting any effect.
        }
      }
      const request = computerRequest(item.command)
      const { action, ...body } = request.payload
      const result = await client.post<ComputerResult>(request.path, {
        request_id: id,
        ...(['take', 'return', 'transfer'].includes(action) ? request.payload : body),
      })
      return this.update(id, 'result', null, result)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'transport_unknown'
      return this.update(id, terminal.has(code) ? 'result' : 'submitted', code)
    }
  }
}
