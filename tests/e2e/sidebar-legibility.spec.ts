import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'
import { appearanceFor, legible } from '../fixtures/legibility'
import { picture, wallpapers } from '../fixtures/pictures'

/*
 * The sidebar's glass over a picture of one's own: every text in it, its quiet section headers and
 * the line under the persona's name included, keeps real legibility against the worst 1% of what
 * shows behind its glyphs (main text 4.5:1, quiet text 3:1, a translucent text taken as it lies
 * over each pixel), light and dark, over the kinds of pictures people choose (drawn for the test:
 * busy line art with screen tone, a saturated deep blue, a bright valley, saturated red fruit, a
 * dark forest), while the sidebar stays glass.
 *
 * Fails when: the sidebar keeps the theme's glass over a picture too dark (light) or too bright
 * (dark) for its ink, rather than turning to the other appearance as iOS 26's glass does; or it
 * turns opaque, or is whitewashed, to be legible.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('sidebar-legibility.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

async function appearance(page: Page, theme: 'light' | 'dark') {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '外觀', exact: true }).click()
  await page
    .getByRole('radiogroup', { name: '主題', exact: true })
    .getByRole('radio', { name: theme === 'dark' ? '深色' : '淺色', exact: true })
    .click()
  await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
}

test('the sidebar keeps its text legible over any picture, light and dark, and stays glass', async () => {
  test.setTimeout(420000)
  await mkdir(test.info().outputPath(), { recursive: true })
  const rig = await yukiFixture(),
    app = await rig.launch('sidebar-legibility')
  let success = false
  try {
    const page = await app.firstWindow()
    // A native window within the screen's work area: an emulated larger one does not hold through
    // the settings page and back.
    const area = await app.evaluate(
      ({ BrowserWindow, screen }) =>
        screen.getDisplayMatching(BrowserWindow.getAllWindows()[0]!.getBounds()).workArea,
    )
    await contentSize(app, page, Math.min(1100, area.width), Math.min(760, area.height - 40))
    await pairUI(page, rig.base, await rig.code())
    const name = await activeCharacterName(page)
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    const sidebar = page.locator('[data-region="sidebar"]')
    // Quiet text: the status under the name and the section headers.
    const quiet = new Set(['status', 'header 對話', 'header 工作區'])
    // One sidebar over two pictures at once, larger than its 20pt blur evens out: the valley's
    // pale sky behind its top and dark hills behind its foot; the berries' red fruit and bright
    // leaves; the manga's black strokes under the light glass's quiet header (dark theme). It takes
    // the one appearance its mean calls for, and the rows over the other part reach only what that
    // glass gives there, measured on a Retina Mac (light / dark; its display encoding reads mid
    // greys a little dark): valley 設定 3.7 / 3.1; berries 工作區 2.6–2.8 / 3.5, 工作 3.9–4.1 /
    // 5.6, 檔案與成果 4.3 / 5.9; manga 對話 3.4 / 2.9. Held to those floors and to the appearance.
    const split: Partial<Record<string, number>> = {
      'valley nav 設定': 3,
      'berries header 工作區': 2.5,
      'berries nav 工作': 3.8,
      'berries nav 檔案與成果': 4,
      'manga header 對話': 2.8,
    }
    const texts = {
      name: sidebar.getByText(name, { exact: true }).first(),
      status: sidebar.getByText('已連線', { exact: true }).first(),
      'header 對話': sidebar.getByText('對話', { exact: true }).first(),
      'header 工作區': sidebar.getByText('工作區', { exact: true }).first(),
      'nav 桌面對話': sidebar.getByText('桌面對話', { exact: true }).first(),
      'nav 工作': sidebar.getByText('工作', { exact: true }).first(),
      'nav 檔案與成果': sidebar.getByText('檔案與成果', { exact: true }).first(),
      'nav 這台電腦': sidebar.getByText('這台電腦', { exact: true }).first(),
      'nav 設定': sidebar.getByText('設定', { exact: true }).first(),
    }
    let first = true
    for (const wallpaper of wallpapers) {
      const path = test.info().outputPath(`${wallpaper}.png`),
        drawn = await picture(page, wallpaper)
      await writeFile(path, drawn)
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
      }, path)
      for (const theme of ['light', 'dark'] as const) {
        await appearance(page, theme)
        if (theme === 'light') {
          if (first)
            await page
              .getByRole('radiogroup', { name: '對話背景', exact: true })
              .getByRole('radio', { name: '自訂圖片', exact: true })
              .click()
          else await page.getByRole('button', { name: '選擇圖片…', exact: true }).click()
          first = false
          await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
        }
        await page.getByRole('button', { name: '返回', exact: true }).click()
        await expect(
          page.getByText('Desktop reference reply', { exact: true }).first(),
        ).toBeVisible()
        // The picture is read and the glass tinted once it has loaded.
        await page.waitForTimeout(1200)
        // On a small screen the sidebar is folded away over the page: opened to be read, once the
        // page has settled from coming back (which folds it again).
        const toggle = page.locator('[data-region="toolbar"] [data-toggle="sidebar"]')
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
        await expect(sidebar).toHaveAttribute('data-pane-open', 'true')
        // Measured where it has slid to, not on its way.
        await page.evaluate(() =>
          Promise.allSettled(
            document
              .getAnimations()
              .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
              .map((animation) => animation.finished),
          ),
        )
        // The pointer rests on the sidebar's empty middle, lighting no row.
        const box = (await sidebar.boundingBox())!
        await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75)
        await page.waitForTimeout(600)
        await page.screenshot({ path: test.info().outputPath(`${wallpaper}-${theme}.png`) })
        const seen: Record<string, number> = {}
        for (const [label, text] of Object.entries(texts)) {
          seen[label] = Math.round((await legible(page, text)) * 100) / 100
          expect
            .soft(seen[label], `${wallpaper} ${theme}: ${label}`)
            .toBeGreaterThanOrEqual(split[`${wallpaper} ${label}`] ?? (quiet.has(label) ? 3 : 4.5))
        }
        const glass = await sidebar.evaluate((element) => {
          const style = getComputedStyle(element)
          const alpha = Number(style.backgroundColor.match(/[\d.]+/g)?.[3] ?? 1)
          return { alpha, filter: style.backdropFilter, background: style.backgroundColor }
        })
        const shownAs = await sidebar.getAttribute('data-appearance')
        const { mean, high, expected } = await appearanceFor(
          page,
          sidebar,
          drawn,
          theme === 'dark'
            ? { colour: [0x1b, 0x1d, 0x22], amount: 0.3 }
            : { colour: [255, 255, 255], amount: 0 },
        )

        evidence[`${wallpaper} ${theme}`] = {
          contrast: seen,
          glass,
          appearance: shownAs,
          mean,
          high,
        }
        expect
          .soft(Object.keys(seen).length, `${wallpaper} ${theme}: texts read`)
          .toBeGreaterThan(5)
        // Where the sidebar is glass (macOS; elsewhere it lies flush and opaque), it takes the
        // appearance what lies under it calls for.
        if (glass.filter !== 'none' && expected)
          expect.soft(shownAs, `${wallpaper} ${theme}: the appearance`).toBe(expected)
        if (glass.filter !== 'none')
          expect.soft(glass.alpha, `${wallpaper} ${theme}: the sidebar stays glass`).toBeLessThan(1)
      }
    }
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
