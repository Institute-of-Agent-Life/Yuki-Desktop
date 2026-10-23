import { expect, test, type Page } from '@playwright/test'
import { pairUI, yukiFixture } from '../fixtures/backend'
import type { EventsPage } from '../../src/shared/api'

async function send(page: Page, text: string) {
  await page.keyboard.press('ControlOrMeta+N')
  const input = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
  await expect(input).toBeFocused()
  await input.fill(text)
  await input.press('Enter')
  await expect(page.getByText(text, { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(
    page.getByText('Desktop reference reply', { exact: true }).filter({ visible: true }).last(),
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
    ]) {
      const events = await page.evaluate(async (base) => {
        const list = await window.yuki.client.connections()
        if (!list.ok) throw Error(list.code)
        const connection = list.value.find((item) => item.baseUrl === base)!
        const result = await window.yuki.client.read<EventsPage>(connection.characterId, {
          kind: 'events',
          conversationId: connection.conversationId,
        })
        if (!result.ok) throw Error(result.code)
        return result.value.items
      }, base)
      expect(events.filter((event) => event.text === mine)).toHaveLength(1)
      expect(events.some((event) => event.text === other)).toBe(false)
      expect(events.some((event) => event.text === 'Desktop reference reply')).toBe(true)
    }
    await app.close()
    app = await first.launch('role-message-routing')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible({
      timeout: 15000,
    })
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
    await app.close()
    await first.close(success)
    await second.close(success)
  }
})
