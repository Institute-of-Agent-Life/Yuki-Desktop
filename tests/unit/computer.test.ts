import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { ComputerCommands, computerKey } from '../../src/main/outbox/computer-commands'
import { ComputerTickets } from '../../src/main/computer-tickets'
import { ApiClient, ApiError } from '../../src/main/api/client'
import { heldComputers } from '../../src/main/computer-exit'
import type { Connections } from '../../src/main/connections'
import type { OutboxOwner, ComputerCommandItem, Me } from '../../src/shared/api'

const owner: OutboxOwner = {
  characterId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  bindingId: '00000000-0000-4000-8000-000000000003',
  conversationId: '00000000-0000-4000-8000-000000000004',
}
const me: Me = {
  is_superuser: true,
  person_id: owner.personId,
  source_person_id: owner.personId,
  request_person_id: owner.personId,
  request_scope: owner.personId,
  request_conversation_id: null,
  platform: 'app',
  presence_id: '00000000-0000-4000-8000-000000000099',
  thread_id: null,
  binding_id: owner.bindingId,
  conversation_id: owner.conversationId,
  display_name: '測試本人',
  devices: [],
  bindings: [
    {
      binding_id: owner.bindingId,
      source_person_id: owner.personId,
      platform: 'app',
      display_name: '',
      status: 'active',
    },
  ],
}
const roots: { root: string; box: Outbox }[] = []
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'yd-computer-')),
    path = join(root, 'box.sqlite3'),
    box = new Outbox(path, owner)
  roots.push({ root, box })
  return { path, box, commands: new ComputerCommands(box) }
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const { root, box } of roots.splice(0)) {
    if (box.db.open) box.db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
const data = (value: unknown) => Response.json({ data: value })
const api = (fetcher: typeof fetch) =>
  new ApiClient(
    'http://localhost/role/yuki',
    'private-token',
    owner.bindingId,
    '1.0.0-beta.1',
    fetcher,
  )
const original = (item: ComputerCommandItem, extra: Record<string, unknown> = {}) =>
  data({
    found: true,
    operation_kind: 'control',
    target: computerKey(owner.personId, item.requestId),
    payload_hash: item.payloadHash,
    status: 'unknown',
    ...extra,
  })

it('matches the Manager UUID5 namespace vector', () => {
  expect(computerKey(owner.personId, '00000000-0000-4000-8000-000000000005')).toBe(
    '3849f9c4-faa7-5111-b6c5-7a9321130f45',
  )
})

it('recovers A/B uncertainty after cold restart with exact UUID and captured old lease', async () => {
  const { path, box, commands } = setup(),
    lease = '00000000-0000-4000-8000-000000000005'
  const item = commands.prepare({ action: 'return', leaseId: lease, note: '原說明 🙂' })
  const posted: unknown[] = []
  const first = api(async (url, init) => {
    if (String(url).endsWith('/me')) return data(me)
    if (String(url).includes('/requests/')) return data({ found: false })
    posted.push(JSON.parse(init!.body as string))
    throw new Error('HTTP response lost')
  })
  expect(await commands.run(first, item.requestId)).toMatchObject({
    state: 'submitted',
    problem: 'transport_unknown',
  })
  expect(commands.prepare({ action: 'return', leaseId: lease, note: '原說明 🙂' }).requestId).toBe(
    item.requestId,
  )
  box.db.close()
  const restoredBox = new Outbox(path, owner),
    restored = new ComputerCommands(restoredBox)
  try {
    const recovered = api(async (url, init) => {
      if (String(url).endsWith('/me')) return data(me)
      if (String(url).includes('/requests/')) return original(item)
      posted.push(JSON.parse(init!.body as string))
      return data({
        control: { holder: 'none' },
        by: { device_id: 'actual-device' },
        note: '原說明 🙂',
      })
    })
    const result = await restored.run(recovered, item.requestId, true)
    expect(result).toMatchObject({
      state: 'result',
      problem: null,
      result: { control: { holder: 'none' } },
    })
    expect(posted).toEqual(
      Array(2).fill({
        request_id: item.requestId,
        action: 'return',
        lease_id: lease,
        note: '原說明 🙂',
      }),
    )
    expect(restored.list()).toHaveLength(1)
  } finally {
    restoredBox.db.close()
  }
})

it('does not resend a terminal receipt, namespace mismatch, or inaccessible original', async () => {
  const { commands } = setup()
  for (const mode of ['terminal', 'mismatch', 'missing']) {
    const item = commands.prepare({ action: 'take' }),
      posts = vi.fn()
    const client = api(async (url, init) => {
      if (String(url).endsWith('/me')) return data(me)
      if (init?.method === 'POST') {
        posts()
        throw new Error('must not dispatch')
      }
      if (mode === 'terminal')
        return original(item, { status: 'succeeded', result: { control: { holder: 'none' } } })
      if (mode === 'mismatch') return original(item, { target: 'another-owner-key' })
      return Response.json({ problem: { code: 'not_found' } }, { status: 404 })
    })
    const settled = await commands.run(client, item.requestId, true)
    expect(settled.state).toBe('result')
    await commands.run(client, item.requestId, true)
    expect(posts).not.toHaveBeenCalled()
    expect(settled.problem).toBe(
      mode === 'terminal' ? null : mode === 'mismatch' ? 'request_conflict' : 'not_found',
    )
  }
})

it('coalesces parallel retries and never substitutes a new lease after a precondition conflict', async () => {
  const { commands } = setup(),
    item = commands.prepare({ action: 'return', leaseId: '00000000-0000-4000-8000-000000000005' })
  let posts = 0
  const client = api(async (url, init) => {
    if (String(url).endsWith('/me')) return data(me)
    if (init?.method === 'POST') {
      posts++
      return Response.json(
        { problem: { code: 'precondition_failed', control: { lease_id: 'new-lease' } } },
        { status: 409 },
      )
    }
    return data({ found: false })
  })
  const results = await Promise.all([
    commands.run(client, item.requestId, true),
    commands.run(client, item.requestId, true),
  ])
  expect(posts).toBe(1)
  expect(results[0]).toEqual(results[1])
  expect(results[0]?.problem).toBe('precondition_failed')
  await commands.run(client, item.requestId, true)
  expect(posts).toBe(1)
})

it('passes only a single exact prefixed WebSocket URL without bearer credentials', async () => {
  const tickets = new ComputerTickets(),
    client = api(async () =>
      data({
        ticket: 'one-use-ticket',
        expires_at: '2099-01-01T00:00:00Z',
        ws_path: '/role/yuki/client/v1/computer/display',
      }),
    )
  const url = await tickets.issue(client)
  expect(url).toBe('ws://localhost/role/yuki/client/v1/computer/display?ticket=one-use-ticket')
  expect(url).not.toContain('private-token')
  expect(tickets.consume(url + '&other=1')).toBe(false)
  expect(tickets.consume(url)).toBe(true)
  expect(tickets.consume(url)).toBe(false)
  const second = await tickets.issue(client),
    now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 60001)
  expect(tickets.consume(second)).toBe(false)
})

