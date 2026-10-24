import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { CharacterCommands, characterRequest } from '../../src/main/outbox/character-commands'
import { ApiClient } from '../../src/main/api/client'
import { payloadHash } from '../../src/main/outbox/fingerprint'
import type { CharacterCommand, Me, OutboxOwner } from '../../src/shared/api'
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
  presence_id: '00000000-0000-4000-8000-000000000099',
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
const correction: CharacterCommand = {
  kind: 'memory',
  factId: 42,
  expectedRevision: 'a'.repeat(64),
  action: 'correct',
  text: '\u0085 原內容 🙂 \u001f',
}
const api = (fetcher: typeof fetch) =>
  new ApiClient('http://localhost/role', 'test-only', owner.bindingId, '1.0.0-beta.1', fetcher)
const data = (value: unknown) => Response.json({ data: value })

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

it('cold recovery queries the original receipt after a committed correction loses its response', async () => {
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
        operation_kind: 'client.memory_correction',
        target: '42',
        payload_hash: item.payloadHash,
        status: 'succeeded',
        result: {
          event_id: 9,
          old_fact_id: 42,
          new_fact_id: 43,
          applied_operation: 'correct',
          revision: 'b'.repeat(64),
        },
      })
    effects++
    expect(JSON.parse(init!.body as string)).toEqual({
      request_id: item.requestId,
      expected_revision: correction.expectedRevision,
      action: 'correct',
      text: '原內容 🙂',
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
    expect(original.result).toMatchObject({ old_fact_id: 42, new_fact_id: 43 })
    expect(effects).toBe(1)
  } finally {
    recovered.db.close()
  }
})

it('a 404 original receipt never starts a replacement correction', async () => {
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
        operation_kind: 'client.memory_correction',
        target: '43',
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

it.each([
  [
    {
      kind: 'profile',
      expectedRevision: 2,
      displayName: '新名稱',
      bio: '簡介',
      accent: { light: '#123456', dark: '#abcdef' },
    },
    'character',
    'PATCH',
  ],
  [
    { kind: 'automation', automationId: 31, expectedRevision: 'c'.repeat(64), action: 'pause' },
    'automations/31/actions/pause',
    'POST',
  ],
  [
    { kind: 'memory', factId: 42, expectedRevision: 'd'.repeat(64), action: 'retract' },
    'memory/facts/42/corrections',
    'POST',
  ],
] as const)(
  'dispatches the original typed %s command to its contracted method',
  async (command, path, method) => {
    const { commands } = setup(),
      item = commands.prepare(command)
    const client = api(async (input, init) => {
      if (String(input).endsWith('/me')) return data(me)
      expect(String(input).endsWith(`/${path}`)).toBe(true)
      expect(init?.method).toBe(method)
      const body = JSON.parse(init!.body as string)
      expect(body.request_id).toBe(item.requestId)
      if (command.kind === 'automation') expect(body).not.toHaveProperty('action')
      if (command.kind === 'memory') expect(body.text).toBeNull()
      return data({ revision: 3 })
    })
    expect((await commands.run(client, item.requestId)).problem).toBeNull()
    expect(characterRequest(command, owner.characterId, owner.personId).target).toBe(
      command.kind === 'profile' ? owner.characterId : command.kind === 'automation' ? '31' : '42',
    )
  },
)

it('proactive route uses the original Person fingerprint and the original Person receipt, including cold lost-response recovery', async () => {
  const { path, box, commands } = setup()
  const destination = '00000000-0000-4000-8000-000000000005'
  const command: CharacterCommand = {
    kind: 'proactive-route',
    expectedRevision: 8,
    bindingId: destination,
  }
  const item = commands.prepare(command)
  expect(item.payloadHash).toBe(
    payloadHash('client.proactive_route', owner.personId, {
      expected_revision: 8,
      binding_id: destination,
    }),
  )
  let effects = 0
  const client = api(async (input, init) => {
    if (String(input).endsWith('/me')) return data(me)
    if (String(input).includes('/requests/'))
      return data({
        found: effects > 0,
        request_id: item.requestId,
        operation_kind: 'client.proactive_route',
        target: owner.personId,
        payload_hash: item.payloadHash,
        status: 'succeeded',
        result: { binding_id: destination, platform: 'qq', paused: false, revision: 9 },
      })
    expect(init?.method).toBe('PUT')
    expect(String(input)).toBe('http://localhost/role/client/v1/me/proactive-route')
    expect(JSON.parse(init!.body as string)).toEqual({
      request_id: item.requestId,
      binding_id: destination,
      expected_revision: 8,
    })
    effects++
    throw Error('lost after actual effect')
  })
  expect((await commands.run(client, item.requestId, true)).state).toBe('submitted')
  box.db.close()
  const recovered = new Outbox(path, owner)
  try {
    const replay = await new CharacterCommands(recovered).run(client, item.requestId, true)
    expect(replay.state).toBe('result')
    expect(replay.result).toMatchObject({ revision: 9 })
    expect(effects).toBe(1)
  } finally {
    recovered.db.close()
  }
})
