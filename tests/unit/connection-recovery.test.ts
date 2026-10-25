import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
import { Connections } from '../../src/main/connections'
import { LocalStore } from '../../src/main/store'

const id = '00000000-0000-4000-8000-000000000001',
  person = '00000000-0000-4000-8000-000000000002',
  binding = '00000000-0000-4000-8000-000000000003',
  conversation = '00000000-0000-4000-8000-000000000004',
  device = '00000000-0000-4000-8000-000000000005'
const meta = {
  api_revision: 7,
  capabilities: [],
  character: { id, display_name: 'Fixture' },
  min_client: { desktop: null },
}
const me = {
  person_id: person,
  source_person_id: person,
  request_person_id: person,
  request_conversation_id: null,
  request_scope: person,
  platform: 'app',
  presence_id: '00000000-0000-4000-8000-000000000006',
  thread_id: null,
  binding_id: binding,
  display_name: '本人',
  conversation_id: conversation,
  bindings: [
    {
      binding_id: binding,
      platform: 'app',
      source_person_id: person,
      display_name: '本人',
      status: 'active',
    },
  ],
  devices: [],
}
const resources: { root: string; store: LocalStore; connections: Connections }[] = []
function setup(connected = false) {
  const root = mkdtempSync(join(tmpdir(), 'yuki-connection-recovery-')),
    store = new LocalStore(join(root, 'local.sqlite3'))
  if (connected)
    store.set('connections', [
      {
        characterId: id,
        personId: person,
        bindingId: binding,
        conversationId: conversation,
        baseUrl: 'https://fixture.invalid',
        name: 'Fixture',
        persistentCredentials: false,
      },
    ])
  const connections = new Connections(store, root, '1.0.0-beta.1', () => {})
  resources.push({ root, store, connections })
  return connections
}
afterEach(async () => {
  for (const item of resources.splice(0)) {
    await item.connections.close()
    item.store.db.close()
    rmSync(item.root, { recursive: true, force: true })
  }
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('keeps the received device token across a failed first me and resumes without redeeming the consumed code', async () => {
  const connections = setup()
  vi.spyOn(connections, 'start').mockImplementation(() => {})
  let pairs = 0,
    fail = true
  vi.stubGlobal('fetch', async (input: string) => {
    const path = new URL(input).pathname
    if (path.endsWith('/meta')) return Response.json({ data: meta })
    if (path.endsWith('/pair')) {
      pairs++
      return Response.json({ data: { device_id: device, token: 'received-test-only' } })
    }
    if (path.endsWith('/me'))
      return fail
        ? Response.json({ problem: { code: 'unavailable' } }, { status: 503 })
        : Response.json({ data: me })
    throw Error('unexpected route')
  })
  await expect(
    connections.pair('https://fixture.invalid', 'one-use-code', 'Fixture'),
  ).rejects.toHaveProperty('code', 'unavailable')
  expect(connections.list()).toEqual([])
  expect(connections.pendingPairings()).toMatchObject([{ characterId: id, deviceId: device }])
  expect(connections.credentials.get(`pending-device/${id}/${device}`)).toBe('received-test-only')
  fail = false
  const result = await connections.resumePairing(id, device)
  expect(result.personId).toBe(person)
  expect(result.deviceId).toBe(device)
  expect(pairs).toBe(1)
  expect(connections.pendingPairings()).toEqual([])
})
it.each([false, true])(
  'does not attach a forgotten pending device after its me returns (existing connection: %s)',
  async (connected) => {
    const connections = setup(connected),
      original = connections.list(),
      started = vi.spyOn(connections, 'start').mockImplementation(() => {})
    if (connected) connections.credentials.set(`device/${id}/${person}`, 'original-device-only')
    let release!: () => void,
      reading!: () => void,
      reads = 0
    const blocked = new Promise<void>((resolve) => {
        release = resolve
      }),
      entered = new Promise<void>((resolve) => {
        reading = resolve
      })
    vi.stubGlobal('fetch', async (input: string) => {
      const path = new URL(input).pathname
      if (path.endsWith('/meta')) return Response.json({ data: meta })
      if (path.endsWith('/pair'))
        return Response.json({ data: { device_id: device, token: 'pending-device-only' } })
      if (path.endsWith('/me')) {
        if (++reads === (connected ? 2 : 1)) {
          reading()
          await blocked
        }
        return Response.json({ data: me })
      }
      throw Error('unexpected route')
    })
    const pairing = connections.pair('https://fixture.invalid', 'one-use-code', 'Fixture'),
      rejected = expect(pairing).rejects.toHaveProperty('code', 'precondition_failed')
    await entered
    connections.forgetPairing(id, device)
    release()
    await rejected
    expect(connections.list()).toEqual(original)
    expect(connections.pendingPairings()).toEqual([])
    expect(connections.credentials.get(`pending-device/${id}/${device}`)).toBeUndefined()
    expect(connections.credentials.get(`device/${id}/${person}`)).toBe(
      connected ? 'original-device-only' : undefined,
    )
    expect(started).not.toHaveBeenCalled()
  },
)
it('keeps the original connection when update suspension invalidates an in-flight pairing', async () => {
  const connections = setup(true),
    original = connections.list(),
    started = vi.spyOn(connections, 'start').mockImplementation(() => {})
  connections.credentials.set(`device/${id}/${person}`, 'original-device-only')
  let release!: () => void, reading!: () => void
  const blocked = new Promise<void>((resolve) => {
      release = resolve
    }),
    entered = new Promise<void>((resolve) => {
      reading = resolve
    })
  vi.stubGlobal('fetch', async (input: string) => {
    const path = new URL(input).pathname
    if (path.endsWith('/meta')) return Response.json({ data: meta })
    if (path.endsWith('/pair'))
      return Response.json({ data: { device_id: device, token: 'pending-device-only' } })
    if (path.endsWith('/me')) {
      reading()
      await blocked
      return Response.json({ data: me })
    }
    throw Error('unexpected route')
  })
  const pairing = connections.pair('https://fixture.invalid', 'one-use-code', 'Fixture'),
    rejected = expect(pairing).rejects.toHaveProperty('code', 'precondition_failed')
  await entered
  const suspension = connections.suspendForUpdate()
  release()
  await rejected
  await suspension.settled
  expect(connections.list()).toEqual(original)
  expect(connections.credentials.get(`device/${id}/${person}`)).toBe('original-device-only')
  expect(connections.pendingPairings()).toMatchObject([{ characterId: id, deviceId: device }])
  expect(connections.credentials.get(`pending-device/${id}/${device}`)).toBe('pending-device-only')
  expect(started).not.toHaveBeenCalled()
})
it('does not let an old in-flight request rearm a second polling chain after reconnect', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const connections = setup(true)
  connections.credentials.set(`device/${id}/${person}`, 'fixture-only')
  const box = connections.box(id),
    item = box.prepare('fixture pending message')
  box.update(item.requestId, 'accepted', 1)
  let release!: () => void,
    lookups = 0
  const first = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname
    if (path.endsWith('/meta')) return Response.json({ data: meta })
    if (path.endsWith('/me')) return Response.json({ data: me })
    if (path.endsWith('/stream'))
      return new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.close(), { once: true })
          },
        }),
      )
    if (path.includes('/requests/')) {
      lookups++
      if (lookups === 1) await first
      return Response.json({
        data: {
          found: true,
          operation_kind: 'message',
          payload_hash: item.payloadHash,
          target: conversation,
          event_id: 1,
          turn: { state: 'running' },
        },
      })
    }
    throw Error('unexpected route')
  })
  connections.start(id)
  await vi.advanceTimersByTimeAsync(1000)
  expect(lookups).toBe(1)
  connections.reconnect()
  await vi.advanceTimersByTimeAsync(500)
  release()
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(500)
  expect(lookups).toBe(2)
  await vi.advanceTimersByTimeAsync(1500)
  expect(lookups).toBe(2)
  await vi.advanceTimersByTimeAsync(500)
  expect(lookups).toBe(3)
  await connections.close()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(lookups).toBe(3)
})
