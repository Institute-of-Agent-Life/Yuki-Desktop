import { randomUUID } from 'node:crypto'
import type { CharacterCommand, CharacterCommandItem, OriginalRequest } from '../../shared/api'
import { ApiClient, ApiError } from '../api/client'
import type { Outbox } from './index'
import { payloadHash } from './fingerprint'
import { normalizeMessageText } from '../../shared/message'

const terminal = new Set([
  'not_found',
  'unauthenticated',
  'owner_required',
  'outbox_owner_mismatch',
  'request_conflict',
  'version_conflict',
  'precondition_failed',
  'validation_error',
])
export function characterRequest(command: CharacterCommand, characterId: string, personId: string) {
  if (command.kind === 'device-revoke')
    return {
      operation: 'client.revoke',
      target: command.deviceId,
      path: `devices/${command.deviceId}`,
      method: 'DELETE' as const,
      payload: {},
    }
  if (command.kind === 'proactive-route')
    return {
      operation: 'client.proactive_route',
      target: command.bindingId,
      hashTarget: personId,
      path: 'me/proactive-route',
      method: 'PUT' as const,
      payload: { expected_revision: command.expectedRevision, binding_id: command.bindingId },
    }
  if (command.kind === 'profile')
    return {
      operation: 'client.character_update',
      target: characterId,
      path: 'character',
      method: 'PATCH' as const,
      payload: {
        expected_revision: command.expectedRevision,
        display_name: command.displayName,
        bio: command.bio,
        accent: command.accent,
      },
    }
  if (command.kind === 'memory')
    return {
      operation: 'client.memory_correction',
      target: String(command.factId),
      path: `memory/facts/${command.factId}/corrections`,
      method: 'POST' as const,
      payload: {
        expected_revision: command.expectedRevision,
        action: command.action,
        text: command.action === 'correct' ? normalizeMessageText(command.text!) : null,
      },
    }
  return {
    operation: 'client.automation',
    target: String(command.automationId),
    path: `automations/${command.automationId}/actions/${command.action}`,
    method: 'POST' as const,
    payload: { expected_revision: command.expectedRevision, action: command.action },
  }
}

export class CharacterCommands {
  private pending = new Map<string, Promise<CharacterCommandItem>>()
  constructor(readonly box: Outbox) {
    box.db.exec(`CREATE TABLE IF NOT EXISTS character_commands(
      request_id TEXT PRIMARY KEY, command TEXT NOT NULL, hash TEXT NOT NULL,
      state TEXT NOT NULL, problem TEXT, result TEXT, details TEXT)`)
  }
  get(id: string): CharacterCommandItem {
    const row = this.box.db
      .prepare('SELECT * FROM character_commands WHERE request_id=?')
      .get(id) as
      | {
          request_id: string
          command: string
          hash: string
          state: CharacterCommandItem['state']
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
      this.box.db.prepare('SELECT request_id FROM character_commands ORDER BY rowid').all() as {
        request_id: string
      }[]
    ).map((row) => this.get(row.request_id))
  }
  prepare(command: CharacterCommand) {
    if (command.kind === 'profile') {
      if (
        !Number.isSafeInteger(command.expectedRevision) ||
        command.expectedRevision < 0 ||
        typeof command.displayName !== 'string' ||
        !command.displayName.trim() ||
        typeof command.bio !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(command.accent?.light) ||
        !/^#[0-9a-f]{6}$/i.test(command.accent?.dark)
      )
        throw new ApiError('validation_error')
    } else if (command.kind === 'device-revoke') {
      if (
        typeof command.deviceId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          command.deviceId,
        )
      )
        throw new ApiError('validation_error')
    } else if (command.kind === 'proactive-route') {
      if (
        !Number.isSafeInteger(command.expectedRevision) ||
        command.expectedRevision < 0 ||
        typeof command.bindingId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          command.bindingId,
        )
      )
        throw new ApiError('validation_error')
    } else if (command.kind === 'memory' || command.kind === 'automation') {
      const id = command.kind === 'memory' ? command.factId : command.automationId
      if (
        !Number.isSafeInteger(id) ||
        id < 1 ||
        !/^[0-9a-f]{64}$/.test(command.expectedRevision) ||
        (command.kind === 'memory'
          ? !['correct', 'retract'].includes(command.action) ||
            (command.action === 'correct' &&
              (typeof command.text !== 'string' || !normalizeMessageText(command.text)))
          : !['pause', 'resume', 'delete'].includes(command.action))
      )
        throw new ApiError('validation_error')
    } else throw new ApiError('validation_error')
    const request = characterRequest(command, this.box.owner.characterId, this.box.owner.personId)
    const hash = payloadHash(
      request.operation,
      request.hashTarget ?? request.target,
      request.payload,
    )
    const previous = this.box.db
      .prepare(
        "SELECT request_id FROM character_commands WHERE hash=? AND state='submitted' ORDER BY rowid LIMIT 1",
      )
      .get(hash) as { request_id: string } | undefined
    if (previous) return this.get(previous.request_id)
    const id = randomUUID()
    this.box.db
      .prepare("INSERT INTO character_commands VALUES(?,?,?,'submitted',NULL,NULL,NULL)")
      .run(id, JSON.stringify(command), hash)
    return this.get(id)
  }
  private update(
    id: string,
    state: CharacterCommandItem['state'],
    problem: string | null,
    result: CharacterCommandItem['result'] = null,
    details: CharacterCommandItem['details'] = null,
  ) {
    this.box.db
      .prepare(
        'UPDATE character_commands SET state=?,problem=?,result=?,details=? WHERE request_id=?',
      )
      .run(
        state,
        problem,
        result === null ? null : JSON.stringify(result),
        details === null ? null : JSON.stringify(details),
        id,
      )
    return this.get(id)
  }
  run(client: ApiClient, id: string, verify = false) {
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
      const request = characterRequest(
        item.command,
        this.box.owner.characterId,
        this.box.owner.personId,
      )
      if (verify) {
        const receipt = await client.get<OriginalRequest>(`requests/${id}`)
        if (receipt.found) {
          if (
            receipt.operation_kind !== request.operation ||
            receipt.target !== request.target ||
            receipt.payload_hash !== item.payloadHash
          )
            return this.update(id, 'result', 'request_conflict')
          return this.update(
            id,
            receipt.status === 'succeeded' || receipt.status === 'failed' ? 'result' : 'submitted',
            receipt.problem_code ?? null,
            receipt.result ?? null,
          )
        }
      }
      const body: Record<string, unknown> = { ...request.payload }
      if (item.command.kind === 'automation') delete body.action
      const result = await client.mutate<CharacterCommandItem['result']>(
        request.path,
        {
          request_id: id,
          ...body,
        },
        request.method,
      )
      if (result === undefined || result === null) throw new ApiError('transport_unknown')
      return this.update(id, 'result', null, result)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'transport_unknown'
      return this.update(
        id,
        terminal.has(code) ? 'result' : 'submitted',
        code,
        null,
        error instanceof ApiError ? (error.details ?? null) : null,
      )
    }
  }
  settle() {
    return Promise.allSettled(this.pending.values())
  }
}
