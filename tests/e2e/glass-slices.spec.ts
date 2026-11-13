import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

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

test('the same glass lights its corners and edges alike at any size', async ({ page }) => {
  await page.goto(`${regressions}?case=conversation-glass`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => (document.documentElement.dataset.backdrop = 'plain'))
  await page.mouse.move(2, 2)
  const composer = page.locator('[data-region="composer"]')
  const rim = async (width: number) => {
    await page.setViewportSize({ width, height: 760 })
    await expect(composer).toHaveAttribute('data-refracting', 'true')
    await page.waitForTimeout(400)
    const box = (await composer.boundingBox())!
    const shot = await page.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: 4 },
    })
    return page.evaluate(
      async ({ data, width }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = new OffscreenCanvas(image.width, image.height),
          context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const pixels = context.getImageData(0, 0, image.width, image.height).data
        const at = (x: number, y: number) => {
          const k = (Math.round(y * 2) * image.width + Math.round(x * 2)) * 4
          return [pixels[k]!, pixels[k + 1]!, pixels[k + 2]!]
        }
        // The top-left corner's first 24px, and two points on the straight top edge 100px apart.
        return {
          corner: Array.from({ length: 24 }, (_, x) => at(x, 1)),
          edge: [at(width / 2 - 50, 0.5), at(width / 2 + 50, 0.5)],
        }
      },
      { data: shot.toString('base64'), width: box.width },
    )
  }
  const narrow = await rim(760),
    wide = await rim(1400)
  evidence.rims = { narrow, wide }
  const difference = (a: number[], b: number[]) =>
    a.reduce((sum, value, index) => sum + Math.abs(value - b[index]!), 0) / a.length
  // 9: the corner looks the same however wide the glass, and the edge is even along its length.
  const cornerDifference =
    narrow.corner.reduce((sum, value, index) => sum + difference(value, wide.corner[index]!), 0) /
    narrow.corner.length
  expect(cornerDifference).toBeLessThanOrEqual(2)
  for (const sample of [narrow, wide])
    expect(difference(sample.edge[0]!, sample.edge[1]!)).toBeLessThanOrEqual(2)
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

test('opening panes and resizing glass stay within their map budget on a slow machine', async ({
  page,
}) => {
  test.setTimeout(120000)
  await watchMaps(page)
  const cdp = await page.context().newCDPSession(page)
  const slow = () => cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  const budget: Record<string, unknown> = {}

  // The dialog.
  await page.goto(gallery)
  await slow()
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
  await slow()
  long = await longTasks(page)
  await expect(page.locator('dialog[data-glass="sheet"]')).toHaveAttribute(
    'data-refracting',
    'true',
  )
  await page.waitForTimeout(800)
  budget.palette = { maps: await mapTime(page), long: await long() }

  // The Yuki menu.
  await page.goto('http://127.0.0.1:4178/role-switcher.html')
  await slow()
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
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await page.setViewportSize({ width: 720, height: 760 })
  await page.goto(`${regressions}?case=conversation-glass`)
  const composer = page.locator('[data-region="composer"]')
  await expect(composer).toHaveAttribute('data-refracting', 'true')
  await slow()
  const steps: number[] = []
  for (let step = 1; step <= 20; step++) {
    await resetMaps(page)
    await page.setViewportSize({ width: 720 - step, height: 760 })
    await page.waitForTimeout(80)
    steps.push(await mapTime(page))
  }
  budget.resize = steps
  // The composer follows the window, so each step is a new size.
  expect(steps.filter((time) => time > 0).length).toBeGreaterThan(10)
  evidence.budget = budget

  // 16: a kind of glass is painted once, as a slice, the first time it is shown; after that, and
  // at any other size, its maps are only put together.
  for (const pane of ['dialog', 'palette', 'menu', 'dialogAgain', 'menuAgain'] as const) {
    const { maps, long } = budget[pane] as { maps: number; long: number[] }
    expect(maps, pane).toBeLessThanOrEqual(pane.endsWith('Again') ? 5 : 20)
    expect(
      long.filter((duration) => duration > 100),
      pane,
    ).toEqual([])
  }
  expect(Math.max(...steps)).toBeLessThanOrEqual(4)
})
