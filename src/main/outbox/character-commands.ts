import { createHash, randomUUID } from 'node:crypto'
import type { CharacterCommand, CharacterCommandItem, OriginalRequest } from '../../shared/api'
import { ApiClient, ApiError } from '../api/client'
import type { Outbox } from './index'
import { payloadHash } from './fingerprint'
import { normalizeMessageText } from '../../shared/message'

const terminal = new Set([
  'not_found',
  'unauthenticated',
  'owner_required',
  'forbidden',
  'outbox_owner_mismatch',
  'request_conflict',
  'version_conflict',
  'precondition_failed',
  'validation_error',
  'unsupported_image',
  'image_dimensions',
  'content_hash_mismatch',
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
  if (command.kind === 'avatar')
    return {
      operation: 'client.character_avatar',
      target: characterId,
      path: 'character/avatar',
      method: command.action === 'set' ? ('PUT' as const) : ('DELETE' as const),
      payload: {
        action: command.action,
        expected_revision: command.expectedRevision,
        sha256: command.sha256,
        size: command.size,
      },
    }
  if (command.kind === 'proactive-route')
    return {
      operation: 'client.proactive_route',
      target: personId,
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
      .prepare(
        "SELECT request_id,CASE WHEN json_extract(command,'$.kind')='avatar' THEN json_remove(command,'$.png') ELSE command END AS command,hash,state,problem,result,details FROM character_commands WHERE request_id=?",
      )
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
      this.box.db
        .prepare(
          "SELECT request_id FROM character_commands WHERE json_extract(command,'$.kind')!='avatar' OR state!='result' ORDER BY rowid",
        )
        .all() as {
        request_id: string
      }[]
    )
      .map((row) => this.get(row.request_id))
      .filter((item) =>
        ['profile', 'device-revoke', 'avatar', 'memory', 'automation', 'proactive-route'].includes(
          item.command.kind,
        ),
      )
  }
  prepareAvatar(expectedRevision: number, bytes?: Uint8Array) {
    const image = bytes === undefined ? null : Buffer.from(bytes)
    return this.prepare(
      {
        kind: 'avatar',
        action: image ? 'set' : 'reset',
        expectedRevision,
        sha256: image ? createHash('sha256').update(image).digest('hex') : null,
        size: image?.byteLength ?? null,
      },
      image,
    )
  }
  avatarDraft(id: string) {
    const item = this.get(id)
    if (item.command.kind !== 'avatar') throw new ApiError('not_found')
    if (item.command.action === 'reset') return null
    const row = this.box.db
      .prepare(
        "SELECT json_extract(command,'$.png') AS png FROM character_commands WHERE request_id=?",
      )
      .get(id) as { png: string }
    const bytes = Buffer.from(row.png, 'base64')
    if (createHash('sha256').update(bytes).digest('hex') !== item.command.sha256)
      throw new ApiError('content_hash_mismatch')
    return { filename: '這次更新.png', bytes: new Uint8Array(bytes) }
  }
  prepare(command: CharacterCommand, image: Buffer | null = null) {
    if (command.kind === 'profile') {
      if (
        !Number.isSafeInteger(command.expectedRevision) ||
        command.expectedRevision < 1 ||
        typeof command.displayName !== 'string' ||
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
    } else if (command.kind === 'avatar') {
      if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0)
        throw new ApiError('validation_error')
      if (command.action === 'set') {
        if (
          !image ||
          image.byteLength < 24 ||
          image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        )
          throw new ApiError('unsupported_image')
        if (image.readUInt32BE(16) !== 1024 || image.readUInt32BE(20) !== 1024)
          throw new ApiError('image_dimensions')
        if (
          image.byteLength !== command.size ||
          createHash('sha256').update(image).digest('hex') !== command.sha256
        )
          throw new ApiError('content_hash_mismatch')
      } else if (command.action !== 'reset' || command.sha256 !== null || command.size !== null)
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
    const hash = payloadHash(request.operation, request.target, request.payload)
    const previous = this.box.db
      .prepare(
        "SELECT request_id FROM character_commands WHERE hash=? AND state='submitted' ORDER BY rowid LIMIT 1",
      )
      .get(hash) as { request_id: string } | undefined
    if (previous) return this.get(previous.request_id)
    const id = randomUUID()
    this.box.db
      .prepare("INSERT INTO character_commands VALUES(?,?,?,'submitted',NULL,NULL,NULL)")
      .run(
        id,
        JSON.stringify(image ? { ...command, png: image.toString('base64') } : command),
        hash,
      )
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
    if (
      item.state === 'result' ||
      !['profile', 'device-revoke', 'avatar', 'proactive-route', 'memory', 'automation'].includes(
        item.command.kind,
      )
    )
      return item
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
      let result: CharacterCommandItem['result']
      if (item.command.kind === 'avatar' && item.command.action === 'set') {
        const bytes = this.avatarDraft(id)!.bytes
        const params = new URLSearchParams({
          request_id: id,
          expected_revision: String(item.command.expectedRevision),
          sha256: item.command.sha256!,
          size: String(item.command.size),
        })
        const response = await client.response(`${request.path}?${params}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: Uint8Array.from(bytes).buffer,
        })
        try {
          result = ((await response.json()) as { data: CharacterCommandItem['result'] }).data
        } catch {
          throw new ApiError('transport_unknown')
        }
      } else {
        const body =
          item.command.kind === 'avatar'
            ? { expected_revision: item.command.expectedRevision }
            : item.command.kind === 'automation'
              ? { expected_revision: item.command.expectedRevision }
              : request.payload
        result = await client.mutate<CharacterCommandItem['result']>(
          request.path,
          { request_id: id, ...body },
          request.method,
        )
      }
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
