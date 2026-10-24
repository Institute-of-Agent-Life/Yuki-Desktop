import { activeCharacterName } from '../fixtures/active-character'
import { expect, test } from '@playwright/test'
import { ledgerEvents, pairUI, yukiFixture } from '../fixtures/backend'

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
    const seeded = await page.evaluate(async () => {
      const connections = await window.yuki.client.connections()
      if (!connections.ok || !connections.value[0]) throw new Error('Missing paired connection')
      const id = connections.value[0].characterId
      const results = await Promise.all(
        Array.from({ length: 61 }, (_, index) =>
          window.yuki.client.send(
            id,
            `歷史測試 ${String(index).padStart(2, '0')}\n${'真實帳本的一段較長文字。'.repeat(4)}`,
          ),
        ),
      )
      for (const result of results) if (!result.ok) throw new Error(result.code)
      return results.map((result) => {
        if (!result.ok || !result.value.eventId) throw Error('Original accepted request is missing')
        return {
          requestId: result.value.requestId,
          eventId: result.value.eventId,
          text: result.value.body.text,
        }
      })
    })
    await composer.fill('引用很早以前的原事件')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('引用很早以前的原事件', { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('')
    const latest = page
      .getByRole('article')
      .filter({ has: page.getByText('引用很早以前的原事件', { exact: true }) })
    await expect(latest).toHaveAttribute('data-event-id', /^\d+$/)
    const latestId = Number(await latest.getAttribute('data-event-id'))
    expect(new Set(seeded.map((item) => item.requestId)).size).toBe(61)
    expect(new Set(seeded.map((item) => item.eventId)).size).toBe(61)
    const ledger = await ledgerEvents(rig.base)
    for (const item of seeded) {
      expect(item.eventId).toBeGreaterThan(originalId)
      expect(item.eventId).toBeLessThan(latestId)
      expect(ledger.filter((event) => event.event_id === item.eventId).map((event) => event.content))
        .toEqual([item.text])
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
    await expect(page.getByText('已連線', { exact: true })).toBeVisible()
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
