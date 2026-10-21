import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
const faults = vi.hoisted(() => ({ unlink: false }))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: async (path: Parameters<typeof actual.rm>[0], options: Parameters<typeof actual.rm>[1]) => {
      if (faults.unlink && String(path).endsWith('.sqlite3')) {
        faults.unlink = false
        throw Object.assign(Error('unlink failed'), { code: 'EACCES' })
      }
      return actual.rm(path, options)
    },
  }
})
import { Connections } from '../../src/main/connections'
import { LocalStore } from '../../src/main/store'
import { Outbox } from '../../src/main/outbox'
import { ExecutorInstallation } from '../../src/main/executor/installation'
import type { Connection, Me, Meta } from '../../src/shared/api'
const connection: Connection = {
  characterId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  conversationId: '00000000-0000-4000-8000-000000000003',
  bindingId: '00000000-0000-4000-8000-000000000004',
  deviceId: '00000000-0000-4000-8000-000000000005',
  baseUrl: 'http://localhost/role',
  name: 'Yuki',
  persistentCredentials: false,
}
const meta: Meta = {
  api_revision: 5,
  server_version: 'test',
  character: {
    id: connection.characterId,
    display_name: 'Yuki',
    accent: { light: '#123456', dark: '#abcdef' },
    avatar_url: null,
  },
  min_client: { desktop: '1.0.0-beta.1', android: null },
}
const me: Me = {
  person_id: connection.personId,
  source_person_id: connection.personId,
  request_person_id: connection.personId,
  request_scope: connection.personId,
  request_conversation_id: null,
  platform: 'app',
  presence_id: null,
  thread_id: null,
  binding_id: connection.bindingId,
  display_name: '本人',
  conversation_id: connection.conversationId,
  bindings: [
    {
      binding_id: connection.bindingId,
      source_person_id: connection.personId,
      platform: 'app',
      display_name: '',
      status: 'active',
    },
  ],
  devices: [],
}
const resources: { path: string; store: LocalStore; client: Connections; other?: Outbox }[] = []
function setup() {
  const path = mkdtempSync(join(tmpdir(), 'yd-logout-')),
    store = new LocalStore(join(path, 'desktop.sqlite3'))
  store.set('connections', [connection])
  const client = new Connections(store, path, '1.0.0-beta.1', () => {})
  vi.spyOn(client, 'start').mockImplementation(() => {})
  client.credentials.set(
    `device/${connection.characterId}/${connection.personId}`,
    'original-test-token',
  )
  const item = { path, store, client }
  resources.push(item)
  return item
}
afterEach(async () => {
  for (const r of resources.splice(0)) {
    r.client.close()
    await new Promise((resolve) => setImmediate(resolve))
    r.other?.db.close()
    r.store.db.close()
    rmSync(r.path, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
  faults.unlink = false
})
const data = (value: unknown) => Response.json({ data: value })
function server(options: { lost?: boolean; offline?: boolean } = {}) {
  let revoked = false
  const deletes: string[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    if (options.offline) throw Error('offline')
    if (input.endsWith('/meta')) return data(meta)
    if (input.endsWith('/me'))
      return revoked
        ? Response.json({ problem: { code: 'unauthenticated' } }, { status: 401 })
        : data(me)
    if (input.includes('/requests/')) return data({ found: false })
    if (init.method === 'DELETE') {
      deletes.push(input)
      revoked = true
      if (options.lost) throw Error('lost after commit')
      return data({ device_id: connection.deviceId, revoked: true, replay: false })
    }
    throw Error('unexpected path')
  })
  return { deletes }
}
it('pauses local dispatch and persists its original command even while public identity is offline', async () => {
  const { client } = setup(),
    box = client.box(connection.characterId),
    installation = new ExecutorInstallation(client.credentials, box.owner),
    executorId = '00000000-0000-4000-8000-000000000007'
  installation.install(executorId, 'executor-only-test-token')
  server({ offline: true })
  await expect(
    client.executorAction(connection.characterId, { kind: 'pause', executorId }),
  ).rejects.toThrow('transport_unknown')
  expect(installation.current()?.localPaused).toBe(true)
  const pending = client.executorCommands(connection.characterId)
  expect(pending).toHaveLength(1)
  expect(pending[0]).toMatchObject({ state: 'submitted', command: { kind: 'pause', executorId } })
  expect(JSON.stringify(pending)).not.toContain('executor-only-test-token')
})

it('starts an installed executor with only its own credential when no chat credential is present', async () => {
  const { client } = setup(),
    box = client.box(connection.characterId),
    installation = new ExecutorInstallation(client.credentials, box.owner)
  installation.install('00000000-0000-4000-8000-000000000007', 'executor-only-test-token')
  client.credentials.remove(`device/${connection.characterId}/${connection.personId}`)
  const paths: string[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname
    paths.push(path)
    if (path.endsWith('/client/v1/meta')) {
      expect(new Headers(init.headers).has('Authorization')).toBe(false)
      return data(meta)
    }
    expect(path).toContain('/executor/v1/')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer executor-only-test-token')
    expect(new Headers(init.headers).has('X-Yuki-Entry')).toBe(false)
    if (path.endsWith('/config'))
      return data({
        executor_id: installation.current()!.executorId,
        grants: [],
        grants_digest: 'empty',
        paused: false,
      })
    if (path.endsWith('/heartbeat')) return data({ grants_digest: 'empty', paused: false })
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: sync\ndata: {"pending":[]}\n\n'))
          init.signal?.addEventListener('abort', () => controller.close(), { once: true })
        },
      }),
    )
  })
  Connections.prototype.start.call(client, connection.characterId)
  await vi.waitFor(() => expect(client.executorState(connection.characterId).state).toBe('online'))
  expect(paths.some((path) => path.endsWith('/client/v1/me'))).toBe(false)
})

