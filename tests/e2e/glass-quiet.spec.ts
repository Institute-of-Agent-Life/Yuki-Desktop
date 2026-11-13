import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// 液态玻璃组件统一任务书 (2026-11-12), step 2: controls are quiet at rest and rise into glass
// only while held. Failure cases 10, 11 and 15.
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('glass-quiet.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

const kinds = ['toggle', 'segment', 'slider'] as const
const thumb = (page: Page, kind: (typeof kinds)[number]) =>
  page.locator(`[data-glass="${kind}"]`).first()
// The control a thumb belongs to: what a person presses.
const control = (page: Page, kind: (typeof kinds)[number]) =>
  kind === 'toggle'
    ? page.getByRole('switch').first()
    : kind === 'segment'
      ? page.locator('[data-glass="segment"]').first().locator('..').locator('button').first()
      : page.getByRole('slider').first()
const lens = (glass: Locator) =>
  glass.evaluate((element) => ({
    refracting: element.hasAttribute('data-refracting'),
    filter: getComputedStyle(element).backdropFilter,
  }))
const resting = (page: Page) =>
  page.evaluate(
    () =>
      [
        ...document.querySelectorAll(
          '[data-glass="toggle"],[data-glass="segment"],[data-glass="slider"]',
        ),
      ].filter(
        (element) =>
          element.hasAttribute('data-refracting') ||
          getComputedStyle(element).backdropFilter.includes('#yuki-glass-'),
      ).length,
  )

test('controls are quiet at rest and turn to glass only while held', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('http://127.0.0.1:4178/components.html')
  await expect(thumb(page, 'toggle')).toBeVisible()
  await page.waitForTimeout(500)
  // 11: at rest, however many controls a page has, none of them bends.
  const counts = {
    gallery: await resting(page),
    total: await page
      .locator('[data-glass="toggle"],[data-glass="segment"],[data-glass="slider"]')
      .count(),
  }
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=settings')
  await page.getByRole('tab', { name: '外觀', exact: true }).click()
  await page.waitForTimeout(500)
  Object.assign(counts, { settings: await resting(page) })
  evidence.resting = counts
  expect(counts.total).toBeGreaterThan(2)
  expect(counts).toMatchObject({ gallery: 0, settings: 0 })

  await page.goto('http://127.0.0.1:4178/components.html')
  await page.waitForTimeout(300)
  for (const kind of kinds) {
    const glass = thumb(page, kind)
    // 10: quiet at rest.
    expect(await lens(glass), `${kind} at rest`).toEqual({
      refracting: false,
      filter: expect.not.stringContaining('#yuki-glass-'),
    })
    const box = (await control(page, kind).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    // Held, it rises into glass.
    await expect(glass, `${kind} held`).toHaveAttribute('data-refracting', 'true')
    expect((await lens(glass)).filter).toContain('#yuki-glass-')
    await page.mouse.up()
    // Released and settled, it is quiet again.
    await expect(glass, `${kind} released`).not.toHaveAttribute('data-refracting', {
      timeout: 2000,
    })
    expect((await lens(glass)).filter).not.toContain('#yuki-glass-')
  }
})

test('holding, dragging and switching controls make no new maps once a control has been held', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    const state = window as unknown as { made: number }
    state.made = 0
    const url = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof url>
    ) {
      state.made++
      return url.apply(this, args)
    }
  })
  await page.goto('http://127.0.0.1:4178/components.html')
  await page.waitForTimeout(500)
  const made = () => page.evaluate(() => (window as unknown as { made: number }).made)
  const press = async (kind: (typeof kinds)[number], hold: number) => {
    const box = (await control(page, kind).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(hold)
    await page.mouse.up()
    await page.waitForTimeout(600)
  }
  // Each control is held once, which is when its maps are first made.
  for (const kind of kinds) await press(kind, 200)
  const before = await made()
  // 15: then a long hold, a drag of twenty steps and four switches make none.
  await press('toggle', 500)
  const slider = (await control(page, 'slider').boundingBox())!
  await page.mouse.move(slider.x + 20, slider.y + slider.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= 20; step++)
    await page.mouse.move(
      slider.x + 20 + step * ((slider.width - 40) / 20),
      slider.y + slider.height / 2,
    )
  await page.mouse.up()
  await page.waitForTimeout(600)
  const segments = page.locator('[data-glass="segment"]').first().locator('..').locator('button')
  for (let turn = 0; turn < 4; turn++) {
    await segments.nth(turn % 2 ? 0 : 1).click()
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(600)
  const after = await made()
  evidence.maps = { before, after }
  expect(after - before).toBe(0)
})
