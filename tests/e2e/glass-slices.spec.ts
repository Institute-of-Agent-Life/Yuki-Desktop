import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { readRim } from '../fixtures/rim'

// 液态玻璃组件统一任务书 (2026-11-12), step 1: glass maps from slices. Failure cases 9, 13, 16.
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('glass-slices.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})
test.use({ deviceScaleFactor: 2 })

const regressions = 'http://127.0.0.1:4178/renderer-regressions.html'
const gallery = 'http://127.0.0.1:4178/components.html'

// Time spent making glass maps: for every canvas, from its first context to its last write.
async function watchMaps(page: Page) {
  await page.addInitScript(() => {
    const started = new WeakMap<HTMLCanvasElement, number>(),
      spent = new Map<HTMLCanvasElement, number>()
    const state = window as unknown as { maps(): number; resetMaps(): void }
    state.maps = () => [...spent.values()].reduce((sum, value) => sum + value, 0)
    state.resetMaps = () => spent.clear()
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      if (!started.has(this)) started.set(this, performance.now())
      return getContext.apply(this, args)
    } as typeof getContext
    const written = (canvas: HTMLCanvasElement) =>
      spent.set(canvas, performance.now() - (started.get(canvas) ?? performance.now()))
    const put = CanvasRenderingContext2D.prototype.putImageData
    CanvasRenderingContext2D.prototype.putImageData = function (
      this: CanvasRenderingContext2D,
      ...args: Parameters<typeof put>
    ) {
      put.apply(this, args)
      written(this.canvas)
    } as typeof put
    const url = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof url>
    ) {
      const result = url.apply(this, args)
      written(this)
      return result
    }
  })
}
const mapTime = (page: Page) =>
  page.evaluate(() => (window as unknown as { maps(): number }).maps())
const resetMaps = (page: Page) =>
  page.evaluate(() => (window as unknown as { resetMaps(): void }).resetMaps())
async function longTasks(page: Page) {
  await page.evaluate(() => {
    const state = window as unknown as { long: number[] }
    state.long = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.long.push(entry.duration)
    }).observe({ type: 'longtask' })
  })
  return () => page.evaluate(() => (window as unknown as { long: number[] }).long)
}

test('the same glass lights and bends its corners and edges alike at any size', async ({
  page,
}) => {
  await page.goto(`${regressions}?case=conversation-glass`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  const composer = page.locator('[data-region="composer"]')
  // The glass's own maps, read where they are laid: its light at points of the top-left corner
  // and along the straight top edge, and the pieces its bend is put together from.
  const maps = async (width: number) => {
    await page.setViewportSize({ width, height: 760 })
    await expect(composer).toHaveAttribute('data-refracting', 'true')
    await page.waitForTimeout(400)
    const box = (await composer.boundingBox())!
    const rim = await composer.evaluate(readRim, [
      ...Array.from({ length: 24 }, (_, x) => [x, 0.5] as [number, number]),
      [box.width / 2 - 50, 0.5],
      [box.width / 2 + 50, 0.5],
    ] as [number, number][])
    const pieces = await composer.evaluate((element) => {
      const id = getComputedStyle(element).backdropFilter.match(/#(yuki-glass-\d+)/)![1]!
      return [...document.getElementById(id)!.querySelectorAll('feImage')]
        .filter((image) => image.getAttribute('result')!.startsWith('bevel-'))
        .map((image) => ({
          href: image.getAttribute('href'),
          // Corners keep their size; only the stretched edges grow with the glass.
          size: [image.getAttribute('width'), image.getAttribute('height')],
        }))
    })
    return { width: box.width, corner: rim.light.slice(0, 24), edge: rim.light.slice(24), pieces }
  }
  // The composer is at most 712px wide: narrower than that in a narrow window.
  const narrow = await maps(600),
    wide = await maps(1400)
  evidence.maps = { narrow, wide }
  expect(wide.width).toBeGreaterThan(narrow.width + 100)
  // 9: the corner looks the same however wide the glass, and the edge is even along its length.
  expect(wide.corner).toEqual(narrow.corner)
  for (const sample of [narrow, wide]) expect(sample.edge[0]).toBe(sample.edge[1])
  // The bend is the same pieces, moved: none is painted again for the new width.
  expect(wide.pieces.map((piece) => piece.href)).toEqual(narrow.pieces.map((piece) => piece.href))
})

test('the pointer lights only the glass, never the whole page', async ({ page }) => {
  await page.goto(gallery)
  await page.mouse.move(200, 200)
  await page.mouse.move(260, 240)
  // 13
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--pointer-x'),
    ),
  ).toBe('-10000px')
})

