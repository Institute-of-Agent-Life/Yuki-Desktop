import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { AvatarCommands } from '../../src/main/outbox/avatar-commands'
import { ApiClient } from '../../src/main/api/client'
import type { Me, OutboxOwner, Profile } from '../../src/shared/api'
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
  presence_id: null,
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

const png = readFileSync(new URL('../fixtures/avatar-white.png', import.meta.url))
const profile: Profile = {
  id: owner.characterId,
  slug: 'test',
  display_name: '測試角色',
  bio: '',
  revision: 1,
  avatar_revision: 1,
  avatar: null,
  default_avatar: null,
  accent: { light: '#123456', dark: '#abcdef' },
  viewer: { is_owner: true },
}
const resources: { root: string; box: Outbox }[] = []
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'yd-avatar-')),
    path = join(root, 'box.sqlite3'),
    box = new Outbox(path, owner)
  resources.push({ root, box })
  return { path, box, commands: new AvatarCommands(box) }
}
afterEach(() => {
  for (const { root, box } of resources.splice(0)) {
    if (box.db.open) box.db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
const data = (value: unknown) => Response.json({ data: value })
const api = (fetcher: typeof fetch) =>
  new ApiClient('http://localhost/role', 'test-only', owner.bindingId, '1.0.0-beta.1', fetcher)

it('persists the normalized PNG and recovers one committed upload after a lost response and cold restart', async () => {
  const { box, path, commands } = setup(),
    item = commands.prepare(0, png)
  let effects = 0
  const client = api(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/me')) return data(me)
    if (url.includes('/requests/'))
      return data({
        found: effects > 0,
        operation_kind: 'client.character_avatar',
        target: owner.characterId,
        payload_hash: item.payloadHash,
        status: 'succeeded',
        result: profile,
      })
    expect(init?.method).toBe('PUT')
    expect(Buffer.from(init!.body as ArrayBuffer)).toEqual(png)
    expect(new URL(url).searchParams.get('request_id')).toBe(item.requestId)
    expect(new URL(url).searchParams.get('size')).toBe(String(png.length))
    effects++
    throw Error('lost after commit')
  })
  expect((await commands.run(client, item.requestId)).state).toBe('submitted')
  expect(commands.prepare(0, png).requestId).toBe(item.requestId)
  box.db.close()
  const recovered = new Outbox(path, owner)
  try {
    const result = await new AvatarCommands(recovered).run(client, item.requestId)
    expect(result.result).toEqual(profile)
    expect(result.state).toBe('result')
    expect(effects).toBe(1)
  } finally {
    recovered.db.close()
  }
})
it('retains a two-device conflict and only uses a new baseline on a new explicit request', async () => {
  const { commands } = setup(),
    item = commands.prepare(0, png)
  let writes = 0
  const client = api(async (input, init) => {
    if (String(input).endsWith('/me')) return data(me)
    if (String(input).includes('/requests/')) return data({ found: false })
    writes++
    expect(init?.method).toBe('PUT')
    return Response.json(
      { problem: { code: 'version_conflict', current: profile } },
      { status: 409 },
    )
  })
  const conflict = await commands.run(client, item.requestId)
  expect(conflict.expectedRevision).toBe(0)
  expect(conflict.current?.avatar_revision).toBe(1)
  expect(commands.draft(item.requestId)?.bytes).toEqual(new Uint8Array(png))
  expect((await commands.run(client, item.requestId)).problem).toBe('version_conflict')
  expect(writes).toBe(1)
  commands.acknowledge(item.requestId)
  expect(commands.get(item.requestId).acknowledged).toBe(true)
  expect(commands.get(item.requestId).problem).toBe('version_conflict')
  expect(commands.draft(item.requestId)?.bytes).toEqual(new Uint8Array(png))
  const replacement = commands.prepare(1, png)
  expect(replacement.requestId).not.toBe(item.requestId)
  expect(replacement.expectedRevision).toBe(1)
})
it('does not resend an inaccessible original receipt or a receipt from another character', async () => {
  const { commands } = setup(),
    item = commands.prepare(0, png)
  const missing = api(async (input) =>
    String(input).endsWith('/me')
      ? data(me)
      : Response.json({ problem: { code: 'not_found' } }, { status: 404 }),
  )
  expect((await commands.run(missing, item.requestId)).problem).toBe('not_found')
  const next = commands.prepare(0, png)
  const mismatch = api(async (input) =>
    String(input).endsWith('/me')
      ? data(me)
      : data({
          found: true,
          operation_kind: 'client.character_avatar',
          target: owner.personId,
          payload_hash: next.payloadHash,
          status: 'succeeded',
          result: profile,
        }),
  )
  expect((await commands.run(mismatch, next.requestId)).problem).toBe('request_conflict')
})
it('resets through the original DELETE contract and stops a damaged local PNG before dispatch', async () => {
  const { commands, box } = setup(),
    reset = commands.prepare(1)
  const client = api(async (input, init) => {
    if (String(input).endsWith('/me')) return data(me)
    expect(String(input).endsWith('/character/avatar')).toBe(true)
    expect(init?.method).toBe('DELETE')
    expect(JSON.parse(init!.body as string)).toEqual({
      request_id: reset.requestId,
      expected_revision: 1,
    })
    return data({ ...profile, avatar_revision: 2 })
  })
  expect((await commands.run(client, reset.requestId, false)).result?.avatar_revision).toBe(2)
  const item = commands.prepare(2, png)
  box.db
    .prepare('UPDATE avatar_commands SET png=? WHERE request_id=?')
    .run(Buffer.from('damaged'), item.requestId)
  expect(
    (
      await commands.run(
        api(async (input) => (String(input).endsWith('/me') ? data(me) : data({ found: false }))),
        item.requestId,
      )
    ).problem,
  ).toBe('content_hash_mismatch')
})
