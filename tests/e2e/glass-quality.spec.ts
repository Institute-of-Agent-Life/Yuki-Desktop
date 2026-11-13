import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('glass-quality.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})
test.use({ deviceScaleFactor: 2 })

type GlassWindow = Window & {
  regression: { connection(state: 'online'): void; receiveGlassReply(text: string): void }
}

async function openConversation(page: Page) {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as GlassWindow).regression.connection('online'))
}

// The light map's pixel size, against the pane's own box at the display's pixel ratio.
const lightMap = (page: Page, selector: string) =>
  page.locator(selector).evaluate(async (element: HTMLElement) => {
    const image = new Image()
    image.src = getComputedStyle(element)
      .getPropertyValue('--rim')
      .match(/url\("?(.*?)"?\)$/)![1]!
    await image.decode()
    return {
      image: [image.width, image.height],
      expected: [
        Math.round(element.offsetWidth * devicePixelRatio),
        Math.round(element.offsetHeight * devicePixelRatio),
      ],
    }
  })

test('resting bubbles are shaped by their radius, with a light map at display resolution', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openConversation(page)
  const resting = page.locator('article[data-event-id="34"] [data-glass="bubble"]')
  await expect(resting).toHaveAttribute('data-refracting', 'true')
  // 1: at rest the radius alone shapes the glass, never a clip-path with its square backdrop.
  const shape = await resting.evaluate((surface) => ({
    clip: getComputedStyle(surface).clipPath,
    radius: getComputedStyle(surface).borderTopLeftRadius,
    bubble: surface.parentElement!.getBoundingClientRect().width,
    surface: surface.getBoundingClientRect().width,
  }))
  evidence.restingShape = shape
  expect(shape.clip).toBe('none')
  expect(shape.radius).toBe('18px')
  expect(shape.surface).toBe(shape.bubble)
  // 2: the light map has the display's own pixels, so the rim stays smooth on Retina screens.
  const rest = await lightMap(page, 'article[data-event-id="34"] [data-glass="bubble"]')
  evidence.restingLightMap = rest
  expect(rest.image).toEqual(rest.expected)
  // 10, and 1–2 of the 苹果式打光 task book: a thin light on the edge facing it and a softer one
  // on the far edge, as in thick glass; the sides between stay dim and nothing draws an outline.
  const light = await resting.evaluate(async (surface) => {
    const image = new Image()
    image.src = getComputedStyle(surface)
      .getPropertyValue('--rim')
      .match(/url\("?(.*?)"?\)$/)![1]!
    await image.decode()
    const canvas = new OffscreenCanvas(image.width, image.height),
      context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const alpha = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3]!
    return {
      top: alpha(Math.round(image.width / 2), 1),
      inward: alpha(Math.round(image.width / 2), 4),
      side: alpha(image.width - 2, Math.round(image.height / 2)),
      left: alpha(1, Math.round(image.height / 2)),
      bottom: alpha(Math.round(image.width / 2), image.height - 2),
      outline: getComputedStyle(surface, '::before').backgroundImage,
    }
  })
  evidence.restingLight = light
  expect(light.top).toBeGreaterThan(128)
  expect(light.bottom).toBeGreaterThanOrEqual(light.top * 0.35)
  expect(light.side).toBeLessThan(light.bottom)
  expect(light.left).toBeLessThan(light.bottom)
  // A line about a display pixel thick: three pixels in, its light is mostly gone.
  expect(light.inward).toBeLessThan(light.top * 0.4)
  expect(light.outline).toBe('none')

  // An entering reply reaches past its bubble only while it enters, then its map follows it back.
  await page.evaluate(() =>
    (window as unknown as GlassWindow).regression.receiveGlassReply('已把問題放在摘要最後。'),
  )
  const reply = page.locator('article[data-event-id="35"] [data-glass="bubble"]')
  await expect(reply).toHaveAttribute('data-liquid', '')
  expect(await reply.evaluate((surface) => getComputedStyle(surface).clipPath)).not.toBe('none')
  await expect(reply).not.toHaveAttribute('data-liquid', '')
  await expect
    .poll(async () => {
      const map = await lightMap(page, 'article[data-event-id="35"] [data-glass="bubble"]')
      return map.image.join('x') === map.expected.join('x')
    })
    .toBe(true)
  expect(await reply.evaluate((surface) => getComputedStyle(surface).clipPath)).toBe('none')
})

