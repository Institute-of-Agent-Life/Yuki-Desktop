import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
  api_revision: 7,
  capabilities: ['character', 'soul'],
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
  presence_id: '00000000-0000-4000-8000-000000000099',
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
it.each([undefined, 3])(
  'projects real native readiness separately from the device connection and preserves its source IDs (server protocol: %s)',
  async (serverProtocol) => {
    const connections = setup()
    connections.credentials.set(
      `device/${original.characterId}/${original.personId}`,
      'fixture-only',
    )
    vi.stubGlobal('fetch', async (input: string) => {
      if (input.endsWith('/meta')) return data('Envelope_Meta_', meta)
      if (input.endsWith('/me')) return data('Envelope_Me_', me)
      expect(input).toBe(`${original.baseUrl}/agents/v1/devices`)
      return Response.json({
        ...(serverProtocol !== undefined ? { connector_protocol: serverProtocol } : {}),
        devices: [{ id: 'original-device', label: 'My computer', online: true }],
        instances: [
          {
            id: 'server-instance',
            local_id: 'original-native-instance',
            device_id: 'original-device',
            label: 'My Codex',
            driver: 'codex',
            online: false,
            status: 'unavailable',
            error_type: 'native_login_required',
          },
        ],
      })
    })
    expect(await connections.connectorAdmission(original.characterId, 'original-device')).toEqual({
      matched: true,
      connected: true,
      ...(serverProtocol !== undefined ? { serverProtocol } : {}),
      instances: [
        {
          id: 'server-instance',
          localId: 'original-native-instance',
          label: 'My Codex',
          driver: 'codex',
          online: false,
          status: 'unavailable',
          errorType: 'native_login_required',
        },
      ],
    })
  },
)
it('terminal control uses the original device credentials and request ID without replaying a lost POST', async () => {
  const connections = setup()
  connections.credentials.set(`device/${original.characterId}/${original.personId}`, 'fixture-only')
  const posts: RequestInit[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    if (input.endsWith('/meta')) return data('Envelope_Meta_', meta)
    if (input.endsWith('/me')) return data('Envelope_Me_', me)
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fixture-only')
    if (init.method === 'POST') {
      expect(input).toBe(`${original.baseUrl}/agents/v1/terminals/original-run/control`)
      posts.push(init)
      throw Error('Response lost after the original control was accepted')
    }
    expect(input).toBe(
      `${original.baseUrl}/agents/v1/terminals/original-run/controls/original-control`,
    )
    return Response.json({ request_id: 'original-control', status: 'completed' })
  })
  await expect(
    connections.agentRequest(original.characterId, 'terminals/original-run/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: 'original-control', action: 'cancel' }),
    }),
  ).rejects.toHaveProperty('code', 'transport_unknown')
  expect(
    await connections.agentRead(
      original.characterId,
      'terminals/original-run/controls/original-control',
    ),
  ).toEqual({ request_id: 'original-control', status: 'completed' })
  expect(posts).toHaveLength(1)
  expect(JSON.parse(posts[0]!.body as string)).toEqual({
    request_id: 'original-control',
    action: 'cancel',
  })
})
it.each([false, true])(
  'shares an initial message POST with SSE verification until its response settles (lost response: %s)',
  async (lostResponse) => {
    const connections = setup(),
      box = connections.box(original.characterId),
      posts: { request_id: string; text: string; attachments: string[] }[] = [],
      receiptReads: string[] = []
    connections.credentials.set(
      `device/${original.characterId}/${original.personId}`,
      'fixture-only',
    )
    let releasePost!: () => void,
      enteredPost!: () => void,
      openedStream!: () => void,
      enteredVerification!: () => void,
      stream!: ReadableStreamDefaultController<Uint8Array>,
      accepted = false
    const postGate = new Promise<void>((resolve) => (releasePost = resolve)),
      posted = new Promise<void>((resolve) => (enteredPost = resolve)),
      streaming = new Promise<void>((resolve) => (openedStream = resolve)),
      hintVerification = new Promise<void>((resolve) => (enteredVerification = resolve))
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      const path = new URL(input).pathname
      if (path.endsWith('/meta')) return data('Envelope_Meta_', meta)
      if (path.endsWith('/me')) return data('Envelope_Me_', me)
      if (path.endsWith('/stream')) {
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => (stream = controller),
        })
        init.signal?.addEventListener('abort', () => stream.close(), { once: true })
        openedStream()
        return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
      }
      if (path.endsWith('/messages')) {
        const body = JSON.parse(init.body as string) as (typeof posts)[number]
        posts.push(body)
        enteredPost()
        await postGate
        accepted = true
        if (lostResponse) throw Error('The committed message response was lost')
        return data('Envelope_MessageReceipt_', {
          request_id: body.request_id,
          event_id: 11,
          state: 'accepted',
          replay: false,
        })
      }
      const requestId = path.split('/').at(-1)!
      if (path.includes('/requests/')) {
        receiptReads.push(requestId)
        return data(
          'Envelope_RequestReceipt_',
          accepted
            ? {
                found: true,
                operation_kind: 'message',
                target: original.conversationId,
                payload_hash: box.get(requestId).payloadHash,
                event_id: 11,
                turn: { state: 'running', outcome: null },
                result_event_ids: [],
              }
            : { found: false },
        )
      }
      throw Error(`Unexpected route: ${path}`)
    })
    connections.start(original.characterId)
    await streaming
    const sending = connections.send(original.characterId, 'Keep this original request')
    await posted
    const prepared = box.list()[0]!
    const verify = connections.verify.bind(connections)
    vi.spyOn(connections, 'verify').mockImplementation((...args) => {
      const result = verify(...args)
      enteredVerification()
      return result
    })
    stream.enqueue(new TextEncoder().encode('event: conversation\ndata: {}\n\n'))
    await hintVerification
    const verifying = connections.verify(original.characterId, prepared.requestId)
    try {
      await new Promise((resolve) => setImmediate(resolve))
      expect(posts).toEqual([prepared.body])
      expect(receiptReads).toEqual([])
      expect(box.get(prepared.requestId)).toMatchObject({ state: 'submitted', eventId: null })
    } finally {
      releasePost()
      await Promise.all([sending, verifying])
    }
    expect(await verifying).toEqual(await sending)
    expect(box.list()).toHaveLength(1)
    const recovered = await connections.verify(original.characterId, prepared.requestId)
    expect(recovered).toMatchObject({
      requestId: prepared.requestId,
      body: prepared.body,
      state: 'accepted',
      eventId: 11,
      problem: null,
    })
    expect(receiptReads).toEqual([prepared.requestId])
    expect(posts).toEqual([prepared.body])
  },
)
it('uses the actual product route without a metadata capability gate and preserves server authorization', async () => {
  const connections = setup(),
    calls: string[] = []
  connections.credentials.set(`device/${original.characterId}/${original.personId}`, 'fixture-only')
  vi.stubGlobal('fetch', async (input: string) => {
    calls.push(input)
    if (input.endsWith('/meta'))
      return data('Envelope_Meta_', { ...meta, min_client: { desktop: null, android: null } })
    if (input.endsWith('/me')) return data('Envelope_Me_', me)
    if (input.endsWith('/computer'))
      return Response.json({ problem: { code: 'owner_required' } }, { status: 403 })
    throw Error('Unexpected route')
  })
  await expect(connections.read(original.characterId, { kind: 'computer' })).rejects.toHaveProperty(
    'code',
    'owner_required',
  )
  expect(await connections.read(original.characterId, { kind: 'me' })).toEqual(me)
  expect(calls.some((path) => path.endsWith('/computer'))).toBe(true)
})
it('keeps verified avatar bytes offline, rejects a damaged cache and clears it after known revocation', async () => {
  const connections = setup()
  connections.credentials.set(`device/${original.characterId}/${original.personId}`, 'fixture-only')
  const png = readFileSync(new URL('../fixtures/avatar-white.png', import.meta.url))
  const sha = createHash('sha256').update(png).digest('hex')
  let state: 'online' | 'offline' | 'revoked' = 'online',
    downloads = 0
  vi.stubGlobal('fetch', async (input: string) => {
    if (input.endsWith('/meta')) return data('Envelope_Meta_', meta)
    if (input.endsWith('/me')) return data('Envelope_Me_', me)
    if (state === 'offline') throw Error('offline')
    if (state === 'revoked')
      return Response.json({ problem: { code: 'unauthenticated' } }, { status: 401 })
    downloads++
    return new Response(png, {
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(png.length) },
    })
  })
  const both = await Promise.all([
    connections.avatarBytes(original.characterId, sha, 1024),
    connections.avatarBytes(original.characterId, sha, 1024),
  ])
  expect(downloads).toBe(1)
  expect(Buffer.from(both[0]!)).toEqual(png)
  state = 'offline'
  expect(Buffer.from(await connections.avatarBytes(original.characterId, sha, 1024))).toEqual(png)
  const box = connections.box(original.characterId),
    key = `avatar/${sha}/1024`,
    cached = box.cached<{ bytes: string; sha256: string }>(key)!
  box.cache(key, { ...cached, bytes: Buffer.from('damaged').toString('base64') })
  await expect(connections.avatarBytes(original.characterId, sha, 1024)).rejects.toMatchObject({
    code: 'content_hash_mismatch',
  })
  box.cache(key, cached)
  state = 'revoked'
  await expect(connections.avatarBytes(original.characterId, sha, 1024)).rejects.toMatchObject({
    code: 'unauthenticated',
  })
  expect(box.cached(key)).toBeUndefined()
  state = 'offline'
  await expect(connections.avatarBytes(original.characterId, sha, 1024)).rejects.toMatchObject({
    code: 'transport_unknown',
  })
})