it('logout drains a prior activity before revoking and keeps original drafts for the same Person', async () => {
  const { client, path } = setup(),
    box = client.box(connection.characterId)
  box.draft('original unsent draft')
  const file = box.db.name
  const backend = server()
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const read = client.activity(connection.characterId, async () => {
    await blocked
    box.cache('late-original-read', { private: 'belongs to original owner' })
  })
  let complete = false
  const logout = client.prepareLogout(connection.characterId).then((r) => {
    complete = true
    return r
  })
  await expect(
    client.activity(connection.characterId, () => box.draft('must not replace')),
  ).rejects.toHaveProperty('code', 'logout_pending')
  await Promise.resolve()
  expect(complete).toBe(false)
  expect(backend.deletes).toHaveLength(0)
  release()
  await read
  const summary = await logout
  expect(summary).toMatchObject({
    drafts: 1,
    pending: 0,
    attachments: 0,
    connection: { logout: { drafts: 1 } },
  })
  await client.finishLogout(connection.characterId, connection.deviceId!, 'keep')
  expect(client.list()).toEqual([])
  expect(
    client.credentials.get(`device/${connection.characterId}/${connection.personId}`),
  ).toBeUndefined()
  expect(existsSync(file)).toBe(true)
  const recovered = new Outbox(file, {
    characterId: connection.characterId,
    personId: connection.personId,
    bindingId: connection.bindingId,
    conversationId: connection.conversationId,
  })
  expect(recovered.draft()).toBe('original unsent draft')
  expect(recovered.cached('late-original-read')).toEqual({ private: 'belongs to original owner' })
  recovered.db.close()
  expect(existsSync(path)).toBe(true)
})
it('a lost self-revocation response uses actual credential invalidity without inventing a receipt', async () => {
  const { client } = setup()
  server({ lost: true })
  const summary = await client.prepareLogout(connection.characterId)
  expect(summary.pending).toBe(1)
  expect(client.characterCommands(connection.characterId).list()[0]).toMatchObject({
    state: 'submitted',
    problem: 'transport_unknown',
  })
  await client.finishLogout(connection.characterId, connection.deviceId!, 'keep')
  expect(client.list()).toEqual([])
})
it('unconfirmed offline logout keeps credentials, data and the active connection', async () => {
  const { client } = setup(),
    box = client.box(connection.characterId)
  box.draft('keep offline')
  server({ offline: true })
  await expect(client.prepareLogout(connection.characterId)).rejects.toHaveProperty(
    'code',
    'transport_unknown',
  )
  expect(client.connection(connection.characterId).logout).toBeUndefined()
  expect(client.credentials.get(`device/${connection.characterId}/${connection.personId}`)).toBe(
    'original-test-token',
  )
  expect(box.draft()).toBe('keep offline')
  await expect(client.activity(connection.characterId, () => box.draft())).resolves.toBe(
    'keep offline',
  )
})
it('delete removes only the selected owner and an unlink failure retains the explicit choice for retry', async () => {
  const resource = setup(),
    { client, path } = resource,
    box = client.box(connection.characterId)
  box.draft('delete me')
  const originalFile = box.db.name,
    otherFile = join(
      path,
      'connections',
      connection.characterId,
      'outbox',
      '00000000-0000-4000-8000-000000000006',
      connection.bindingId + '.sqlite3',
    ),
    other = new Outbox(otherFile, {
      ...box.owner,
      personId: '00000000-0000-4000-8000-000000000006',
    })
  other.draft('preserve other owner')
  resources.at(-1)!.other = other
  const external = join(path, 'explicit-user-save.md')
  writeFileSync(external, 'preserve this external save')
  server()
  await client.prepareLogout(connection.characterId)
  faults.unlink = true
  await expect(
    client.finishLogout(connection.characterId, connection.deviceId!, 'delete'),
  ).rejects.toHaveProperty('code', 'EACCES')
  expect(client.logoutSummary(connection.characterId).connection.logout?.choice).toBe('delete')
  expect(box.db.open).toBe(false)
  await expect(
    client.finishLogout(connection.characterId, connection.deviceId!, 'keep'),
  ).rejects.toHaveProperty('code', 'precondition_failed')
  await client.finishLogout(connection.characterId, connection.deviceId!, 'delete')
  expect(existsSync(originalFile)).toBe(false)
  expect(other.draft()).toBe('preserve other owner')
  expect(readFileSync(external, 'utf8')).toBe('preserve this external save')
})
it('a public pairing identity response arriving after logout cannot silently reconnect', async () => {
  const { client } = setup()
  let release!: () => void,
    first = true,
    post = 0,
    revoked = false
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.stubGlobal('fetch', async (input: string) => {
    if (input.endsWith('/meta')) {
      if (first) {
        first = false
        await wait
      }
      return data(meta)
    }
    if (input.endsWith('/me'))
      return revoked
        ? Response.json({ problem: { code: 'unauthenticated' } }, { status: 401 })
        : data(me)
    if (input.includes('/requests/')) return data({ found: false })
    if (input.endsWith('/pair')) {
      post++
      throw Error('must not create credentials')
    }
    revoked = true
    return data({ device_id: connection.deviceId, revoked: true, replay: false })
  })
  const pairing = client.pair(connection.baseUrl, 'a'.repeat(32), 'late device'),
    reject = expect(pairing).rejects.toHaveProperty('code', 'logout_pending')
  await client.prepareLogout(connection.characterId)
  await client.finishLogout(connection.characterId, connection.deviceId!, 'keep')
  release()
  await reject
  expect(post).toBe(0)
  expect(client.list()).toEqual([])
})

