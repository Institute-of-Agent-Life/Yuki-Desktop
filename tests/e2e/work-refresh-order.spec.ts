import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { Home, Work, OriginalRequest } from '../../src/shared/api'
import {
  currentConnection,
  pairUI,
  recordBusinessState,
  waitForWorkState,
  yukiFixture,
} from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { navigate } from '../fixtures/navigation'

test('a real terminal Work hint survives an older running detail response in the full workspace', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/work-refresh'),
    a = await rig.launch('work-refresh-a'),
    b = await rig.launch('work-refresh-b')
  const creationText = '保留原工作讀取順序的工作'
  let success = false
  let identity:
    { characterId: string; requestId: string; eventId: number; workId: string } | undefined
  let running: Work | undefined
  let completed: Work | undefined
  let heldCount = 0
  type ProbeWindow = Window & {
    __workRefreshProbe?: {
      terminal: Promise<void>
      hints: { kind: string; data: unknown }[]
      dispose(): void
    }
  }
  type ReadProbe = {
    reads: { status?: number; body?: { data?: Work }; error?: string }[]
    pending: Promise<unknown>[]
    ready: Promise<void>
    heldCount: number
    release(): void
    restore(): void
  }
  try {
    const pa = await a.firstWindow(),
      pb = await b.firstWindow()
    await pairUI(pa, rig.base, await rig.code())
    await pairUI(pb, proxy.base, await rig.code())
    const connection = await currentConnection(pa)
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await pa
      .getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true })
      .fill(creationText)
    await pa.getByRole('button', { name: '送出', exact: true }).click()
    await navigate(pa, '工作')
    await pa.getByRole('button', { name: /等你回覆.*原工作整合測試/ }).click()
    identity = await pa.evaluate(
      async ({ characterId, text }) => {
        const outbox = await window.yuki.client.outbox(characterId)
        if (!outbox.ok) throw Error(outbox.code)
        const item = outbox.value.find((item) => item.body.text === text)
        if (!item) throw Error('Original Work creation request missing')
        const request = await window.yuki.client.read<OriginalRequest>(characterId, {
          kind: 'request',
          requestId: item.requestId,
        })
        if (!request.ok) throw Error(request.code)
        const home = await window.yuki.client.read<Home>(characterId, { kind: 'home' })
        if (!home.ok) throw Error(home.code)
        const work = home.value.works.find(
          (work) => work.trigger_event_id === request.value.event_id,
        )
        if (!work || !request.value.event_id) throw Error('Original Work source missing')
        return {
          characterId,
          requestId: item.requestId,
          eventId: request.value.event_id,
          workId: work.work_id,
        }
      },
      { characterId: connection.characterId, text: creationText },
    )
    await navigate(pb, '工作')
    await pb.getByRole('button', { name: /等你回覆.*原工作整合測試/ }).click()
    const detailA = pa.getByRole('complementary', { name: '檢視器' }),
      detailB = pb.getByRole('complementary', { name: '檢視器' })
    await expect(detailB.getByText('等你回覆', { exact: true })).toBeVisible()
    const streamPath = proxy.calls.find((call) => call.path.startsWith('/client/v1/stream'))!.path
    const workPath = `/client/v1/works/${identity.workId}`
    proxy.pauseActive(streamPath)
    await pb.evaluate(({ characterId, workId }) => {
      let finish!: () => void
      const terminal = new Promise<void>((resolve) => {
        finish = resolve
      })
      const hints: { kind: string; data: unknown }[] = []
      const dispose = window.yuki.client.onHint((id, kind, data) => {
        if (id !== characterId) return
        hints.push({ kind, data })
        if (kind === 'sync') {
          const snapshot = data as { works: { work_id: string }[] }
          if (!snapshot.works.some((work) => work.work_id === workId)) finish()
        }
      })
      Object.assign(window, { __workRefreshProbe: { terminal, hints, dispose } })
    }, identity)
    await fetch(`${rig.base}/__test/hold-work`, { method: 'POST' })
    await detailA.getByRole('textbox').fill('台北，沿原工作繼續')
    await detailA.getByRole('button', { name: '傳送給這項工作', exact: true }).click()
    running = await waitForWorkState(pa, identity.characterId, identity.workId, 'running')
    await b.evaluate((_electron, path) => {
      const original = globalThis.fetch
      const reads: ReadProbe['reads'] = []
      const pending: Promise<unknown>[] = []
      let ready!: () => void
      let release!: () => void
      const captured = new Promise<void>((resolve) => {
        ready = resolve
      })
      const delivery = new Promise<void>((resolve) => {
        release = resolve
      })
      const probe: ReadProbe = {
        reads,
        pending,
        ready: captured,
        heldCount: 0,
        release,
        restore: () => {
          globalThis.fetch = original
        },
      }
      globalThis.fetch = async (...args) => {
        const input = args[0]
        const url = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        )
        if (!url.pathname.endsWith(path)) return original(...args)
        const entry: ReadProbe['reads'][number] = {}
        reads.push(entry)
        const first = reads.length === 1
        const received = original(...args)
        const observed = received.then(async (response) => {
          const bytes = first ? await response.arrayBuffer() : undefined
          const body = first
            ? JSON.parse(new TextDecoder().decode(bytes))
            : await response.clone().json()
          Object.assign(entry, { status: response.status, body })
          return { response, bytes }
        })
        pending.push(
          observed.then(
            () => undefined,
            (error) => {
              entry.error = String(error)
              if (first) ready()
            },
          ),
        )
        if (!first) return received
        const { response, bytes } = await observed
        // Hold only application delivery after the real HTTP body has finished.
        probe.heldCount++
        ready()
        await delivery
        return new Response(bytes, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        })
      }
      Object.assign(globalThis, { __workReadProbe: probe })
    }, workPath)
    proxy.resumeActive(streamPath)
    const captured = await b.evaluate(async () => {
      const probe = (globalThis as typeof globalThis & { __workReadProbe: ReadProbe })
        .__workReadProbe
      await probe.ready
      return { read: probe.reads[0], heldCount: probe.heldCount }
    })
    heldCount = captured.heldCount
    expect(captured.read).toMatchObject({
      status: 200,
      body: { data: { work_id: identity.workId, state: 'running' } },
    })
    expect(
      (
        await pa.evaluate(async ({ characterId, workId }) => {
          const value = await window.yuki.client.read<Work>(characterId, { kind: 'work', workId })
          if (!value.ok) throw Error(value.code)
          return value.value
        }, identity)
      ).state,
    ).toBe('running')
    await fetch(`${rig.base}/__test/release-work`, { method: 'POST' })
    await pb.evaluate(() => (window as ProbeWindow).__workRefreshProbe!.terminal)
    completed = await waitForWorkState(pa, identity.characterId, identity.workId, 'completed')
    proxy.pauseActive(streamPath)
    await b.evaluate(() => {
      const probe = (globalThis as typeof globalThis & { __workReadProbe: ReadProbe })
        .__workReadProbe
      probe.release()
    })
    await expect(detailB.getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    const reads = await b.evaluate(async () => {
      const probe = (globalThis as typeof globalThis & { __workReadProbe: ReadProbe })
        .__workReadProbe
      await Promise.allSettled(probe.pending)
      return probe.reads
    })
    expect(reads[0]?.body?.data?.state).toBe('running')
    expect(reads.some((read) => read.body?.data?.state === 'completed')).toBe(true)
    expect(completed.work_id).toBe(running.work_id)
    expect(completed.generation).toBe(running.generation)
    expect(completed.budget.root_id).toBe(running.budget.root_id)
    success = true
  } finally {
    await fetch(`${rig.base}/__test/release-work`, { method: 'POST' })
    const reads = await b
      .evaluate(async () => {
        const probe = (globalThis as typeof globalThis & { __workReadProbe?: ReadProbe })
          .__workReadProbe
        if (!probe) return undefined
        probe.release()
        await Promise.allSettled(probe.pending)
        probe.restore()
        return probe.reads
      })
      .catch(() => undefined)
    for (const [device, app] of [
      ['a', a],
      ['b', b],
    ] as const) {
      const page = await app.firstWindow()
      await recordBusinessState(page, `work-refresh-state-${device}.json`).catch(console.error)
    }
    const pb = await b.firstWindow()
    const hints = await pb
      .evaluate(() => {
        const probe = (window as ProbeWindow).__workRefreshProbe
        probe?.dispose()
        return probe?.hints
      })
      .catch(() => undefined)
    await writeFile(
      test.info().outputPath('work-refresh-order.json'),
      JSON.stringify(
        { identity, running, completed, heldCount, reads, hints, calls: proxy.calls },
        null,
        2,
      ),
    )
    await a.close()
    await b.close()
    await proxy.close()
    await rig.close(success)
  }
})