it('rejects an unexpected ticket path before exposing a WebSocket destination', async () => {
  const tickets = new ComputerTickets()
  await expect(
    tickets.issue(
      api(async () =>
        data({ ticket: 'ticket', ws_path: '//other-host/client/v1/computer/display' }),
      ),
    ),
  ).rejects.toThrow('invalid_response')
})

it('asks about last observed control when offline but never treats revoked authority as current control', async () => {
  const { box, commands } = setup(),
    leaseId = '00000000-0000-4000-8000-000000000005',
    deviceId = '00000000-0000-4000-8000-000000000006'
  box.cache('computer', { control: { holder: 'human', device_id: deviceId, lease_id: leaseId } })
  let problem = 'transport_unknown'
  const connections = {
    list: () => [
      {
        ...owner,
        deviceId,
        name: '角色',
        baseUrl: 'http://localhost',
        persistentCredentials: true,
      },
    ],
    read: async () => {
      throw new ApiError(problem)
    },
    box: () => box,
    computerCommands: () => commands,
  } as unknown as Connections
  expect(await heldComputers(connections)).toMatchObject([{ leaseId, offline: true }])
  problem = 'forbidden'
  expect(await heldComputers(connections)).toEqual([])
  problem = 'unauthenticated'
  expect(await heldComputers(connections)).toEqual([])
})
