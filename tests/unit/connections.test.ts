import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
import { Connections } from '../../src/main/connections'
import { LocalStore } from '../../src/main/store'
import type { Connection, EventsPage, Me, Meta } from '../../src/shared/api'
import { validateFixture } from '../fixtures/schema'

const original: Connection = {
  characterId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  conversationId: '00000000-0000-4000-8000-000000000003',
  bindingId: '00000000-0000-4000-8000-000000000004',
  baseUrl: 'http://localhost/role/yuki',
  name: 'Test',
  persistentCredentials: false,
}
const merged = '00000000-0000-4000-8000-000000000005'
const meta: Meta = {
  api_revision: 3,
  server_version: 'test',
  character: {
    id: original.characterId,
    display_name: 'Test',
    accent: { light: '#123456', dark: '#abcdef' },
    avatar_url: null,
  },
  min_client: { desktop: '1.0.0-beta.1', android: null },
}
const me: Me = {
  person_id: merged,
  source_person_id: original.personId,
  request_person_id: original.personId,
  request_conversation_id: null,
  request_scope: original.personId,
  platform: 'app',
  presence_id: null,
  thread_id: null,
  binding_id: original.bindingId,
  display_name: 'Original',
  conversation_id: original.conversationId,
  bindings: [
    {
      binding_id: original.bindingId,
      source_person_id: original.personId,
      platform: 'app',
      display_name: 'Original',
      status: 'active',
    },
  ],
  devices: [],
}
const resources: { path: string; store: LocalStore; connections: Connections }[] = []
function setup() {
  const path = mkdtempSync(join(tmpdir(), 'yuki-connections-')),
    store = new LocalStore(join(path, 'local.sqlite3'))
  store.set('connections', [original])
  const connections = new Connections(store, path, '1.0.0-beta.1', () => {})
  resources.push({ path, store, connections })
  return connections
}
afterEach(async () => {
  for (const item of resources.splice(0)) {
    item.connections.close()
    await new Promise((resolve) => setImmediate(resolve))
    item.store.db.close()
    rmSync(item.path, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
})
function data(schema: string, value: unknown) {
  validateFixture(schema, { data: value })
  return Response.json({ data: value })
}

it('re-pairing after a Person merge proves access to the old binding and keeps its original outbox', async () => {
  const connections = setup(),
    box = connections.box(original.characterId)
  box.draft('original private draft')
  const entries: string[] = []
  vi.stubGlobal('fetch', async (raw: string, init: RequestInit) => {
    const path = new URL(raw).pathname
    if (path.endsWith('/meta')) return data('Envelope_Meta_', meta)
    if (path.endsWith('/pair'))
      return data('Envelope_PairResult_', {
        token: 'test-new-device',
        device_id: '00000000-0000-4000-8000-000000000006',
      })
    if (path.endsWith('/me')) {
      const entry = (init.headers as Record<string, string>)['X-Yuki-Entry']
      entries.push(entry ?? 'default')
      return data(
        'Envelope_Me_',
        entry === original.bindingId
          ? me
          : {
              ...me,
              request_person_id: merged,
              request_scope: merged,
              binding_id: merged,
              conversation_id: merged,
            },
      )
    }
    return new Response('')
  })
  const paired = await connections.pair(original.baseUrl, 'A'.repeat(32), 'test device')
  expect(entries).toContain(original.bindingId)
  expect(paired).toMatchObject({
    personId: original.personId,
    bindingId: original.bindingId,
    conversationId: original.conversationId,
  })
  expect(connections.box(original.characterId).draft()).toBe('original private draft')
  expect(connections.client(original.characterId).token).toBe('test-new-device')
  expect(connections.publicList()[0]?.needsPairing).toBe(false)
})

it('a different Person cannot acquire the previous owner outbox, and only the new device is revoked', async () => {
  const connections = setup()
  connections.credentials.set(
    `device/${original.characterId}/${original.personId}`,
    'original-device',
  )
  connections.box(original.characterId).draft('never transfer this draft')
  const revoked: string[] = []
  vi.stubGlobal('fetch', async (raw: string, init: RequestInit) => {
    const path = new URL(raw).pathname
    if (path.endsWith('/meta')) return data('Envelope_Meta_', meta)
    if (path.endsWith('/pair'))
      return data('Envelope_PairResult_', {
        token: 'different-person-device',
        device_id: '00000000-0000-4000-8000-000000000006',
      })
    if (init.method === 'DELETE') {
      revoked.push(path)
      return Response.json({ data: {} })
    }
    if ((init.headers as Record<string, string>)['X-Yuki-Entry'])
      return Response.json({ problem: { code: 'not_found' } }, { status: 404 })
    return data('Envelope_Me_', { ...me, request_person_id: merged, request_scope: merged })
  })
  await expect(connections.pair(original.baseUrl, 'A'.repeat(32), 'foreign')).rejects.toThrow(
    'different_person',
  )
  expect(connections.client(original.characterId).token).toBe('original-device')
  expect(connections.box(original.characterId).draft()).toBe('never transfer this draft')
  expect(revoked).toEqual(['/role/yuki/client/v1/devices/00000000-0000-4000-8000-000000000006'])
  expect(connections.list()).toEqual([original])
})

it('a new session without a keyring requests pairing and preserves the existing local owner', () => {
  const connections = setup()
  expect(connections.publicList()[0]).toMatchObject({
    needsPairing: true,
    personId: original.personId,
  })
})

it.each([
  [{ ...meta, character: { ...meta.character, id: merged } }, 'different_character'],
  [{ ...meta, api_revision: 2 }, 'server_upgrade_required'],
  [{ ...meta, min_client: { desktop: '2.0.0', android: null } }, 'client_upgrade_required'],
] as const)(
  'checks instance identity and compatibility before sending credentials or changing outbox',
  async (response, code) => {
    const connections = setup()
    connections.credentials.set(
      `device/${original.characterId}/${original.personId}`,
      'private-token',
    )
    const box = connections.box(original.characterId)
    box.draft('keep this draft')
    const requests: { path: string; authorization?: string }[] = []
    vi.stubGlobal('fetch', async (raw: string, init: RequestInit) => {
      requests.push({
        path: new URL(raw).pathname,
        authorization: (init.headers as Record<string, string>).Authorization,
      })
      return data('Envelope_Meta_', response)
    })
    await expect(connections.send(original.characterId, 'keep this draft')).rejects.toThrow(code)
    expect(requests).toEqual([{ path: '/role/yuki/client/v1/meta', authorization: undefined }])
    expect(box.draft()).toBe('keep this draft')
    expect(box.list()).toEqual([])
  },
)

it('uses the durable owner cache only for transport failure and clears private facts after authorization fails', async () => {
  const connections = setup()
  connections.credentials.set(
    `device/${original.characterId}/${original.personId}`,
    'private-token',
  )
  const page: EventsPage = {
    items: [],
    generation: 1,
    revision: 4,
    has_more: false,
    latest_event_id: null,
    next_after: 0,
    next_before: null,
  }
  let failure = ''
  vi.stubGlobal('fetch', async (raw: string) => {
    if (raw.endsWith('/meta')) return data('Envelope_Meta_', meta)
    if (failure === 'transport') throw new Error('disconnected')
    if (failure) return Response.json({ problem: { code: failure } }, { status: 404 })
    return data('Envelope_EventsPage_', page)
  })
  const route = { kind: 'events', conversationId: original.conversationId } as const
  expect(await connections.read(original.characterId, route)).toEqual(page)
  failure = 'transport'
  expect(await connections.read(original.characterId, route)).toEqual(page)
  failure = 'not_found'
  await expect(connections.read(original.characterId, route)).rejects.toThrow('not_found')
  failure = 'transport'
  await expect(connections.read(original.characterId, route)).rejects.toThrow('transport_unknown')
})
