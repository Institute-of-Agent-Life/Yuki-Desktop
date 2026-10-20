import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'

async function add(page: Page) {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '伺服器與角色', exact: true }).click()
  await page.getByRole('button', { name: '加入另一個角色', exact: true }).click()
  await expect(page.getByLabel('伺服器位址')).toBeVisible()
}
async function switchRole(page: Page, name: string) {
  await page.getByRole('button', { name: '切換角色', exact: true }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(name) }).click()
}

test('two real roles retain their own drafts, layout, editor and avatar dialogs through actual switches', async () => {
  test.setTimeout(180000)
  const first = await yukiFixture({ character: true, prompts: true })
  const second = await yukiFixture({ character: true, prompts: true })
  let app = await first.launch('multiple-roles')
  let success = false
  const errors: string[] = []
  try {
    let page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await pairUI(page, first.base, await first.code())
    await expect(page.getByRole('button', { name: '切換角色', exact: true })).toHaveCount(0)
    await page
      .getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
      .fill('只有第一角色的草稿')
    const separator = page.getByRole('separator', { name: '調整側邊欄' })
    await separator.focus()
    await page.keyboard.press('ArrowRight')
    await expect(separator).toHaveAttribute('aria-valuenow', '264')
    await add(page)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '加入另一個角色', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })).toHaveValue(
      '',
    )
    await expect(separator).toHaveAttribute('aria-valuenow', '260')
    await page.getByRole('button', { name: '關於 Yuki', exact: true }).click()
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
    await switchRole(page, 'Yuki')
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })).toHaveValue(
      '只有第一角色的草稿',
    )
    await expect(separator).toHaveAttribute('aria-valuenow', '264')
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--accent').toLowerCase(),
        ),
      )
      .toBe('#3a6bd6')
    await page.keyboard.press('ControlOrMeta+Shift+]')
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await page.getByRole('button', { name: '關於 Mika', exact: true }).click()
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'system_prompt.md 內容', exact: true })
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.insertText('\n只屬於 Mika 的提示詞')
    await page.keyboard.press('ControlOrMeta+Shift+[')
    await expect(page.getByRole('dialog', { name: '要儲存變更嗎？' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(editor).toContainText('只屬於 Mika 的提示詞')
    await page.keyboard.press('ControlOrMeta+Shift+[')
    await page.getByRole('dialog').getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '編輯頭像', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '更換 Yuki 的頭像' })).toBeVisible()
    await app.evaluate(
      ({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      },
      join(process.cwd(), 'tests/fixtures/avatar-white.png'),
    )
    await page.getByRole('button', { name: '選擇圖片…', exact: true }).click()
    await expect(page.getByRole('button', { name: '選擇其他圖片…', exact: true })).toBeVisible()
    await page.getByRole('slider', { name: '頭像縮放', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    const zoom = await page.getByRole('slider', { name: '頭像縮放', exact: true }).inputValue()
    await page.keyboard.press('ControlOrMeta+Shift+]')
    await expect(page.getByRole('dialog', { name: '更換 Yuki 的頭像' })).toHaveCount(0)
    await expect(editor).toBeVisible()
    await expect(editor).toContainText('只屬於 Mika 的提示詞')
    await page
      .locator('[data-region="toolbar"]')
      .getByRole('button', { name: '關於 Mika', exact: true })
      .click()
    await page.getByRole('button', { name: '編輯頭像', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '更換 Mika 的頭像' })).toBeVisible()
    await expect(page.getByRole('button', { name: '選擇圖片…', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+[')
    await expect(page.getByRole('dialog', { name: '更換 Yuki 的頭像' })).toBeVisible()
    await expect(page.getByRole('button', { name: '選擇其他圖片…', exact: true })).toBeVisible()
    await expect(page.getByRole('slider', { name: '頭像縮放', exact: true })).toHaveValue(zoom)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '編輯頭像', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    await expect(editor).not.toContainText('只屬於 Mika 的提示詞')
    await page.getByRole('button', { name: '對話', exact: true }).click()
    await switchRole(page, 'Mika')
    await expect(page.getByRole('dialog', { name: '更換 Mika 的頭像' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+1')
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await page.getByRole('button', { name: '切換角色', exact: true }).click()
    await page.keyboard.press('Home')
    await expect(page.getByRole('menuitemradio', { name: /Yuki/ })).toBeFocused()
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
    await switchRole(page, 'Yuki')
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })).toHaveValue(
      '只有第一角色的草稿',
    )
    await expect(page.getByRole('separator', { name: '調整側邊欄' })).toHaveAttribute(
      'aria-valuenow',
      '264',
    )
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('tab', { name: mode === 'dark' ? '深色' : '淺色', exact: true }).click()
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
        await app.evaluate(
          ({ BrowserWindow }, size) =>
            BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height),
          { width, height },
        )
        for (const name of ['Yuki', 'Mika']) {
          await expect
            .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
            .toEqual([width, height])
          await expect(
            page.locator('[data-character-session]:not([hidden]) [data-region="sidebar"]'),
          ).toHaveCSS('position', width < 1100 ? 'absolute' : 'static')
          await expect(
            page.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true }),
          ).toBeVisible()
          if (!(await page.getByRole('button', { name: '切換角色', exact: true }).isVisible()))
            await page.getByRole('button', { name: '側邊欄', exact: true }).click()
          await page.getByRole('button', { name: '切換角色', exact: true }).click()
          await expect(page.getByRole('menu', { name: '角色', exact: true })).toBeVisible()
          const menu = page.getByRole('menu', { name: '角色', exact: true })
          await expect(menu.getByRole('img', { name: 'Yuki', exact: true })).toHaveCSS(
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
          await page.keyboard.press('ControlOrMeta+Shift+]')
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
