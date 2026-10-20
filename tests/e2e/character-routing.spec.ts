import { expect, test, type Page } from '@playwright/test'
import { pairUI, yukiFixture } from '../fixtures/backend'

async function send(page: Page, text: string) {
  await page.keyboard.press('ControlOrMeta+N')
  const input = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
  await expect(input).toBeFocused()
  await input.fill(text)
  await input.press('Enter')
  await expect(page.getByText(text, { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(
    page.getByText('真實帳本回覆', { exact: true }).filter({ visible: true }),
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
      const events = (await (await fetch(base + '/__test/events')).json()) as { text: string }[]
      expect(events.filter((event) => event.text === mine)).toHaveLength(1)
      expect(events.some((event) => event.text === other)).toBe(false)
      expect(events.some((event) => event.text === '真實帳本回覆')).toBe(true)
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
    await app.close()
    await first.close(success)
    await second.close(success)
  }
})