test('opening panes and resizing glass stay within their map budget', async ({ page }) => {
  test.setTimeout(120000)
  await watchMaps(page)
  const budget: Record<string, unknown> = {}

  // The dialog.
  await page.goto(gallery)
  let long = await longTasks(page)
  await resetMaps(page)
  await page.getByRole('button', { name: '開啟對話框', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAttribute('data-refracting', 'true')
  await page.waitForTimeout(800)
  budget.dialog = { maps: await mapTime(page), long: await long() }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  await resetMaps(page)
  await page.getByRole('button', { name: '開啟對話框', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveAttribute('data-refracting', 'true')
  await page.waitForTimeout(800)
  budget.dialogAgain = { maps: await mapTime(page), long: await long() }

  // The command palette.
  await page.goto(`${regressions}?case=palette`)
  long = await longTasks(page)
  await expect(page.locator('dialog[data-glass="sheet"]')).toHaveAttribute(
    'data-refracting',
    'true',
  )
  await page.waitForTimeout(800)
  budget.palette = { maps: await mapTime(page), long: await long() }

  // The Yuki menu.
  await page.goto('http://127.0.0.1:4178/role-switcher.html')
  long = await longTasks(page)
  await resetMaps(page)
  const toggle = page.getByRole('button', { name: '切換 Yuki', exact: true })
  await toggle.click()
  await expect(page.getByRole('menu')).toHaveAttribute('data-refracting', 'true')
  await page.waitForTimeout(800)
  budget.menu = { maps: await mapTime(page), long: await long() }
  await toggle.click()
  await page.waitForTimeout(800)
  await resetMaps(page)
  await toggle.click()
  await expect(page.getByRole('menu')).toHaveAttribute('data-refracting', 'true')
  await page.waitForTimeout(800)
  budget.menuAgain = { maps: await mapTime(page), long: await long() }

  // The composer, as the window narrows a pixel at a time.
  await page.setViewportSize({ width: 720, height: 760 })
  await page.goto(`${regressions}?case=conversation-glass`)
  const composer = page.locator('[data-region="composer"]')
  await expect(composer).toHaveAttribute('data-refracting', 'true')
  const steps: number[] = [],
    widths = new Set<number>()
  for (let step = 1; step <= 20; step++) {
    await resetMaps(page)
    await page.setViewportSize({ width: 720 - step, height: 760 })
    await page.waitForTimeout(80)
    steps.push(await mapTime(page))
    widths.add((await composer.boundingBox())!.width)
  }
  budget.resize = { steps, widths: [...widths] }
  // The composer follows the window, so each step is a new size.
  expect(widths.size).toBeGreaterThan(10)
  evidence.budget = budget

  // 16: a kind of glass is painted once, as a slice, the first time it is shown; after that, and
  // at any other size, its maps are only put together. Measured unthrottled, with room for slower
  // machines (CI's macOS runner is about six times slower than a desktop Mac): whole maps took
  // about 17ms to open a dialog and 8ms per step of a resize; slices take about 2.5ms to open, and
  // a resize only moves the pieces of the bend, painting nothing.
  for (const pane of ['dialog', 'palette', 'menu', 'dialogAgain', 'menuAgain'] as const) {
    const { maps, long } = budget[pane] as { maps: number; long: number[] }
    expect(maps, pane).toBeLessThanOrEqual(pane.endsWith('Again') ? 2 : 30)
    expect(
      long.filter((duration) => duration > 100),
      pane,
    ).toEqual([])
  }
  expect(Math.max(...steps)).toBeLessThanOrEqual(4)
})
