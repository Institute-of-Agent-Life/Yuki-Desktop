import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { CharacterCommands } from '../../src/main/outbox/character-commands'
import { ApiClient } from '../../src/main/api/client'
import type { CharacterCommand, Me, OutboxOwner } from '../../src/shared/api'
import { retiredSummary, exportRetired, localSummary } from '../../src/main/outbox/local-summary'
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

it('leaves retired requests and executor results byte-for-byte intact across reopen, inspection and explicit verification', async () => {
  const { path, box } = setup()
  const command = '{ "kind": "memory", "factId": 42, "text": "original draft" }'
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
    expect(retiredSummary(recovered).reduce((sum, item) => sum + item.count, 0)).toBe(6)
    expect(exportRetired(recovered)).toBe(before)
    expect(localSummary(recovered)).toEqual({ drafts: 0, pending: 5, attachments: 0 })
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
  expect(JSON.parse(exportRetired(box))).toEqual({ owner, tables: { character_commands: [] } })
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
