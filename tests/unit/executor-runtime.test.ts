import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { ExecutorInstallation } from '../../src/main/executor/installation'
import { LocalExecutorRuntime } from '../../src/main/executor/runtime'

const resources: { root: string; box: Outbox; runtime: LocalExecutorRuntime }[] = []
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.runtime.stopped()
    await resource.runtime.settled()
    resource.box.db.close()
    rmSync(resource.root, { recursive: true, force: true })
  }
  vi.unstubAllGlobals()
})
function setup(verify: () => Promise<void> = async () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'yuki-executor-runtime-')),
    box = new Outbox(join(root, 'outbox.db'), {
      characterId: 'role',
      personId: 'person',
      bindingId: 'entry',
      conversationId: 'conversation',
    }),
    secrets = new Map<string, string>(),
    vault = new ExecutorInstallation(
      {
        get: (key) => secrets.get(key),
        set: (key, value) => {
          secrets.set(key, value)
          return true
        },
        remove: (key) => {
          secrets.delete(key)
        },
        canPersist: () => true,
      },
      box.owner,
    )
  vault.install('executor', 'executor-secret')
  vault.consent([{ capability: 'notify' }])
  let finish!: (value: boolean) => void
  const inFlight = new Promise<boolean>((resolve) => {
      finish = resolve
    }),
    native = vi.fn((title: string) => (title === 'first' ? inFlight : Promise.resolve(true))),
    activity = vi.fn(),
    runtime = new LocalExecutorRuntime(
      box,
      vault,
      {
        openURL: async () => {},
        openFile: async () => '',
        notify: native,
      },
      verify,
      () => {},
      activity,
    )
  resources.push({ root, box, runtime })
  return { box, vault, runtime, native, activity, finish }
}
it('cancelling identity verification sends no executor credential or stream request', async () => {
  let verified!: () => void
  const gate = new Promise<void>((resolve) => {
      verified = resolve
    }),
    h = setup(() => gate),
    fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const starting = h.runtime.start('https://original.invalid', '1.0.0')
  h.runtime.disconnect()
  verified()
  await starting
  expect(fetcher).not.toHaveBeenCalled()
  expect(h.runtime.state().state).toBe('offline')
})
it('reconnect and pause retain the live native promise; terminal sync also clears a finished journal', async () => {
  const h = setup(),
    operations = new Map([
      [
        'first',
        {
          op_id: 'first',
          capability: 'notify',
          params: { title: 'first', body: 'body' },
          state: 'dispatched',
        },
      ],
    ]),
    requests: { path: string; headers: Headers; body: unknown }[] = [],
    streams: ((event: string, data: unknown) => void)[] = []
  let loseResult = true
  const envelope = (data: unknown) => Response.json({ data })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input),
        path = url.pathname,
        headers = new Headers(init?.headers),
        body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ path, headers, body })
      expect(path).toMatch(/^\/executor\/v1\//)
      expect(headers.get('Authorization')).toBe('Bearer executor-secret')
      expect(headers.has('X-Yuki-Entry')).toBe(false)
      if (path.endsWith('/config'))
        return envelope({
          executor_id: 'executor',
          grants: [{ capability: 'notify' }],
          grants_digest: 'digest',
          paused: false,
        })
      if (path.endsWith('/heartbeat')) return envelope({ grants_digest: 'digest', paused: false })
      if (path.endsWith('/stream'))
        return new Response(
          new ReadableStream({
            start(controller) {
              const emit = (event: string, data: unknown) =>
                controller.enqueue(
                  new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                )
              streams.push(emit)
              init?.signal?.addEventListener('abort', () => controller.close(), { once: true })
              emit('sync', {
                pending: [...operations.values()]
                  .filter((op) => op.state !== 'succeeded')
                  .map((op) => op.op_id),
              })
            },
          }),
        )
      const match = path.match(/\/operations\/([^/]+)(?:\/(ack|result))?$/)!
      const operation = operations.get(match[1]!)!
      if (match[2] === 'ack') operation.state = 'acknowledged'
      if (match[2] === 'result') {
        operation.state = body.state
        if (operation.op_id === 'first' && loseResult) {
          loseResult = false
          return Response.json({ problem: { code: 'unknown' } }, { status: 503 })
        }
      }
      return envelope({ ...operation })
    }),
  )
  await h.runtime.start('https://old.invalid', '1.0.0')
  await vi.waitFor(() => expect(h.native).toHaveBeenCalledTimes(1))
  h.runtime.disconnect()
  await h.runtime.start('https://new.invalid', '1.0.0')
  await vi.waitFor(() => expect(streams).toHaveLength(2))
  expect(h.native).toHaveBeenCalledTimes(1)
  expect(h.runtime.state().activeOperations).toEqual(['first'])
  h.vault.pause(true)
  operations.set('second', {
    op_id: 'second',
    capability: 'notify',
    params: { title: 'second', body: 'body' },
    state: 'dispatched',
  })
  streams[1]!('operation', { op_id: 'second' })
  await vi.waitFor(() =>
    expect(requests.some((request) => request.path.endsWith('/operations/second'))).toBe(true),
  )
  expect(requests.some((request) => request.path.endsWith('/second/ack'))).toBe(false)
  expect(h.native).toHaveBeenCalledTimes(1)
  h.finish(true)
  await h.runtime.settled()
  expect(operations.get('first')!.state).toBe('succeeded')
  expect(operations.get('second')!.state).toBe('dispatched')
  expect(h.box.db.prepare('SELECT phase FROM local_executor_operations').all()).toEqual([
    { phase: 'finished' },
  ])
  h.vault.pause(false)
  await h.runtime.refresh()
  await h.runtime.settled()
  expect(h.native).toHaveBeenCalledTimes(2)
  expect(operations.get('second')!.state).toBe('succeeded')
  h.runtime.disconnect()
  await h.runtime.start('https://new.invalid', '1.0.0')
  await vi.waitFor(() => expect(streams).toHaveLength(3))
  await h.runtime.settled()
  expect(h.box.db.prepare('SELECT * FROM local_executor_operations').all()).toEqual([])
  expect(
    requests.filter((request) => request.path.endsWith('/result')).map((request) => request.body),
  ).toEqual([
    { state: 'succeeded', level: 'submitted', result: { submitted: true } },
    { state: 'succeeded', level: 'submitted', result: { submitted: true } },
  ])
  expect(h.activity.mock.calls.map((call) => [call[0].opId, call[1]])).toEqual([
    ['first', true],
    ['first', false],
    ['second', true],
    ['second', false],
  ])
}, 10000)
