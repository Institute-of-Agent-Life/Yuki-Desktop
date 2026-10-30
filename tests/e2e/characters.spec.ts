import { navigate, sidebar } from '../fixtures/navigation'
import { activeCharacterName } from '../fixtures/active-character'
import { captureViewport, contentSize } from '../fixtures/visual'
import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'

async function add(page: Page) {
  await (await sidebar(page)).getByRole('button', { name: '切換 Yuki', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Yuki', exact: true })
  await menu.getByRole('menuitem', { name: '連接另一個 Yuki', exact: true }).click()
  await expect(page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })).toBeVisible()
}
async function switchRole(page: Page, name: string) {
  await sidebar(page)
  await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
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
    const firstName = await activeCharacterName(page)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await page.getByRole('radio', { name: '淺色', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await contentSize(app, page, 1440, 900)
    const singleYuki = page.getByRole('button', { name: '切換 Yuki', exact: true })
    await expect(singleYuki).toBeVisible()
    await expect(singleYuki).toHaveAccessibleDescription(new RegExp(firstName))
    expect(
      await singleYuki.evaluate((button) => {
        const description = document.getElementById(button.getAttribute('aria-describedby')!)!
        return {
          name: description.querySelector('strong')!.textContent,
          status: description.querySelector('small')!.textContent,
        }
      }),
    ).toEqual({ name: firstName, status: expect.stringMatching(/\S/) })
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼`, exact: true })
      .fill('只有第一角色的草稿')
    const separator = page.getByRole('separator', { name: '調整側邊欄' })
    await separator.focus()
    await page.keyboard.press('ArrowRight')
    await expect(separator).toHaveAttribute('aria-valuenow', '264')
    await page.getByRole('button', { name: '詳情', exact: true }).click()
    await page
      .getByRole('tablist', { name: '詳情內容' })
      .getByRole('tab', { name: '檔案', exact: true })
      .click()
    await page.getByRole('button', { name: '關閉詳情', exact: true }).click()
    await add(page)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await add(page)
    await pairUI(page, second.base, await second.code())
    await expect(
      page.getByRole('textbox', {
        name: `和 ${await activeCharacterName(page)} 說點什麼`,
        exact: true,
      }),
    ).toHaveValue('')
    await expect(separator).toHaveAttribute('aria-valuenow', '260')
    await page.getByRole('button', { name: '詳情', exact: true }).click()
    await expect(
      page
        .getByRole('tablist', { name: '詳情內容' })
        .getByRole('tab', { name: '工作', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '關閉詳情', exact: true }).click()
    await navigate(page, `關於 ${await activeCharacterName(page)}`)
    await page.getByRole('button', { name: '編輯名稱與簡介', exact: true }).click()
    await page.getByLabel('名稱', { exact: true }).fill('Mika')
    await page.getByLabel('淺色外觀', { exact: true }).fill('#b0466b')
    await page.getByLabel('深色外觀', { exact: true }).fill('#e5a2bc')
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByRole('button', { name: '關於 Mika', exact: true })).toBeVisible()
    await navigate(page, '桌面對話')
    await page
      .getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })
      .fill('只有 Mika 的草稿')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')))
      .toBe('#b0466b')
    await switchRole(page, firstName)
    await expect(
      page.getByRole('textbox', {
        name: `和 ${firstName} 說點什麼`,
        exact: true,
      }),
    ).toHaveValue('只有第一角色的草稿')
    await expect(separator).toHaveAttribute('aria-valuenow', '264')
    await page.getByRole('button', { name: '詳情', exact: true }).click()
    await expect(
      page
        .getByRole('tablist', { name: '詳情內容' })
        .getByRole('tab', { name: '檔案', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '關閉詳情', exact: true }).click()
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
    await navigate(page, '關於 Mika')
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
      page.getByRole('textbox', {
        name: `和 ${firstName} 說點什麼`,
        exact: true,
      }),
    ).toBeVisible()
    await navigate(page, `關於 ${await activeCharacterName(page)}`)
    await page.locator('header').getByRole('button', { name: '更換頭像', exact: true }).click()
    await expect(page.getByRole('dialog', { name: `更換 ${firstName} 的頭像` })).toBeVisible()
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
    const zoom = await page
      .getByRole('slider', { name: '頭像縮放', exact: true })
      .getAttribute('aria-valuenow')
    await page.keyboard.press('ControlOrMeta+Shift+BracketRight')
    await expect(page.getByRole('dialog', { name: `更換 ${firstName} 的頭像` })).toHaveCount(0)
    await expect(editor).toBeVisible()
    await expect(editor).toContainText('只屬於 Mika 的提示詞')
    await page
      .locator('[data-region="toolbar"]')
      .getByRole('button', { name: '關於 Mika', exact: true })
      .click()
    await page.locator('header').getByRole('button', { name: '更換頭像', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '更換 Mika 的頭像' })).toBeVisible()
    await expect(page.getByRole('button', { name: '選擇圖片…', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+BracketLeft')
    await expect(page.getByRole('dialog', { name: `更換 ${firstName} 的頭像` })).toBeVisible()
    await expect(page.getByRole('button', { name: '選擇其他圖片…', exact: true })).toBeVisible()
    await expect(page.getByRole('slider', { name: '頭像縮放', exact: true })).toHaveAttribute(
      'aria-valuenow',
      zoom!,
    )
    await page.keyboard.press('Escape')
    await expect(
      page.locator('header').getByRole('button', { name: '更換頭像', exact: true }),
    ).toBeFocused()
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    await expect(editor).not.toContainText('只屬於 Mika 的提示詞')
    await navigate(page, '桌面對話')
    await switchRole(page, 'Mika')
    await expect(page.getByRole('dialog', { name: '更換 Mika 的頭像' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+1')
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
    await expect(page.getByRole('menuitemradio', { checked: true })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(page.getByRole('menuitemradio', { name: new RegExp(firstName) })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '切換 Yuki', exact: true })).toBeFocused()
    await captureViewport(app, page, join(test.info().outputDir, 'mika-role-switch.png'))
    await app.close()
    app = await first.launch('multiple-roles')
    page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(true)
    await writeFile(
      test.info().outputPath('roles-cold-before-wide-stage.json'),
      JSON.stringify(
        {
          native: await app.evaluate(({ BrowserWindow, screen }) => {
            const window = BrowserWindow.getAllWindows()[0]!
            const display = screen.getDisplayMatching(window.getBounds())
            return {
              platform: process.platform,
              visible: window.isVisible(),
              outerBounds: window.getBounds(),
              contentBounds: window.getContentBounds(),
              contentSize: window.getContentSize(),
              scaleFactor: display.scaleFactor,
              workArea: display.workArea,
            }
          }),
          viewport: await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
            dpr: devicePixelRatio,
          })),
        },
        null,
        2,
      ),
    )
    // Measure the saved column width in the same wide stage; renderer emulation ends on quit.
    await contentSize(app, page, 1440, 900)
    await switchRole(page, firstName)
    await expect(
      page.getByRole('textbox', {
        name: `和 ${firstName} 說點什麼`,
        exact: true,
      }),
    ).toHaveValue('只有第一角色的草稿')
    await expect(page.getByRole('separator', { name: '調整側邊欄' })).toHaveAttribute(
      'aria-valuenow',
      '264',
    )
    await page.getByRole('button', { name: '詳情', exact: true }).click()
    await expect(
      page
        .getByRole('tablist', { name: '詳情內容' })
        .getByRole('tab', { name: '檔案', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '關閉詳情', exact: true }).click()
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
        const viewportMethod = await contentSize(app, page, width, height)
        for (const name of [firstName, 'Mika']) {
          if (viewportMethod === 'electron-device-emulation')
            await expect
              .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
              .toEqual([width, height])
          await expect(
            page.locator('[data-character-session]:not([hidden]) [data-region="sidebar"]'),
          ).toHaveCSS('position', width < 1100 ? 'absolute' : 'relative')
          await expect(
            page.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true }),
          ).toBeVisible()
          if (!(await page.getByRole('button', { name: '切換 Yuki', exact: true }).isVisible()))
            await page.getByRole('button', { name: '側邊欄', exact: true }).click()
          await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
          await expect(page.getByRole('menu', { name: 'Yuki', exact: true })).toBeVisible()
          const menu = page.getByRole('menu', { name: 'Yuki', exact: true })
          await expect(menu.getByRole('img', { name: firstName, exact: true })).toHaveCSS(
            'background-color',
            mode === 'dark' ? 'rgb(127, 164, 255)' : 'rgb(58, 107, 214)',
          )
          await expect(menu.getByRole('img', { name: 'Mika', exact: true })).toHaveCSS(
            'background-color',
            mode === 'dark' ? 'rgb(229, 162, 188)' : 'rgb(176, 70, 107)',
          )
          await captureViewport(
            app,
            page,
            test.info().outputPath(`S12-${mode}-${width}-${name}.png`),
          )
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
