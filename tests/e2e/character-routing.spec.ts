import { activeCharacterName } from '../fixtures/active-character'
import { expect, test, type Page } from '@playwright/test'
import { recordBusinessState, ledgerEvents, pairUI, yukiFixture } from '../fixtures/backend'
import type { OriginalRequest } from '../../src/shared/api'

async function send(page: Page, text: string) {
  await page.keyboard.press('ControlOrMeta+N')
  const input = page.getByRole('textbox', {
    name: `和 ${await activeCharacterName(page)} 說點什麼`,
    exact: true,
  })
  await expect(input).toBeFocused()
  await input.fill(text)
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await expect(page.getByText(text, { exact: true }).filter({ visible: true })).toBeVisible()
  const id = (await page
    .locator('[data-character-session]')
    .filter({ visible: true })
    .getAttribute('data-character-session'))!
  const sent = await page.evaluate(
    async ({ id, text }) => {
      const result = await window.yuki.client.outbox(id)
      if (!result.ok) throw Error(result.code)
      const item = result.value.find((item) => item.body.text === text)
      if (!item?.eventId) throw Error('Original accepted request is missing')
      return { requestId: item.requestId, eventId: item.eventId }
    },
    { id, text },
  )
  const receipt = () =>
    page.evaluate(
      async ({ id, requestId }) => {
        const result = await window.yuki.client.read<OriginalRequest>(id, {
          kind: 'request',
          requestId,
        })
        if (!result.ok) throw Error(result.code)
        return result.value
      },
      { id, requestId: sent.requestId },
    )
  await expect.poll(async () => (await receipt()).turn?.state).toBe('ended')
  const replied = await receipt()
  expect(replied.event_id).toBe(sent.eventId)
  expect(replied.result_event_ids).toHaveLength(1)
  await expect(
    page
      .locator(
        `[data-character-session="${id}"] article[data-event-id="${replied.result_event_ids![0]}"]`,
      )
      .getByText('Desktop reference reply', { exact: true }),
  ).toBeVisible()
}
test('two equally named real roles send to their own original Main and recover separate histories', async () => {
  test.setTimeout(90000)
  const first = await yukiFixture(),
    second = await yukiFixture()
  let app = await first.launch('role-message-routing'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, first.base, await first.code())
    await send(page, '第一個角色的原始訊息')
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '伺服器與角色', exact: true }).click()
    await page.getByRole('button', { name: '加入另一個角色', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    await expect(
      page.getByText('第一個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
    await send(page, '第二個角色的原始訊息')
    await page.keyboard.press('ControlOrMeta+Shift+[')
    await expect(
      page.getByText('第一個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    await expect(
      page.getByText('第二個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
    for (const [base, mine, other] of [
      [first.base, '第一個角色的原始訊息', '第二個角色的原始訊息'],
      [second.base, '第二個角色的原始訊息', '第一個角色的原始訊息'],
    ] as const) {
      const events = await ledgerEvents(base)
      expect(events.filter((event) => event.content === mine)).toHaveLength(1)
      expect(events.some((event) => event.content === other)).toBe(false)
      expect(events.some((event) => event.content === 'Desktop reference reply')).toBe(true)
    }
    await app.close()
    app = await first.launch('role-message-routing')
    page = await app.firstWindow()
    await expect(
      page.getByText('第一個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+]')
    await expect(
      page.getByText('第二個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    await expect(
      page.getByText('第一個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
    success = true
  } finally {
    if (!success)
      await recordBusinessState(await app.firstWindow(), 'business-state.json').catch(console.error)
    await app.close()
    await first.close(success)
    await second.close(success)
  }
})
