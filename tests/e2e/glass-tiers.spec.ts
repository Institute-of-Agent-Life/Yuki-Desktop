import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// 液态玻璃组件统一任务书 (2026-11-12), step 3: one filter per tier, ending in the seal, and glass
// that materialises by bending in. Failure cases 2, 4 and 12.
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('glass-tiers.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

const regressions = 'http://127.0.0.1:4178/renderer-regressions.html'
const gallery = 'http://127.0.0.1:4178/components.html'

// A pane's filter with its own lens named alike, so panes of one tier can be compared.
const filter = (pane: Locator) =>
  pane.evaluate((element) =>
    getComputedStyle(element).backdropFilter.replace(/yuki-glass-\d+/, 'lens'),
  )
const frost = (page: Page) =>
  page.evaluate(() => {
    document.documentElement.dataset.material = 'vibrancy'
    document.documentElement.dataset.opaque = 'false'
  })

test('every pane of a tier bends, blurs and seals the same way', async ({ page }) => {
  const tiers: Record<string, Record<string, string>> = { lens: {}, pane: {} }
  await page.goto(`${regressions}?case=conversation-glass`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await frost(page)
  const composer = page.locator('[data-region="composer"]')
  await expect(composer).toHaveAttribute('data-refracting', 'true')
  tiers.lens!.composer = await filter(composer)
  tiers.lens!.toolbar = await filter(page.locator('[data-region="toolbar"] [data-glass="toolbar"]'))

  await page.goto(gallery)
  await frost(page)
  const slider = page.getByRole('slider').first()
  const box = (await slider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const thumb = page.locator('[data-glass="slider"]').first()
  await expect(thumb).toHaveAttribute('data-refracting', 'true')
  tiers.lens!['held slider'] = await filter(thumb)
  await page.mouse.up()
  await page.getByRole('button', { name: '開啟對話框', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAttribute('data-refracting', 'true')
  tiers.pane!.dialog = await filter(dialog)
  await page.keyboard.press('Escape')

  await page.goto(`${regressions}?case=palette`)
  await frost(page)
  const palette = page.locator('dialog[data-glass="sheet"]')
  await expect(palette).toHaveAttribute('data-refracting', 'true')
  tiers.pane!.palette = await filter(palette)

  await page.goto('http://127.0.0.1:4178/role-switcher.html')
  await frost(page)
  await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toHaveAttribute('data-refracting', 'true')
  tiers.pane!.menu = await filter(menu)
  evidence.tiers = tiers

  // 2: one filter per tier, each ending in the seal while the frost is on.
  for (const [tier, panes] of Object.entries(tiers)) {
    const filters = new Set(Object.values(panes))
    expect([...filters], tier).toHaveLength(1)
    expect([...filters][0], tier).toMatch(/url\("#lens"\)/)
    expect([...filters][0], tier).toMatch(/url\("#yuki-backdrop-seal"\)$/)
  }
  expect(tiers.lens!.composer).not.toBe(tiers.pane!.dialog)

  // 4: asked to be opaque, no pane filters at all.
  await page.evaluate(() => (document.documentElement.dataset.opaque = 'true'))
  await expect(menu).toHaveCSS('backdrop-filter', 'none')
})

for (const reduced of [false, true])
  test(`a pane materialises by bending in${reduced ? ', at once with reduced motion' : ''}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' })
    await page.goto(gallery)
    await page.evaluate(() => {
      const state = window as unknown as { bends: number[] }
      state.bends = []
      const record = () => {
        const dialog = document.querySelector('dialog[open]')
        const id = dialog && getComputedStyle(dialog).backdropFilter.match(/#(yuki-glass-\d+)/)?.[1]
        const warp = id && document.getElementById(id)?.querySelector('feDisplacementMap')
        if (warp) state.bends.push(Number(warp.getAttribute('scale')))
        requestAnimationFrame(record)
      }
      requestAnimationFrame(record)
    })
    await page.getByRole('button', { name: '開啟對話框', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveAttribute('data-refracting', 'true')
    await page.waitForTimeout(800)
    const bends = await page.evaluate(() => (window as unknown as { bends: number[] }).bends)
    evidence[`bends-${reduced ? 'reduced' : 'normal'}`] = bends
    const full = bends.at(-1)!
    expect(full).toBeGreaterThan(0)
    // 12: the bend rises frame by frame to its full strength, never straight from nothing to all of
    // it; with reduced motion it is whole from the first frame.
    if (reduced) expect(bends[0]).toBe(full)
    else {
      const rising = bends.filter((value) => value > 0 && value < full)
      expect(rising.length).toBeGreaterThanOrEqual(3)
      for (const [index, value] of bends.slice(1).entries())
        expect(value).toBeGreaterThanOrEqual(bends[index]! - 0.01)
    }
  })
