import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { CharacterCommands } from '../../src/main/outbox/character-commands'
import { ApiClient } from '../../src/main/api/client'
import type { CharacterCommand, Me, OutboxOwner } from '../../src/shared/api'
import { retiredSummary, exportRetired, localSummary } from '../../src/main/outbox/local-summary'
import { payloadHash } from '../../src/main/outbox/fingerprint'
const owner: OutboxOwner = {
  characterId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  conversationId: '00000000-0000-4000-8000-000000000003',
  bindingId: '00000000-0000-4000-8000-000000000004',
}
const me: Me = {
  person_id: owner.personId,
  source_person_id: owner.personId,
  request_person_id: owner.personId,
  request_scope: owner.personId,
  request_conversation_id: null,
  platform: 'app',
  presence_id: owner.bindingId,
  thread_id: null,
  binding_id: owner.bindingId,
  display_name: '本人',
  conversation_id: owner.conversationId,
  bindings: [
    {
      binding_id: owner.bindingId,
      source_person_id: owner.personId,
      platform: 'app',
      display_name: '',
      status: 'active',
    },
  ],
  devices: [],
}
const roots: { root: string; box: Outbox }[] = []
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'yd-character-'))
  const path = join(root, 'outbox.sqlite3')
  const box = new Outbox(path, owner)
  roots.push({ root, box })
  return { root, path, box, commands: new CharacterCommands(box) }
}
afterEach(() => {
  for (const { root, box } of roots.splice(0)) {
    if (box.db.open) box.db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
const correction = {
  kind: 'profile',
  expectedRevision: 1,
  displayName: 'Yuki',
  bio: 'original',
  accent: { light: '#123456', dark: '#abcdef' },
} as const satisfies CharacterCommand
const api = (fetcher: typeof fetch) =>
  new ApiClient('http://localhost/role', 'test-only', owner.bindingId, '1.0.0-beta.1', fetcher)
const data = (value: unknown) => Response.json({ data: value })

it('preserves retired avatar, unsupported original requests and local operation bytes across reopen', async () => {
  const { path, box } = setup()
  const command = '{ "kind": "retired-avatar", "text": "original draft" }'
  const result = '{ "state": "unknown", "result": { "native": "already submitted" } }'
  box.db
    .exec(`CREATE TABLE local_executor_operations(executor_id TEXT, op_id TEXT, phase TEXT, result_json TEXT);
    CREATE TABLE avatar_commands(request_id TEXT, body BLOB, state TEXT);
    CREATE TABLE computer_commands(request_id TEXT, state TEXT, result TEXT);
    CREATE TABLE executor_commands(request_id TEXT, state TEXT, result TEXT);
    CREATE TABLE executor_setup(id INTEGER, create_request TEXT, revoke_request TEXT)`)
  box.db
    .prepare('INSERT INTO character_commands VALUES(?,?,?,?,NULL,NULL,NULL)')
    .run('original-request', command, 'original-hash', 'submitted')
  box.db
    .prepare('INSERT INTO local_executor_operations VALUES(?,?,?,?)')
    .run('original-executor', 'original-operation', 'finished', result)
  box.db
    .prepare('INSERT INTO avatar_commands VALUES(?,?,?)')
    .run('original-avatar', Buffer.from([0, 255, 1]), 'submitted')
  box.db.exec(
    "INSERT INTO computer_commands VALUES('original-control','submitted',NULL); INSERT INTO executor_commands VALUES('original-create','submitted',NULL); INSERT INTO executor_setup VALUES(1,'original-create',NULL)",
  )
  const before = exportRetired(box)
  box.db.close()
  const recovered = new Outbox(path, owner)
  try {
    const commands = new CharacterCommands(recovered)
    const fetcher = async () => {
      throw Error('retired requests must not issue any HTTP request')
    }
    expect(commands.list()).toEqual([])
    const original = await commands.run(api(fetcher), 'original-request', true)
    expect(original).toMatchObject({
      requestId: 'original-request',
      payloadHash: 'original-hash',
      state: 'submitted',
    })
    expect(retiredSummary(recovered).reduce((sum, item) => sum + item.count, 0)).toBe(1)
    expect(exportRetired(recovered)).toBe(before)
    expect(localSummary(recovered)).toEqual({ drafts: 0, pending: 4, attachments: 0 })
    expect(recovered.db.prepare('SELECT command FROM character_commands').get()).toEqual({
      command,
    })
    expect(recovered.db.prepare('SELECT result_json FROM local_executor_operations').get()).toEqual(
      { result_json: result },
    )
    expect(() => new Outbox(path, { ...owner, personId: owner.characterId })).toThrow(
      'outbox_owner_mismatch',
    )
  } finally {
    recovered.db.close()
  }
})

it('does not create retired tables while reading a fresh namespace', () => {
  const { box } = setup()
  const before = box.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()
  expect(retiredSummary(box)).toEqual([])
  expect(JSON.parse(exportRetired(box))).toEqual({ owner, tables: {} })
  expect(box.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(before)
})

it('keeps character names exactly as supplied by the public contract', () => {
  const { commands } = setup()
  const item = commands.prepare({
    kind: 'profile',
    expectedRevision: 1,
    displayName: '',
    bio: '',
    accent: { light: '#123456', dark: '#abcdef' },
  })
  expect(item.command).toMatchObject({ displayName: '' })
})

it('cold recovery queries the original receipt after a committed profile change loses its response', async () => {
  const { path, box, commands } = setup()
  const item = commands.prepare(correction)
  let effects = 0
  const client = api(async (input, init) => {
    const url = String(input)
    expect(init?.headers).toHaveProperty('X-Yuki-Entry', owner.bindingId)
    if (url.endsWith('/me')) return data(me)
    if (url.includes('/requests/'))
      return data({
        found: effects > 0,
        operation_kind: 'client.character_update',
        target: owner.characterId,
        payload_hash: item.payloadHash,
        status: 'succeeded',
        result: { revision: 2 },
      })
    effects++
    expect(JSON.parse(init!.body as string)).toEqual({
      request_id: item.requestId,
      expected_revision: correction.expectedRevision,
      display_name: 'Yuki',
      bio: 'original',
      accent: { light: '#123456', dark: '#abcdef' },
    })
    throw new TypeError('response lost after commit')
  })
  expect((await commands.run(client, item.requestId, true)).state).toBe('submitted')
  expect(commands.prepare(correction).requestId).toBe(item.requestId)
  box.db.close()
  const recovered = new Outbox(path, owner)
  try {
    const original = await new CharacterCommands(recovered).run(client, item.requestId, true)
    expect(original.state).toBe('result')
    expect(original.result).toMatchObject({ revision: 2 })
    expect(effects).toBe(1)
  } finally {
    recovered.db.close()
  }
})

it('a 404 original receipt never starts a replacement profile change', async () => {
  const { commands } = setup(),
    item = commands.prepare(correction)
  let effects = 0
  const client = api(async (input, init) => {
    if (String(input).endsWith('/me')) return data(me)
    if (init?.method !== 'POST')
      return Response.json({ problem: { code: 'not_found' } }, { status: 404 })
    effects++
    return data({})
  })
  expect((await commands.run(client, item.requestId, true)).problem).toBe('not_found')
  expect((await commands.run(client, item.requestId, true)).state).toBe('result')
  expect(effects).toBe(0)
})

it('concurrent clicks share one original UUID and retain conflict details without changing the baseline', async () => {
  const { commands } = setup(),
    item = commands.prepare(correction)
  let effects = 0
  const client = api(async (input) => {
    if (String(input).endsWith('/me')) return data(me)
    if (String(input).includes('/requests/')) return data({ found: false })
    effects++
    return Response.json(
      {
        problem: {
          code: 'version_conflict',
          current: { fact_id: 42, text: '整理後的記憶' },
          replacement_fact_id: 84,
        },
      },
      { status: 409 },
    )
  })
  const results = await Promise.all([
    commands.run(client, item.requestId, true),
    commands.run(client, commands.prepare(correction).requestId, true),
  ])
  expect(effects).toBe(1)
  expect(results[0]).toEqual(results[1])
  expect(results[0].details?.replacement_fact_id).toBe(84)
  expect(results[0].command).toEqual(correction)
  expect((await commands.run(client, item.requestId, true)).problem).toBe('version_conflict')
  expect(effects).toBe(1)
})

it('a transferred entry and a mismatched original receipt cannot dispatch a private mutation', async () => {
  const { commands } = setup(),
    item = commands.prepare(correction)
  let effects = 0
  const rebound = api(async (input) => {
    if (String(input).endsWith('/me')) return data({ ...me, request_person_id: owner.characterId })
    effects++
    return data({})
  })
  expect((await commands.run(rebound, item.requestId, true)).problem).toBe('outbox_owner_mismatch')
  const next = commands.prepare(correction)
  const mismatch = api(async (input) => {
    if (String(input).endsWith('/me')) return data(me)
    if (String(input).includes('/requests/'))
      return data({
        found: true,
        operation_kind: 'client.character_update',
        target: owner.personId,
        payload_hash: next.payloadHash,
        status: 'succeeded',
        result: {},
      })
    effects++
    return data({})
  })
  expect((await commands.run(mismatch, next.requestId, true)).problem).toBe('request_conflict')
  expect(effects).toBe(0)
})

function croppedPng() {
  // This unit covers byte identity and transport. The actual decoder is exercised by HTTP/Electron.
  const bytes = Buffer.alloc(32, 255)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes)
  bytes.writeUInt32BE(1024, 16)
  bytes.writeUInt32BE(1024, 20)
  return bytes
}

it('uses the original character command namespace and exact role fingerprint for an avatar', async () => {
  const { box, commands } = setup(),
    bytes = croppedPng()
  box.db.exec('CREATE TABLE avatar_commands(request_id TEXT,body BLOB,state TEXT)')
  box.db
    .prepare('INSERT INTO avatar_commands VALUES(?,?,?)')
    .run('retired', Buffer.from([0, 255]), 'submitted')
  const old = exportRetired(box)
  const item = commands.prepareAvatar(0, bytes)
  expect(item.payloadHash).toBe(
    payloadHash('client.character_avatar', owner.characterId, {
      action: 'set',
      expected_revision: 0,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
    }),
  )
  expect(item.command).toMatchObject({ kind: 'avatar', action: 'set', expectedRevision: 0 })
  expect(item.command).not.toHaveProperty('png')
  expect(commands.list()[0]!.command).not.toHaveProperty('png')
  expect(Buffer.from(commands.avatarDraft(item.requestId)!.bytes)).toEqual(bytes)
  let writes = 0
  const client = api(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/me')) return data(me)
    if (url.pathname.includes('/requests/')) return data({ found: false })
    writes++
    expect(init?.method).toBe('PUT')
    expect(url.pathname.endsWith('/character/avatar')).toBe(true)
    expect(url.searchParams.get('request_id')).toBe(item.requestId)
    expect(url.searchParams.get('expected_revision')).toBe('0')
    expect(url.searchParams.get('size')).toBe(String(bytes.byteLength))
    expect(init?.headers).toHaveProperty('Content-Type', 'image/png')
    expect(Buffer.from(init!.body as ArrayBuffer)).toEqual(bytes)
    return data({ avatar_revision: 1 })
  })
  expect((await commands.run(client, item.requestId, true)).state).toBe('result')
  expect(writes).toBe(1)
  expect(commands.list()).toEqual([])
  expect(exportRetired(box)).toBe(old)
})

it('recovers the original committed avatar UUID without sending the PNG again', async () => {
  const { path, box, commands } = setup(),
    bytes = croppedPng(),
    item = commands.prepareAvatar(0, bytes)
  let writes = 0
  const client = api(async (input) => {
    const url = String(input)
    if (url.endsWith('/me')) return data(me)
    if (url.includes('/requests/'))
      return data({
        found: writes > 0,
        operation_kind: 'client.character_avatar',
        target: owner.characterId,
        payload_hash: item.payloadHash,
        status: 'succeeded',
        result: { avatar_revision: 1 },
      })
    writes++
    throw new TypeError('avatar committed but response was lost')
  })
  expect((await commands.run(client, item.requestId, true)).state).toBe('submitted')
  expect(commands.prepareAvatar(0, bytes).requestId).toBe(item.requestId)
  box.db.close()
  const reopened = new Outbox(path, owner)
  try {
    const recovered = new CharacterCommands(reopened)
    expect(Buffer.from(recovered.avatarDraft(item.requestId)!.bytes)).toEqual(bytes)
    expect((await recovered.run(client, item.requestId, true)).result).toEqual({
      avatar_revision: 1,
    })
    expect(writes).toBe(1)
  } finally {
    reopened.db.close()
  }
})

it('binds reset to the current avatar revision and retains the actual conflict', async () => {
  const { commands } = setup(),
    item = commands.prepareAvatar(3)
  expect(item.payloadHash).toBe(
    payloadHash('client.character_avatar', owner.characterId, {
      action: 'reset',
      expected_revision: 3,
      sha256: null,
      size: null,
    }),
  )
  expect(commands.avatarDraft(item.requestId)).toBeNull()
  let writes = 0
  const client = api(async (input, init) => {
    if (String(input).endsWith('/me')) return data(me)
    if (String(input).includes('/requests/')) return data({ found: false })
    writes++
    expect(init?.method).toBe('DELETE')
    expect(JSON.parse(init!.body as string)).toEqual({
      request_id: item.requestId,
      expected_revision: 3,
    })
    return Response.json(
      { problem: { code: 'version_conflict', current: { avatar_revision: 4 } } },
      { status: 409 },
    )
  })
  const result = await commands.run(client, item.requestId, true)
  expect(result).toMatchObject({
    state: 'result',
    problem: 'version_conflict',
    details: { current: { avatar_revision: 4 } },
  })
  expect((await commands.run(client, item.requestId, true)).problem).toBe('version_conflict')
  expect(writes).toBe(1)
})

it('queries the original avatar receipt before requiring local draft bytes', async () => {
  const { box, commands } = setup(),
    item = commands.prepareAvatar(0, croppedPng())
  box.db
    .prepare(
      "UPDATE character_commands SET command=json_remove(command,'$.png') WHERE request_id=?",
    )
    .run(item.requestId)
  const client = api(async (input) => {
    if (String(input).endsWith('/me')) return data(me)
    if (String(input).includes('/requests/'))
      return data({
        found: true,
        operation_kind: 'client.character_avatar',
        target: owner.characterId,
        payload_hash: item.payloadHash,
        status: 'succeeded',
        result: { avatar_revision: 1 },
      })
    throw Error('an acknowledged original avatar must never be resent')
  })
  expect((await commands.run(client, item.requestId, true)).state).toBe('result')
})
