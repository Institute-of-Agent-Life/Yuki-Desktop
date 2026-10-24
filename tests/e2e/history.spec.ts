import { activeCharacterName } from '../fixtures/active-character'
import { expect, test } from '@playwright/test'
import { ledgerEvents, pairUI, waitForMainEnded, yukiFixture } from '../fixtures/backend'

test('paginates real history without moving the visible message and jumps to the exact older reference', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('history')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
    })
    await composer.fill('原始歷史錨點')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const original = page
      .getByRole('article')
      .filter({ has: page.getByText('原始歷史錨點', { exact: true }) })
    await expect(original).toHaveAttribute('data-event-id', /^\d+$/)
    const originalId = Number(await original.getAttribute('data-event-id'))
    await original.getByRole('button', { name: '引用回覆' }).click()
    // Populate history through the product's normal API/outbox, never by setting UI state.
    const submission = await page.evaluate(async () => {
      const connections = await window.yuki.client.connections()
      if (!connections.ok || !connections.value[0]) throw new Error('Missing paired connection')
      const id = connections.value[0].characterId
      const results: Awaited<ReturnType<typeof window.yuki.client.send>>[] = []
      for (let offset = 0; offset < 61; offset += 8) {
        results.push(
          ...(await Promise.all(
            Array.from({ length: Math.min(8, 61 - offset) }, (_, localIndex) =>
              window.yuki.client.send(
                id,
                `歷史測試 ${String(offset + localIndex).padStart(2, '0')}\n${'真實帳本的一段較長文字。'.repeat(4)}`,
              ),
            ),
          )),
        )
      }
      for (const result of results) if (!result.ok) throw new Error(result.code)
      const submitted = results.map((result) => {
        if (!result.ok) throw Error(result.code)
        return result.value
      })
      const receipts = await Promise.all(
        submitted
          .filter((item) => item.eventId === null)
          .map((item) => window.yuki.client.verify(id, item.requestId)),
      )
      for (const receipt of receipts) if (!receipt.ok) throw Error(receipt.code)
      return { id, requests: submitted.map((item) => item.requestId) }
    })
    const readSeeded = () =>
      page.evaluate(async ({ id, requests }) => {
        const journal = await window.yuki.client.outbox(id)
        if (!journal.ok) throw Error(journal.code)
        return journal.value
          .filter((item) => requests.includes(item.requestId))
          .map((item) => ({
            requestId: item.requestId,
            eventId: item.eventId,
            text: item.body.text,
          }))
      }, submission)
    await expect
      .poll(async () => {
        const items = await readSeeded()
        return { count: items.length, accepted: items.every((item) => item.eventId !== null) }
      })
      .toEqual({ count: 61, accepted: true })
    const seeded = await readSeeded()
    await composer.fill('引用很早以前的原事件')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('引用很早以前的原事件', { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('')
    const latest = page
      .getByRole('article')
      .filter({ has: page.getByText('引用很早以前的原事件', { exact: true }) })
    await expect(latest).toHaveAttribute('data-event-id', /^\d+$/)
    const latestId = Number(await latest.getAttribute('data-event-id'))
    const finalRequest = await page.evaluate(
      async ({ id, eventId }) => {
        const journal = await window.yuki.client.outbox(id)
        if (!journal.ok) throw Error(journal.code)
        return journal.value.find((item) => item.eventId === eventId)!.requestId
      },
      { id: submission.id, eventId: latestId },
    )
    const ended = await waitForMainEnded(page, submission.id, finalRequest)
    expect(ended.event_id).toBe(latestId)
    expect(Array.isArray(ended.result_event_ids)).toBe(true)
    for (const eventId of ended.result_event_ids!)
      await expect(page.locator(`article[data-event-id="${eventId}"]`)).toBeVisible()
    expect(new Set(seeded.map((item) => item.requestId)).size).toBe(61)
    expect(new Set(seeded.map((item) => item.eventId)).size).toBe(61)
    const ledger = await ledgerEvents(rig.base)
    for (const item of seeded) {
      expect(item.eventId).toBeGreaterThan(originalId)
      expect(item.eventId).toBeLessThan(latestId)
      expect(
        ledger.filter((event) => event.event_id === item.eventId).map((event) => event.content),
      ).toEqual([item.text])
    }
    // Reload clears renderer history; only the latest API page is initially requested.
    await page.reload()
    const log = page.getByRole('log', { name: '對話訊息' })
    await expect(page.getByText('引用很早以前的原事件', { exact: true })).toBeVisible()
    await expect(page.getByText('原始歷史錨點', { exact: true })).toHaveCount(0)
    await log.getByRole('button').filter({ hasText: '引用：原始歷史錨點' }).click()
    await expect(page.getByText('原始歷史錨點', { exact: true })).toBeVisible()
    await expect(original).toHaveClass(/selected/)
    await page.getByRole('button', { name: '回到最新訊息', exact: true }).click()
    await expect(page.getByText('引用很早以前的原事件', { exact: true })).toBeInViewport({
      ratio: 1,
    })
    // Each real wheel reaches the top of the current page. Wait for its prepend
    // before the next wheel, so coalesced input cannot skip the pagination check.
    await log.hover()
    while (!(await page.getByText('原始歷史錨點', { exact: true }).count())) {
      const first = () =>
        log.locator('article[data-event-id]').first().getAttribute('data-event-id').then(Number)
      const before = await first()
      await page.mouse.wheel(0, -20000)
      await expect.poll(first).toBeLessThan(before)
      await expect(log.locator(`article[data-event-id="${before}"]`)).toBeInViewport()
    }
    await expect(page.getByText('原始歷史錨點', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '↓ 新訊息', exact: true })).toHaveCount(0)
    // A read-only sync does not pretend that another message arrived.
    await fetch(`${rig.base}/__test/disconnect`, { method: 'POST' })
    await expect(
      page
        .locator('[data-character-session]:not([hidden]) [data-region="toolbar"]')
        .getByText('已連線', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: '↓ 新訊息', exact: true })).toHaveCount(0)
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('conversation-history.png'),
    })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
