import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { currentConnection, pairUI, waitForMainEnded, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import type { EventsPage } from '../../src/shared/api'

test('a committed first message replaces an older initial history response after its send invalidations', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/first-history'),
    app = await rig.launch('initial-history-inflight')
  const latestSuffix = `&before=${Number.MAX_SAFE_INTEGER}`
  const text = '初次歷史讀取在途時已確定送出的原訊息'
  proxy.faults.holdResponseSuffixes.add(latestSuffix)
  let success = false
  let original: Awaited<ReturnType<typeof currentConnection>> | undefined
  let requestId = ''
  let eventId = 0
  let hintsBefore = 0
  let heldReadsBeforeRelease = 0
  try {
    const page = await app.firstWindow()
    await page.evaluate(() => {
      const state = { outboxHints: 0 }
      Object.assign(window, { __firstHistoryProbe: state })
      window.yuki.client.onHint((_id, kind) => {
        if (kind === 'outbox') state.outboxHints += 1
      })
    })
    await pairUI(page, proxy.base, await rig.code())
    original = await currentConnection(page)
    await expect.poll(() => proxy.held.size).toBe(1)
    const initialPath = [...proxy.held.keys()][0]!
    hintsBefore = await page.evaluate(
      () =>
        (window as Window & { __firstHistoryProbe?: { outboxHints: number } }).__firstHistoryProbe!
          .outboxHints,
    )
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await composer.fill(text)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    const sent = await page.evaluate(
      async ({ id, text }) => {
        const result = await window.yuki.client.outbox(id)
        if (!result.ok) throw Error(result.code)
        const item = result.value.find((item) => item.body.text === text)
        if (!item?.eventId) throw Error('Original accepted request is missing')
        return { requestId: item.requestId, eventId: item.eventId }
      },
      { id: original.characterId, text },
    )
    requestId = sent.requestId
    eventId = sent.eventId
    const ended = await waitForMainEnded(page, original.characterId, requestId)
    expect(ended.event_id).toBe(eventId)
    const verified = await page.evaluate(
      async ({ id, requestId }) => window.yuki.client.verify(id, requestId),
      { id: original.characterId, requestId },
    )
    expect(verified).toMatchObject({ ok: true, value: { requestId, eventId, state: 'result' } })
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as Window & { __firstHistoryProbe?: { outboxHints: number } })
              .__firstHistoryProbe!.outboxHints,
        ),
      )
      .toBeGreaterThan(hintsBefore)
    expect(
      proxy.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/messages')),
    ).toHaveLength(1)
    heldReadsBeforeRelease = proxy.held.get(initialPath)?.length ?? 0
    proxy.pauseActive('/client/v1/stream')
    proxy.faults.holdResponseSuffixes.delete(latestSuffix)
    proxy.releaseResponses(initialPath)
    const message = page.locator(`article[data-event-id="${eventId}"]`)
    await expect(message).toHaveCount(1)
    await expect(message.getByText(text, { exact: true })).toBeVisible()
    expect(await currentConnection(page)).toEqual(original)
    expect(
      proxy.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/messages')),
    ).toMatchObject([{ requestId }])
    success = true
  } finally {
    const page = await app.firstWindow()
    const evidence = await page.evaluate(
      async ({ original, requestId, eventId, text }) => {
        const canonical =
          original && eventId
            ? await window.yuki.client.read<EventsPage>(original.characterId, {
                kind: 'events',
                conversationId: original.conversationId,
                after: eventId - 1,
                limit: 1,
              })
            : undefined
        const outbox = original ? await window.yuki.client.outbox(original.characterId) : undefined
        return {
          renderedEventIds: [...document.querySelectorAll('article[data-event-id]')].map(
            (element) => Number(element.getAttribute('data-event-id')),
          ),
          canonical: canonical?.ok
            ? canonical.value.items.map((event) => ({
                eventId: event.event_id,
                originalText: event.text === text,
              }))
            : canonical,
          originalRequest: outbox?.ok
            ? outbox.value
                .filter((item) => item.requestId === requestId)
                .map((item) => ({
                  requestId: item.requestId,
                  eventId: item.eventId,
                  state: item.state,
                }))
            : outbox,
          outboxHints: (window as Window & { __firstHistoryProbe?: { outboxHints: number } })
            .__firstHistoryProbe?.outboxHints,
        }
      },
      { original, requestId, eventId, text },
    )
    const evidencePath = test.info().outputPath('initial-history-invalidation-facts.json')
    await writeFile(
      evidencePath,
      JSON.stringify({
        ...evidence,
        hintsBefore,
        heldReadsBeforeRelease,
        latestReads: proxy.calls.filter((call) => call.path.endsWith(latestSuffix)).length,
      }),
    )
    await test.info().attach('initial-history-invalidation-facts.json', {
      path: evidencePath,
      contentType: 'application/json',
    })
    proxy.faults.holdResponseSuffixes.delete(latestSuffix)
    for (const path of proxy.held.keys()) proxy.releaseResponses(path)
    proxy.resumeActive('/client/v1/stream')
    await app.close()
    await proxy.close()
    await rig.close(success)
  }
})
