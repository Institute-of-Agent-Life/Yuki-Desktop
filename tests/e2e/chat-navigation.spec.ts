import { expect, test } from '@playwright/test'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { navigate, sidebar } from '../fixtures/navigation'

test('the main chat entry, shortcut and palette return from another actual ingress without losing the desktop draft', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('main-chat-navigation')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page)
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    const draft = '保留桌面原本人入口的草稿'
    await composer.fill(draft)
    const response = await fetch(`${rig.base}/__test/qq-entry`, { method: 'POST' })
    expect(response.status).toBe(200)
    const source = (await response.json()) as { conversation_id: string; event_id: number }
    expect(source.conversation_id).not.toBe(original.conversationId)
    await expect
      .poll(async () =>
        page.evaluate(async (id) => {
          const result = await window.yuki.client.read<{ entries: { conversation_id: string }[] }>(
            id,
            { kind: 'home' },
          )
          return result.ok ? result.value.entries.map((item) => item.conversation_id) : []
        }, original.characterId),
      )
      .toContain(source.conversation_id)

    for (const route of ['sidebar', 'shortcut', 'palette', 'settings'] as const) {
      await navigate(page, /^QQ ·/)
      await expect(page.locator(`article[data-event-id="${source.event_id}"]`)).toBeVisible()
      await expect(composer).toHaveCount(0)
      if (route === 'sidebar') await navigate(page, '對話')
      else if (route === 'shortcut') await page.keyboard.press('ControlOrMeta+1')
      else if (route === 'palette') {
        await page.keyboard.press('ControlOrMeta+k')
        const palette = page.getByRole('dialog', { name: '指令面板', exact: true })
        await palette.getByRole('combobox').fill('開啟對話')
        await palette.getByRole('option', { name: /開啟對話/ }).click()
        await expect(palette).toBeHidden()
      } else {
        await page.keyboard.press('ControlOrMeta+,')
        await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeVisible()
        await page.keyboard.press('ControlOrMeta+1')
        await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeHidden()
      }
      await expect(composer).toBeVisible()
      await expect(composer).toHaveValue(draft)
      await expect(
        (await sidebar(page)).getByRole('button', { name: '對話', exact: true }),
      ).toHaveAttribute('aria-current', 'page')
      expect(await currentConnection(page)).toEqual(original)
    }
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await navigate(page, /^QQ ·/)
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeHidden()
    await expect(page.locator(`article[data-event-id="${source.event_id}"]`)).toBeVisible()
    await expect(composer).toHaveCount(0)
    await navigate(page, '對話')
    await expect(composer).toHaveValue(draft)
    expect(await currentConnection(page)).toEqual(original)

    for (const sourceIsQQ of [true, false]) {
      if (sourceIsQQ) await navigate(page, /^QQ ·/)
      await navigate(page, '關於 初始角色')
      await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
      const editor = page.getByRole('textbox', { name: 'SOUL.md 內容', exact: true })
      const unsaved = `保留${sourceIsQQ ? 'QQ' : '桌面'}來源的未儲存提示詞`
      await expect(editor).toHaveAttribute('aria-readonly', 'false')
      await editor.click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.insertText(unsaved)
      await navigate(page, sourceIsQQ ? '對話' : /^QQ ·/)
      const guard = page.getByRole('dialog', { name: '要儲存變更嗎？', exact: true })
      await expect(guard).toBeVisible()
      await guard.getByRole('button', { name: '取消', exact: true }).click()
      await expect(editor).toHaveText(unsaved)

      // Expanding the existing stage reveals the retained conversation without choosing another one.
      await page.keyboard.press('ControlOrMeta+Shift+e')
      await expect(guard).toBeVisible()
      await guard.getByRole('button', { name: '不儲存', exact: true }).click()
      if (sourceIsQQ) {
        await expect(page.locator(`article[data-event-id="${source.event_id}"]`)).toBeVisible()
        await expect(composer).toHaveCount(0)
      } else await expect(composer).toHaveValue(draft)
      await page.keyboard.press('ControlOrMeta+1')
      await expect(composer).toHaveValue(draft)
      expect(await currentConnection(page)).toEqual(original)
    }
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