test('floating panes bend before they blur, disperse visibly and need no drawn outline', async ({
  page,
}) => {
  await openConversation(page)
  const composer = page.locator('[data-region="composer"]')
  await expect(composer).toHaveAttribute('data-refracting', 'true')
  // 4: the bend and its colour fringe come first, so the blur softens the fringe like light.
  const filter = await composer.evaluate((element) => getComputedStyle(element).backdropFilter)
  expect(filter).toMatch(/^url\(/)
  const bends = await composer.evaluate((element) => {
    const id = getComputedStyle(element).backdropFilter.match(/#([^")]+)/)![1]!
    return [...document.getElementById(id)!.querySelectorAll('feDisplacementMap')].map((map) =>
      Number(map.getAttribute('scale')),
    )
  })
  evidence.composerBends = bends
  const [green, red, blue] = bends as [number, number, number]
  expect(red / green).toBeCloseTo(0.68, 2)
  expect(blue / green).toBeCloseTo(1.32, 2)
  // 3: glass is shaped by its lit rim; only increased contrast draws an outline around it.
  const outline = () => composer.evaluate((element) => getComputedStyle(element).boxShadow)
  expect(await outline()).toMatch(/^rgba\(0, 0, 0, 0\) 0px 0px 0px 0\.5px/)
  await page.evaluate(() => (document.documentElement.dataset.contrast = 'true'))
  expect(await outline()).not.toMatch(/^rgba\(0, 0, 0, 0\) 0px 0px 0px 0\.5px/)
})

// What shows through a pane, read from the screen: the grid's contrast in its clear middle and
// how far red and blue part in its top bezel.
async function through(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!
  const shot = await page.screenshot({ clip: box })
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = new OffscreenCanvas(image.width, image.height),
      context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const pixel = (x: number, y: number) => context.getImageData(x, y, 1, 1).data
    const middle = Math.round(image.height / 2),
      light: number[] = []
    for (let x = Math.round(image.width * 0.38); x < image.width * 0.62; x++) {
      const [r, g, b] = pixel(x, middle)
      light.push(0.2126 * r! + 0.7152 * g! + 0.0722 * b!)
    }
    let fringe = 0
    for (let x = Math.round(image.width * 0.3); x < image.width * 0.9; x += 2)
      for (let y = 2; y < 20; y++) {
        const [r, , b] = pixel(x, y)
        fringe = Math.max(fringe, Math.abs(r! - b!))
      }
    return { contrast: Math.max(...light) - Math.min(...light), fringe }
  }, shot.toString('base64'))
}

test('a floating pane lets the backdrop through and parts its colours at the edge', async ({
  page,
}) => {
  for (const [theme, least] of [
    ['light', 6],
    ['dark', 4],
  ] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await openConversation(page)
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
      document.documentElement.dataset.backdrop = 'grid'
    }, theme)
    await page.mouse.move(10, 700)
    await expect(page.locator('[data-region="composer"]')).toHaveAttribute(
      'data-refracting',
      'true',
    )
    await page.waitForTimeout(500)
    const seen = await through(page, '[data-region="composer"]')
    evidence[`composer-${theme}`] = seen
    // 8: the grid behind still shows through the clear middle.
    expect(seen.contrast).toBeGreaterThanOrEqual(least)
    // 9: the bezel parts red from blue enough to be seen.
    expect(seen.fringe).toBeGreaterThanOrEqual(22)
  }
})

