import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { contentSize } from '../fixtures/visual'
import { pairUI, yukiFixture } from '../fixtures/backend'

async function add(page: Page) {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '伺服器與角色', exact: true }).click()
  await page.getByRole('button', { name: '加入另一個角色', exact: true }).click()
  await expect(
    page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true }).filter({ visible: true }),
  ).toBeVisible()
}
async function switchRole(page: Page, name: string) {
  await page.getByRole('button', { name: '切換角色', exact: true }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(name) }).click()
}

test('two real roles retain their own drafts, layout and single SOUL editor through actual switches', async () => {
  test.setTimeout(180000)
  const first = await yukiFixture()
  const second = await yukiFixture()
  let app = await first.launch('multiple-roles')
  let success = false
  const errors: string[] = []
  try {
    let page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await pairUI(page, first.base, await first.code())
    await expect(page.getByRole('button', { name: '切換角色', exact: true })).toHaveCount(0)
    await page
      .getByRole('textbox', { name: '和 初始角色 說點什麼', exact: true })
      .fill('只有第一角色的草稿')
    const separator = page.getByRole('separator', { name: '調整側邊欄' })
    await separator.focus()
    await page.keyboard.press('ArrowRight')
    await expect(separator).toHaveAttribute('aria-valuenow', '264')
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await page
      .getByRole('tablist', { name: '檢視器內容' })
      .getByRole('tab', { name: '檔案', exact: true })
      .click()
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await add(page)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '加入另一個角色', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    await expect(
      page.getByRole('textbox', { name: '和 初始角色 說點什麼', exact: true }),
    ).toHaveValue('')
    await expect(separator).toHaveAttribute('aria-valuenow', '260')
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(
      page
        .getByRole('tablist', { name: '檢視器內容' })
        .getByRole('tab', { name: '工作', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await page.getByRole('button', { name: '關於 初始角色', exact: true }).click()
    await page.getByRole('button', { name: '編輯角色資料', exact: true }).click()
    await page.getByLabel('名稱', { exact: true }).fill('Mika')
    await page.getByLabel('淺色外觀', { exact: true }).fill('#b0466b')
    await page.getByLabel('深色外觀', { exact: true }).fill('#e5a2bc')
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByRole('button', { name: '關於 Mika', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '對話', exact: true }).click()
    await page
      .getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })
      .fill('只有 Mika 的草稿')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')))
      .toBe('#b0466b')
    await switchRole(page, '初始角色')
    await expect(
      page.getByRole('textbox', { name: '和 初始角色 說點什麼', exact: true }),
    ).toHaveValue('只有第一角色的草稿')
    await expect(separator).toHaveAttribute('aria-valuenow', '264')
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(
      page
        .getByRole('tablist', { name: '檢視器內容' })
        .getByRole('tab', { name: '檔案', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--accent').toLowerCase(),
        ),
      )
      .toBe('#3a6bd6')
    await page.keyboard.press('ControlOrMeta+Shift+BracketRight')
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await page.getByRole('button', { name: '關於 Mika', exact: true }).click()
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'SOUL.md 內容', exact: true })
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.insertText('\n只屬於 Mika 的提示詞')
    await page.keyboard.press('ControlOrMeta+Shift+BracketLeft')
    await expect(page.getByRole('dialog', { name: '要儲存變更嗎？' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(editor).toContainText('只屬於 Mika 的提示詞')
    await page.keyboard.press('ControlOrMeta+Shift+BracketLeft')
    await page.getByRole('dialog').getByRole('button', { name: '儲存', exact: true }).click()
    await expect(
      page.getByRole('textbox', { name: '和 初始角色 說點什麼', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '關於 初始角色', exact: true }).click()
    await expect(page.getByRole('button', { name: '編輯頭像', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    await expect(editor).not.toContainText('只屬於 Mika 的提示詞')
    await page.getByRole('button', { name: '對話', exact: true }).click()
    await switchRole(page, 'Mika')
    await page.keyboard.press('ControlOrMeta+1')
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await page.getByRole('button', { name: '切換角色', exact: true }).click()
    await page.keyboard.press('Home')
    await expect(page.getByRole('menuitemradio', { name: /初始角色/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '切換角色', exact: true })).toBeFocused()
    await page.screenshot({ path: join(test.info().outputDir, 'mika-role-switch.png') })
    await app.close()
    app = await first.launch('multiple-roles')
    page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await switchRole(page, '初始角色')
    await expect(
      page.getByRole('textbox', { name: '和 初始角色 說點什麼', exact: true }),
    ).toHaveValue('只有第一角色的草稿')
    await expect(page.getByRole('separator', { name: '調整側邊欄' })).toHaveAttribute(
      'aria-valuenow',
      '264',
    )
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(
      page
        .getByRole('tablist', { name: '檢視器內容' })
        .getByRole('tab', { name: '檔案', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radio', { name: mode === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      for (const [name, checked] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = page.getByRole('switch', { name, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click()
      }
      await page.getByRole('button', { name: '返回', exact: true }).click()
      for (const [width, height] of [
        [1600, 900],
        [1280, 800],
        [960, 640],
      ] as const) {
        await contentSize(app, page, width, height)
        for (const name of ['初始角色', 'Mika']) {
          await expect
            .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
            .toEqual([width, height])
          await expect(
            page.locator('[data-character-session]:not([hidden]) [data-region="sidebar"]'),
          ).toHaveCSS('position', width < 1100 ? 'absolute' : 'relative')
          await expect(
            page.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true }),
          ).toBeVisible()
          if (!(await page.getByRole('button', { name: '切換角色', exact: true }).isVisible()))
            await page.getByRole('button', { name: '側邊欄', exact: true }).click()
          await page.getByRole('button', { name: '切換角色', exact: true }).click()
          await expect(page.getByRole('menu', { name: '角色', exact: true })).toBeVisible()
          const menu = page.getByRole('menu', { name: '角色', exact: true })
          await expect(menu.getByRole('img', { name: '初始角色', exact: true })).toHaveCSS(
            'background-color',
            mode === 'dark' ? 'rgb(127, 164, 255)' : 'rgb(58, 107, 214)',
          )
          await expect(menu.getByRole('img', { name: 'Mika', exact: true })).toHaveCSS(
            'background-color',
            mode === 'dark' ? 'rgb(229, 162, 188)' : 'rgb(176, 70, 107)',
          )
          await page.screenshot({
            path: test.info().outputPath(`S12-${mode}-${width}-${name}.png`),
          })
          await page.keyboard.press('Escape')
          await page.keyboard.press('ControlOrMeta+Shift+BracketRight')
        }
      }
    }
    expect(errors).toEqual([])
    success = true
  } finally {
    await app.close()
    await first.close(success)
    await second.close(success)
  }
})