it('re-pairing after a Person merge proves access to the old binding and keeps its original outbox', async () => {
  const connections = setup(),
    box = connections.box(original.characterId)
  box.draft('original private draft')
  const entries: string[] = []
  vi.stubGlobal('fetch', async (raw: string, init: RequestInit) => {
    const path = new URL(raw).pathname
    if (path.endsWith('/meta')) return data('Envelope_Meta_', meta)
    if (path.endsWith('/pair'))
      return data('Envelope_PairReceipt_', {
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
      return data('Envelope_PairReceipt_', {
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
  [{ ...meta, api_revision: 3 }, 'server_upgrade_required'],
  [{ ...meta, api_revision: 4 }, 'server_upgrade_required'],
  [{ ...meta, api_revision: 6 }, 'server_upgrade_required'],
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
    latest_event_id: 0,
    next_after: 0,
    next_before: null,
  }
  let failure = ''
  vi.stubGlobal('fetch', async (raw: string) => {
    if (raw.endsWith('/meta')) return data('Envelope_Meta_', meta)
    if (failure === 'transport') throw new Error('disconnected')
    if (failure) return Response.json({ problem: { code: failure } }, { status: 404 })
    return data('Envelope_Events_', page)
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

it.each([
  ['different_character', { ...meta, character: { ...meta.character, id: merged } }],
  ['server_upgrade_required', { ...meta, api_revision: 3 }],
] as const)(
  'address changes stop before credentials when public identity rejects %s',
  async (code, value) => {
    const connections = setup(),
      box = connections.box(original.characterId)
    connections.credentials.set(
      `device/${original.characterId}/${original.personId}`,
      'private-test-credential',
    )
    box.draft('original unsent draft')
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      calls.push(input)
      expect(init.headers).not.toHaveProperty('Authorization')
      return data('Envelope_Meta_', value)
    })
    await expect(
      connections.changeAddress(original.characterId, 'https://new.test/role'),
    ).rejects.toHaveProperty('code', code)
    expect(calls).toEqual(['https://new.test/role/client/v1/meta'])
    expect(connections.connection(original.characterId)).toEqual(original)
    expect(box.draft()).toBe('original unsent draft')
  },
)
it('address changes require the original source, request Person, conversation and App binding', async () => {
  const connections = setup(),
    box = connections.box(original.characterId)
  connections.credentials.set(
    `device/${original.characterId}/${original.personId}`,
    'private-test-credential',
  )
  box.draft('keep original draft')
  for (const changed of [
    { ...me, source_person_id: merged },
    { ...me, request_person_id: merged },
    { ...me, conversation_id: merged },
    { ...me, bindings: [] },
  ]) {
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      if (input.endsWith('/meta')) {
        expect(init.headers).not.toHaveProperty('Authorization')
        return data('Envelope_Meta_', meta)
      }
      expect(init.headers).toHaveProperty('X-Yuki-Entry', original.bindingId)
      expect(init.headers).toHaveProperty('Authorization', 'Bearer private-test-credential')
      return data('Envelope_Me_', changed)
    })
    await expect(
      connections.changeAddress(original.characterId, 'https://new.test/role'),
    ).rejects.toHaveProperty('code', 'outbox_owner_mismatch')
    expect(connections.connection(original.characterId)).toEqual(original)
    expect(box.draft()).toBe('keep original draft')
  }
})
it('a verified new address preserves the same request UUID and body when its original receipt is absent', async () => {
  const connections = setup(),
    box = connections.box(original.characterId),
    item = box.prepare('original pending message')
  connections.credentials.set(
    `device/${original.characterId}/${original.personId}`,
    'private-test-credential',
  )
  const start = vi.spyOn(connections, 'start').mockImplementation(() => {})
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    calls.push(input)
    if (input.endsWith('/meta')) return data('Envelope_Meta_', meta)
    expect(init.headers).toHaveProperty('X-Yuki-Entry', original.bindingId)
    if (input.endsWith('/me')) return data('Envelope_Me_', me)
    if (input.endsWith(`/requests/${item.requestId}`))
      return data('Envelope_RequestReceipt_', { found: false, request_id: item.requestId })
    expect(input).toBe('https://new.test/role/client/v1/messages')
    expect(JSON.parse(init.body as string)).toEqual(item.body)
    return data('Envelope_MessageReceipt_', {
      request_id: item.requestId,
      event_id: 1,
      state: 'accepted',
      replay: false,
    })
  })
  await connections.changeAddress(original.characterId, 'https://new.test/role/')
  expect(start).toHaveBeenCalledWith(original.characterId)
  expect(connections.connection(original.characterId)).toEqual({
    ...original,
    baseUrl: 'https://new.test/role',
  })
  expect((await connections.verify(original.characterId, item.requestId)).requestId).toBe(
    item.requestId,
  )
  expect(box.get(item.requestId).body).toEqual(item.body)
  expect(calls.every((value) => value.startsWith('https://new.test/role/'))).toBe(true)
})
it('a delayed address proof cannot replace a newer user address choice', async () => {
  const connections = setup()
  connections.credentials.set(
    `device/${original.characterId}/${original.personId}`,
    'private-test-credential',
  )
  vi.spyOn(connections, 'start').mockImplementation(() => {})
  let release!: () => void, blocked!: () => void
  const entered = new Promise<void>((resolve) => {
      blocked = resolve
    }),
    wait = new Promise<void>((resolve) => {
      release = resolve
    })
  vi.stubGlobal('fetch', async (input: string) => {
    if (input.endsWith('/meta')) return data('Envelope_Meta_', meta)
    if (input.startsWith('https://old-choice.test')) {
      blocked()
      await wait
    }
    return data('Envelope_Me_', me)
  })
  const first = connections.changeAddress(original.characterId, 'https://old-choice.test')
  const rejected = expect(first).rejects.toHaveProperty('code', 'precondition_failed')
  await entered
  await connections.changeAddress(original.characterId, 'https://latest-choice.test')
  release()
  await rejected
  expect(connections.connection(original.characterId).baseUrl).toBe('https://latest-choice.test')
})
