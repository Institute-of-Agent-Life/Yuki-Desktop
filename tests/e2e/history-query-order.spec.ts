import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'

for (const order of ['earlier-first', 'latest-first', 'same-batch'] as const)
  test(`history keeps the original event position with ${order} real reads`, async () => {
    test.setTimeout(120000)
    const rig = await yukiFixture(),
      proxy = await forwardProxy(rig.base, '/history-query-order'),
      app = await rig.launch(`history-query-${order}`)
    let success = false
    let connection: Awaited<ReturnType<typeof currentConnection>> | undefined
    let seedIds: number[] = []
    const originalCalls: (typeof proxy.calls)[number][] = []
    let eventId = 0,
      originalTop = 0,
      finalTop = 0
    try {
      const page = await app.firstWindow()
      await pairUI(page, proxy.base, await rig.code())
      const seeded = await fetch(`${rig.base}/__test/history?count=61`, { method: 'POST' })
      expect(seeded.status).toBe(200)
      seedIds = ((await seeded.json()) as { event_ids: number[] }).event_ids
      expect(new Set(seedIds).size).toBe(61)
      await page.reload()
      const log = page.getByRole('log', { name: '對話訊息' })
      await expect(log.locator('article[data-event-id]')).toHaveCount(50)
      connection = await currentConnection(page)
      eventId = Number(
        await log.locator('article[data-event-id]').first().getAttribute('data-event-id'),
      )
      const earlierSuffix = `&before=${eventId}`,
        latestSuffix = `&before=${Number.MAX_SAFE_INTEGER}`
      proxy.faults.holdResponseSuffixes.add(earlierSuffix)
      await log.hover()
      await page.mouse.wheel(0, -20000)
      await expect
        .poll(() => [...proxy.held.keys()].some((path) => path.endsWith(earlierSuffix)))
        .toBe(true)
      const earlierPath = [...proxy.held.keys()].find((path) => path.endsWith(earlierSuffix))!
      originalCalls.push(proxy.calls.filter((call) => call.path === earlierPath).at(-1)!)
      // Only the original read is held. A subsequent current-range read is real and unblocked.
      proxy.faults.holdResponseSuffixes.delete(earlierSuffix)
      const original = log.locator(`article[data-event-id="${eventId}"]`)
      await expect.poll(() => log.evaluate((element) => element.scrollTop)).toBe(0)
      await expect(original).toBeInViewport()
      originalTop = await original.evaluate((element) => element.getBoundingClientRect().top)

      if (order === 'latest-first') {
        const appended = await fetch(`${rig.base}/__test/history?count=1`, { method: 'POST' })
        expect(appended.status).toBe(200)
        const extra = ((await appended.json()) as { event_ids: number[] }).event_ids
        seedIds.push(...extra)
        await page.evaluate(() => window.yuki.client.reconnect())
        await expect(log.locator(`article[data-event-id="${extra[0]}"]`)).toHaveCount(1)
        originalCalls.push(proxy.calls.filter((call) => call.path.endsWith(latestSuffix)).at(-1)!)
        proxy.pauseActive('/client/v1/stream')
        proxy.releaseResponses(earlierPath)
      } else {
        proxy.faults.holdResponseSuffixes.add(latestSuffix)
        await page.evaluate(() => window.yuki.client.reconnect())
        await expect
          .poll(() => [...proxy.held.keys()].some((path) => path.endsWith(latestSuffix)))
          .toBe(true)
        const latestPath = [...proxy.held.keys()].find((path) => path.endsWith(latestSuffix))!
        originalCalls.push(proxy.calls.filter((call) => call.path === latestPath).at(-1)!)
        proxy.faults.holdResponseSuffixes.delete(latestSuffix)
        proxy.pauseActive('/client/v1/stream')
        proxy.releaseResponses(earlierPath)
        if (order === 'earlier-first') {
          await expect(log.locator('article[data-event-id]').first()).toHaveAttribute(
            'data-event-id',
            '1',
          )
          await expect(original).toBeInViewport()
        }
        proxy.releaseResponses(latestPath)
      }
      expect(originalCalls).toHaveLength(2)
      await expect.poll(() => originalCalls.every((call) => proxy.completed.has(call))).toBe(true)
      await page.screenshot({ path: test.info().outputPath('history-read-order.png') })
      await expect(log.locator('article[data-event-id]').first()).toHaveAttribute(
        'data-event-id',
        '1',
      )
      await expect(log.locator('article[data-event-id]')).toHaveCount(seedIds.length + 3)
      const renderedIds = await log
        .locator('article[data-event-id]')
        .evaluateAll((items) => items.map((item) => Number(item.getAttribute('data-event-id'))))
      expect(new Set(renderedIds).size).toBe(renderedIds.length)
      expect(renderedIds).toEqual(expect.arrayContaining(seedIds))
      await expect(original).toBeInViewport()
      finalTop = await original.evaluate((element) => element.getBoundingClientRect().top)
      expect(Math.abs(finalTop - originalTop)).toBeLessThanOrEqual(1)
      expect(await currentConnection(page)).toEqual(connection)
      expect(
        proxy.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/messages')),
      ).toHaveLength(0)
      success = true
    } finally {
      const page = await app.firstWindow()
      const evidence = await page.evaluate(() => ({
        renderedEventIds: [...document.querySelectorAll('article[data-event-id]')].map((item) =>
          Number(item.getAttribute('data-event-id')),
        ),
        scrollTop: document.querySelector('[role="log"]')?.scrollTop,
      }))
      await writeFile(
        test.info().outputPath('history-read-order-facts.json'),
        JSON.stringify(
          {
            order,
            connection,
            seedIds,
            eventId,
            originalTop,
            finalTop,
            ...evidence,
            calls: proxy.calls,
            originalReads: originalCalls.map((call) => ({
              ...call,
              responseSent: proxy.completed.has(call),
            })),
          },
          null,
          2,
        ),
      )
      if (!success)
        await page.screenshot({ path: test.info().outputPath('history-read-order-failure.png') })
      proxy.faults.holdResponseSuffixes.clear()
      for (const path of proxy.held.keys()) proxy.releaseResponses(path)
      proxy.resumeActive('/client/v1/stream')
      await app.close()
      await proxy.close()
      await rig.close(success)
    }
  })
