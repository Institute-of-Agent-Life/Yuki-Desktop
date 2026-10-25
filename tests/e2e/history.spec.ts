import { activeCharacterName } from '../fixtures/active-character'
import { expect, test } from '@playwright/test'
import { referencedMessage } from '../../src/shared/message'
import {
  currentConnection,
  ledgerEvents,
  pairUI,
  waitForAcceptedMessage,
  waitForMainEnded,
  yukiFixture,
} from '../fixtures/backend'

test('paginates real history without moving the visible message and jumps to the exact older reference', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('history')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
    })
    await composer.fill('原始歷史錨點')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const originalSubmission = await waitForAcceptedMessage(
      page,
      connection.characterId,
      '原始歷史錨點',
    )
    const original = page
      .getByRole('article')
      .filter({ has: page.getByText('原始歷史錨點', { exact: true }) })
    await expect(original).toHaveAttribute('data-event-id', /^\d+$/)
    const originalId = Number(await original.getAttribute('data-event-id'))
    expect(originalId).toBe(originalSubmission.eventId)
    await original.getByRole('button', { name: '引用回覆' }).click()
    // The existing fixture commits real ingress events without starting 61 unrelated Main turns.
    const response = await fetch(`${rig.base}/__test/history?count=61`, { method: 'POST' })
    expect(response.status).toBe(200)
    const seeded = (await response.json()) as { conversation_id: string; event_ids: number[] }
    expect(seeded.conversation_id).toBe(connection.conversationId)
    expect(seeded.event_ids).toHaveLength(61)
    expect(new Set(seeded.event_ids).size).toBe(61)
    await composer.fill('引用很早以前的原事件')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const finalSubmission = await waitForAcceptedMessage(
      page,
      connection.characterId,
      referencedMessage(
        [{ conversationId: connection.conversationId, eventId: originalId }],
        '引用很早以前的原事件',
      ),
    )
    await expect(page.getByText('引用很早以前的原事件', { exact: true })).toBeVisible()
    await expect(composer).toHaveValue('')
    const latest = page
      .getByRole('article')
      .filter({ has: page.getByText('引用很早以前的原事件', { exact: true }) })
    await expect(latest).toHaveAttribute('data-event-id', String(finalSubmission.eventId))
    const latestId = finalSubmission.eventId
    const ended = await waitForMainEnded(page, connection.characterId, finalSubmission.requestId)
    expect(ended.event_id).toBe(latestId)
    expect(Array.isArray(ended.result_event_ids)).toBe(true)
    for (const eventId of ended.result_event_ids!)
      await expect(page.locator(`article[data-event-id="${eventId}"]`)).toBeVisible()
    const ledger = await ledgerEvents(rig.base)
    for (const [index, eventId] of seeded.event_ids.entries()) {
      expect(eventId).toBeGreaterThan(originalId)
      expect(eventId).toBeLessThan(latestId)
      const events = ledger.filter((event) => event.event_id === eventId)
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        author_person_id: connection.personId,
        conversation_id: connection.conversationId,
        direction: 'inbound',
        content: `歷史訊息 ${index + 1}`,
      })
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
