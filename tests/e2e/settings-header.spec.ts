import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'

/*
 * Settings header spacing (task book 2026-11-13 §3.5), failure case written before the code:
 * 30 On macOS, in any language, the Back button or the title touches or crosses the category
 *    column's divider; on Windows and Linux, the wider column leaves a header control under the
 *    window controls.
 * One layout serves every platform; the column is as wide as the longest language needs.
 * The macOS settings page in each language is the artifact.
 */

// Room between the end of the title and the divider.
const clearance = 12

test('the settings title clears the category divider in every language', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture()
  const app = await rig.launch('settings-header')
  let success = false
  const measured: Record<string, unknown> = {}
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const platform = await page.evaluate(async () => (await window.yuki.boot()).platform)
    for (const language of ['zh-Hant', 'zh-Hans', 'en'] as const) {
      await page.evaluate((language) => window.yuki.preferences({ language }), language)
      await expect(page.locator('html')).toHaveAttribute('lang', language)
      await page.keyboard.press('ControlOrMeta+,')
      const header = page
        .getByRole('region', { name: /^(設定|设置|Settings)$/ })
        .locator(':scope > header')
      await expect(header.locator('strong')).toBeVisible()
      const layout = await header.evaluate((header) => {
        const box = (element: Element | DOMRect) => {
          const { left, right, top, bottom } =
            element instanceof Element ? element.getBoundingClientRect() : element
          return { left, right, top, bottom }
        }
        const overlay = (
          navigator as Navigator & {
            windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect }
          }
        ).windowControlsOverlay
        const titlebar = overlay?.visible ? box(overlay.getTitlebarAreaRect()) : null
        const tabs = document.querySelector('[role="tablist"][aria-orientation="vertical"]')!
        return {
          back: box(header.querySelector('button')!),
          title: box(header.querySelector('strong')!),
          controls: [...header.querySelectorAll('button, strong')].map(box),
          divider: tabs.getBoundingClientRect().right,
          titlebar,
          width: innerWidth,
        }
      })
      measured[language] = layout
      await writeFile(
        test.info().outputPath('settings-header.json'),
        JSON.stringify({ platform, measured }, null, 2),
      )
      if (platform === 'darwin') {
        // The traffic lights are on the left; Back and the title follow them.
        expect(layout.back.right).toBeLessThan(layout.title.left)
        expect(layout.title.right + clearance).toBeLessThanOrEqual(layout.divider)
        await page.screenshot({ path: test.info().outputPath(`settings-header-${language}.png`) })
      } else {
        expect(layout.title.right + clearance).toBeLessThanOrEqual(layout.divider)
        // Window controls drawn over the page are on its right; nothing in the header reaches
        // under them. A native frame keeps them outside the page.
        const right = layout.titlebar?.right ?? layout.width
        for (const control of layout.controls) expect(control.right).toBeLessThanOrEqual(right)
        await page.screenshot({
          path: test.info().outputPath(`settings-header-${platform}-${language}.png`),
        })
      }
      await page.getByRole('button', { name: /^(返回|Back)$/ }).click()
    }
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
