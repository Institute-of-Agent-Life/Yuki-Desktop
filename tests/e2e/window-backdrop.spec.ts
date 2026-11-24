import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { contentSize } from '../fixtures/visual'
import { legible, throughGlass } from '../fixtures/legibility'
import { picture } from '../fixtures/pictures'

/*
 * A picture of one's own is the window's backdrop, not the conversation's: drawn once behind the
 * whole app, every page (Work, Files and results, Settings) lies on it, and their glass shows it
 * through the Dock's glass, taking the appearance what lies under it calls for, with text as
 * legible as in the conversation (main text 4.5:1, quiet text 3:1).
 *
 * Fails when: a page other than the conversation shows its own opaque page colour (a plain grey
 * or white where the picture's colours should show through); or the picture is drawn more than
 * once (a layer per page); or a page's text is not legible over it.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('window-backdrop.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

/** Opens the sidebar where a small screen has folded it away over the page. */
async function sidebarShown(page: Page) {
  const toggle = page.locator('[data-region="toolbar"] [data-toggle="sidebar"]')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(page.locator('[data-region="sidebar"]')).toHaveAttribute('data-pane-open', 'true')
}

/** The mean colour and chroma of a box of the window. */
async function colourOf(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const shot = await page.screenshot({ clip: box })
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = new OffscreenCanvas(image.width, image.height),
      context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    const sum = [0, 0, 0]
    let chroma = 0
    for (let k = 0; k < pixels.length; k += 4) {
      const rgb = [pixels[k]!, pixels[k + 1]!, pixels[k + 2]!]
      rgb.forEach((value, c) => (sum[c] = sum[c]! + value))
      chroma += Math.max(...rgb) - Math.min(...rgb)
    }
    const count = pixels.length / 4
    return { mean: sum.map((value) => Math.round(value / count)), chroma: chroma / count }
  }, shot.toString('base64'))
}

test('a picture of ones own lies behind every page, seen through its glass, its text legible', async () => {
  test.setTimeout(300000)
  await mkdir(test.info().outputPath(), { recursive: true })
  const rig = await yukiFixture(),
    app = await rig.launch('window-backdrop')
  let success = false
  try {
    const page = await app.firstWindow()
    await contentSize(app, page, 1100, 760)
    await pairUI(page, rig.base, await rig.code())
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    // A strongly coloured picture: wherever it shows, the window is far from grey.
    const path = test.info().outputPath('gradient.png')
    await writeFile(path, await picture(page, 'gradient'))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
    }, path)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await page
      .getByRole('radiogroup', { name: '主題', exact: true })
      .getByRole('radio', { name: '淺色', exact: true })
      .click()
    await page
      .getByRole('radiogroup', { name: '對話背景', exact: true })
      .getByRole('radio', { name: '自訂圖片', exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
    await page.waitForTimeout(1500)

    // The picture is drawn once, at the window, whatever page is shown.
    const layers = () =>
      page.evaluate(
        () =>
          [document.documentElement, ...document.querySelectorAll('*')].filter((node) =>
            [
              getComputedStyle(node).backgroundImage,
              getComputedStyle(node, '::before').backgroundImage,
            ]
              .join(' ')
              .includes('__backgrounds/'),
          ).length,
      )

    const pages: [string, () => Promise<void>, Locator, Locator][] = [
      [
        'settings',
        async () => {
          await page.getByRole('tab', { name: '一般', exact: true }).click()
        },
        page.locator('#settings-panel h2'),
        page.locator('#settings-panel [data-settings-row] small').first(),
      ],
      [
        'works',
        async () => {
          await page.getByRole('button', { name: '返回', exact: true }).click()
          await sidebarShown(page)
          await page.locator('[data-region="sidebar"]').getByText('工作', { exact: true }).click()
        },
        page.locator('[data-region="content"]').locator('h1, h2, h3').first(),
        page.locator('[data-region="content"] p').first(),
      ],
      [
        'files',
        async () => {
          await sidebarShown(page)
          await page
            .locator('[data-region="sidebar"]')
            .getByText('檔案與成果', { exact: true })
            .click()
        },
        page.locator('[data-region="content"]').locator('h1, h2, h3').first(),
        page.locator('[data-region="content"] p').first(),
      ],
    ]
    for (const [name, open, heading, quiet] of pages) {
      await open()
      await page.waitForTimeout(1200)
      await page.mouse.move(5, 400)
      await page.screenshot({ path: test.info().outputPath(`${name}-light.png`) })
      // The page's lower right, clear of its text: the picture's teal and violet show through.
      const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      const seen = await colourOf(page, {
        x: size.width - 160,
        y: size.height - 120,
        width: 120,
        height: 80,
      })
      const drawn = await layers()
      const main = await legible(page, heading),
        quieter = await legible(page, quiet)
      evidence[name] = { seen, drawn, main, quieter }
      // (Without transparency every page is solid, and the picture is not shown.)
      if ((await throughGlass(page)).glass)
        expect.soft(seen.chroma, `${name}: the picture shows through`).toBeGreaterThan(25)
      expect.soft(drawn, `${name}: the picture is drawn once`).toBe(1)
      expect.soft(main, `${name}: main text`).toBeGreaterThanOrEqual(4.5)
      expect.soft(quieter, `${name}: quiet text`).toBeGreaterThanOrEqual(3)
    }
    // Over a dark picture in the light theme the Work page's pane turns dark, and its controls
    // with it: the chosen segment's label stays legible on its thumb.
    const forest = test.info().outputPath('forest.png')
    await writeFile(forest, await picture(page, 'forest'))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
    }, forest)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await page.getByRole('button', { name: '選擇圖片…', exact: true }).click()
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await sidebarShown(page)
    await page.locator('[data-region="sidebar"]').getByText('工作', { exact: true }).click()
    const pane = page.locator('[data-region="content"]')
    if ((await throughGlass(page)).glass)
      await expect(pane).toHaveAttribute('data-appearance', 'dark', { timeout: 20000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: test.info().outputPath('works-forest-light.png') })
    const chosen = pane.locator('[aria-selected="true"], [aria-checked="true"]').first()
    const segment = await legible(page, chosen)
    evidence['works forest'] = { segment }
    expect.soft(segment, 'the chosen segment over a dark page').toBeGreaterThanOrEqual(4.5)
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
