import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('apple-light.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})
test.use({ deviceScaleFactor: 2 })

// Reads screen pixels inside `clip` (CSS px) at the display's own resolution.
async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const shot = await page.screenshot({ clip })
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = new OffscreenCanvas(image.width, image.height),
      context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return {
      width: image.width,
      height: image.height,
      data: [...context.getImageData(0, 0, image.width, image.height).data],
    }
  }, shot.toString('base64'))
}

test('a tinted button is rimmed with its own colour, brighter than its fill', async ({ page }) => {
  await page.goto('http://127.0.0.1:4178/components.html')
  const button = page.getByRole('button', { name: '開啟對話框', exact: true })
  await expect(button).toBeVisible()
  await page.mouse.move(2, 2)
  await page.waitForTimeout(300)
  const box = (await button.boundingBox())!
  const image = await pixels(page, box)
  const at = (x: number, y: number) =>
    image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)
  const light = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  // The top edge just inside the corner's curve, and the plain fill beside the label.
  const edge = at(Math.round(image.width / 2), 1),
    fill = at(8, Math.round(image.height / 2))
  evidence.tinted = { edge, fill }
  // 3: brighter than the fill, and lit in its own colour: no neutral white in the light.
  expect(light(edge)).toBeGreaterThan(light(fill))
  const colours = await button.evaluate((element) => {
    // Each colour of the rim's light read back as RGB (image data is not premultiplied); clear
    // stops carry no light.
    const context = new OffscreenCanvas(1, 1).getContext('2d')!
    return (
      getComputedStyle(element, '::before').backgroundImage.match(
        /(?:rgba?|oklch|color)\([^()]*\)/g,
      ) ?? []
    )
      .map((colour) => {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = colour
        context.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
        return {
          colour,
          rgb: [r!, g!, b!],
          a: a!,
        }
      })
      .filter(({ a }) => a > 0)
  })
  evidence.rimColours = colours
  expect(colours.length).toBeGreaterThan(0)
  for (const { colour, rgb } of colours) expect(rgb[2]! - rgb[0]!, colour).toBeGreaterThan(30)
})

test('the conversation frosts and fades into its top edge as it scrolls under it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 560 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    document.documentElement.dataset.backdrop = 'grid'
    ;(
      window as unknown as { regression: { connection(state: string): void } }
    ).regression.connection('online')
  })
  const log = page.getByRole('log', { name: '對話訊息' })
  await log.evaluate((node) => (node.scrollTop = node.scrollHeight))
  await page.waitForTimeout(600)
  const layers = await page.evaluate(() => {
    const blur = (which: string) =>
      parseFloat(
        getComputedStyle(
          document.querySelector(`[data-edge-fade="${which}"]`)!,
        ).backdropFilter.match(/blur\(([\d.]+)px\)/)?.[1] ?? '0',
      )
    return { upper: blur('upper'), lower: blur('lower') }
  })
  evidence.fadeLayers = layers
  // 4: two layers, blurring more towards the edge.
  expect(layers.lower).toBeGreaterThan(0)
  expect(layers.upper).toBeGreaterThan(layers.lower)
  // The grid shows through the middle of the fade, blurred, and fades out towards the top.
  // Sampled across the fade itself: content shows again near its lower end, frosted out at the top.
  const box = (await page.locator('[data-edge-fade="lower"]').boundingBox())!
  const strip = await pixels(page, { x: box.x + 40, y: box.y, width: 400, height: box.height })
  const contrast = (y: number) => {
    const row = Array.from({ length: strip.width }, (_, x) => {
      const k = (y * strip.width + x) * 4
      return 0.2126 * strip.data[k]! + 0.7152 * strip.data[k + 1]! + 0.0722 * strip.data[k + 2]!
    })
    return Math.max(...row) - Math.min(...row)
  }
  const middle = contrast(Math.round(strip.height * 0.8)),
    top = contrast(3)
  evidence.fadeContrast = { middle, top }
  expect(middle).toBeGreaterThanOrEqual(6)
  expect(top).toBeLessThan(middle)

  // 5: scrolling under the fade stays within its frames.
  await page.evaluate(() => {
    const w = window as unknown as { long: number[] }
    w.long = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.long.push(entry.duration)
    }).observe({ type: 'longtask' })
  })
  const area = (await log.boundingBox())!
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
  for (let step = 0; step < 12; step++) {
    await page.mouse.wheel(0, step < 6 ? -80 : 80)
    await page.waitForTimeout(40)
  }
  const long = await page.evaluate(() => (window as unknown as { long: number[] }).long)
  evidence.scrollLongTasks = long
  expect(long.filter((duration) => duration > 50)).toEqual([])
})