it('logout waits for an already-started re-pair and revokes the credential that actually becomes current', async () => {
  const { client } = setup(),
    next = '00000000-0000-4000-8000-000000000006'
  let release!: () => void,
    paired!: () => void,
    first = true,
    revoked = false
  const gate = new Promise<void>((resolve) => {
      release = resolve
    }),
    entered = new Promise<void>((resolve) => {
      paired = resolve
    }),
    targets: string[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    if (input.endsWith('/meta')) return data(meta)
    if (input.endsWith('/pair')) {
      paired()
      return data({ device_id: next, token: 'new-test-token' })
    }
    if (input.endsWith('/me')) {
      if (first) {
        first = false
        await gate
      }
      return revoked
        ? Response.json({ problem: { code: 'unauthenticated' } }, { status: 401 })
        : data(me)
    }
    if (input.includes('/requests/')) return data({ found: false })
    targets.push(input)
    expect(init.headers).toHaveProperty('Authorization', 'Bearer new-test-token')
    revoked = true
    return data({ device_id: next, revoked: true, replay: false })
  })
  const pairing = client.pair(connection.baseUrl, 'a'.repeat(32), 'repaired device')
  await entered
  const logout = client.prepareLogout(connection.characterId)
  release()
  await pairing
  const summary = await logout
  expect(summary.connection.deviceId).toBe(next)
  expect(targets).toEqual([`http://localhost/role/client/v1/devices/${next}`])
  await client.finishLogout(connection.characterId, next, 'keep')
})
