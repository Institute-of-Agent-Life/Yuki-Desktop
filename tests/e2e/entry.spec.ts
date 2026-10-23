import { expect, test } from '@playwright/test'
import { currentEvents, pairUI, yukiFixture } from '../fixtures/backend'

test('reads another actual personal ingress and quotes its exact original event in the desktop conversation', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('other-entry')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const response = await fetch(`${rig.base}/__test/qq-entry`, { method: 'POST' })
    expect(response.status).toBe(200)
    const original = (await response.json()) as { event_id: number; conversation_id: string }
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const list = await window.yuki.client.connections()
          if (!list.ok || !list.value[0]) return []
          return window.yuki.client.read(list.value[0].characterId, { kind: 'home' })
        }),
      )
      .toMatchObject({
        ok: true,
        value: { entries: [{ conversation_id: original.conversation_id, platform: 'qq' }] },
      })
    await page.getByRole('button', { name: /^QQ ·/ }).click()
    await expect(page.getByText('QQ 原入口的真實帳本內容', { exact: true })).toBeVisible()
    const navigation = page.getByRole('navigation', { name: '主要導覽' })
    await expect(navigation.locator('[aria-current=page]')).toHaveCount(1)
    await page.keyboard.press('ControlOrMeta+,')
    await expect(navigation.locator('[aria-current=page]')).toHaveCount(1)
    await expect(navigation.getByRole('button', { name: '設定', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(navigation.locator('[aria-current=page]')).toHaveCount(1)
    await expect(page.locator('textarea')).toHaveCount(0)
    await page.getByRole('button', { name: '在桌面對話中提到這段', exact: true }).click()
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await expect(composer).toBeVisible()
    await expect(page.getByText('引用：QQ 原入口的真實帳本內容', { exact: true })).toBeVisible()
    await page.getByRole('button').filter({ hasText: '引用：QQ 原入口的真實帳本內容' }).click()
    await expect(page.locator('article[aria-label="你的訊息"]')).toHaveClass(/selected/)
    await expect(page.locator('textarea')).toHaveCount(0)
    await page.getByRole('button', { name: '回到桌面對話', exact: true }).click()
    await composer.fill('請接續這個原入口的事情')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(async () => {
        const facts = (await currentEvents(page)).items
        return facts.some(
          (item) =>
            item.text ===
            `[[yuki-ref conversation=${original.conversation_id} event=${original.event_id}]]\n請接續這個原入口的事情`,
        )
      })
      .toBe(true)
    await fetch(`${rig.base}/__test/events/${original.event_id}?lose_hint=true`, {
      method: 'DELETE',
    })
    await expect(page.getByText('引用的訊息無法讀取', { exact: true })).toBeVisible()
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