test('narrow glass bends at the display resolution', async ({ page }) => {
  await openConversation(page)
  await page.evaluate(() => (window as unknown as GlassWindow).regression.receiveGlassReply('好'))
  const short = page.locator('article[data-event-id="35"] [data-glass="bubble"]')
  await expect(short).toHaveAttribute('data-refracting', 'true')
  await expect(short).not.toHaveAttribute('data-liquid', '')
  await page.waitForTimeout(300)
  // 5 (透明磨砂 task book): a bubble this short is mapped at the display's own pixels.
  const map = await short.evaluate(async (surface: HTMLElement) => {
    const id = getComputedStyle(surface).backdropFilter.match(/#([^")]+)/)![1]!
    const image = new Image()
    image.src = document.getElementById(id)!.querySelector('feImage')!.getAttribute('href')!
    await image.decode()
    return { width: image.width, expected: Math.round(surface.offsetWidth * devicePixelRatio) }
  })
  evidence.narrowBend = map
  expect(map.width).toBeGreaterThanOrEqual(map.expected - 1)
})

test('dark glass does not darken what lies behind it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openConversation(page)
  const read = async (x: number, y: number) => {
    const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
    return page.evaluate(async (data) => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const context = new OffscreenCanvas(1, 1).getContext('2d')!
      context.drawImage(image, 0, 0)
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }, shot.toString('base64'))
  }
  const composer = page.locator('[data-region="composer"]')
  for (const backdrop of ['plain', 'lens', 'aurora']) {
    await page.evaluate((backdrop) => {
      document.documentElement.dataset.theme = 'dark'
      document.documentElement.dataset.backdrop = backdrop
    }, backdrop)
    await page.mouse.move(10, 700)
    await expect(composer).toHaveAttribute('data-refracting', 'true')
    await page.waitForTimeout(400)
    const box = (await composer.boundingBox())!
    // A clear spot inside the composer, and the backdrop just outside its right end.
    const inside = await read(box.x + box.width - 40, box.y + box.height * 0.5),
      outside = await read(box.x + box.width + 6, box.y + box.height * 0.5)
    evidence[`darkGlass-${backdrop}`] = { inside, outside }
    // 7 (透明磨砂 task book)
    expect(inside, backdrop).toBeGreaterThanOrEqual(outside - 1)
  }
})

for (const scale of [1, 2])
  test.describe(`at ${scale}x`, () => {
    test.use({ deviceScaleFactor: scale })
    test('dispersing glass over a translucent panel is as light as the panel', async ({ page }) => {
      await page.setViewportSize({ width: 1100, height: 640 })
      await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
      await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
      // A wallpaper beneath the page itself, where the system's frost lies under the window.
      await page.addStyleTag({
        content:
          'html { background: radial-gradient(60% 70% at 20% 30%, #f59e8b, transparent), radial-gradient(60% 70% at 85% 70%, #6aa6ff, transparent), #9a7fd6 !important } body { background: transparent !important }',
      })
      await page.evaluate(() => {
        const root = document.documentElement
        root.dataset.theme = 'light'
        root.dataset.backdrop = 'plain'
        root.dataset.material = 'vibrancy'
      })
      await page.mouse.move(5, 5)
      const composer = page.locator('[data-region="composer"]')
      await expect(composer).toHaveAttribute('data-refracting', 'true')
      await page.waitForTimeout(500)
      const box = (await composer.boundingBox())!
      const light = async (x: number, y: number) => {
        const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
        return page.evaluate(async (data) => {
          const image = new Image()
          image.src = `data:image/png;base64,${data}`
          await image.decode()
          const context = new OffscreenCanvas(1, 1).getContext('2d')!
          context.drawImage(image, 0, 0)
          const [r, g, b] = context.getImageData(0, 0, 1, 1).data
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
        }, shot.toString('base64'))
      }
      const inside = await light(box.x + box.width * 0.5, box.y + box.height * 0.5),
        beside = await light(box.x + box.width * 0.5, box.y - 12)
      evidence.translucentPanel = { inside, beside }
      // 8 (透明磨砂 task book): no darker than the panel it lies on.
      expect(inside).toBeGreaterThanOrEqual(beside - 6)
    })
  })
