import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { dockGlass } from '../fixtures/dock-glass'

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

test('resting bubbles are shaped by their radius, and lit glass has its light at display resolution', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openConversation(page)
  const resting = page.locator('article[data-event-id="34"] [data-surface="bubble"]')
  // Q1 of the 液态玻璃组件统一 task book: a bubble is content, a frosted, tinted pane with no lens
  // (frosted by the backdrop blurred once: frosted-bubbles).
  await expect(resting).toHaveCSS('backdrop-filter', 'none')
  // 1: at rest the radius alone shapes the glass, never a clip-path with its square backdrop.
  const shape = await resting.evaluate((surface) => ({
    clip: getComputedStyle(surface).clipPath,
    radius: getComputedStyle(surface).borderTopLeftRadius,
    bubble: surface.parentElement!.getBoundingClientRect().width,
    surface: surface.getBoundingClientRect().width,
  }))
  evidence.restingShape = shape
  expect(shape.clip).toBe('none')
  expect(shape.radius).toBe('16px')
  expect(shape.surface).toBe(shape.bubble)
  // 2, as revised by the 液态玻璃组件统一 task book: the rim's map is drawn at the display's own
  // pixels, so the rim stays smooth on Retina screens at any size.
  const lit = page.locator('[data-region="composer"]')
  await expect(lit).toHaveAttribute('data-refracting', 'true')
  const resolution = await lit.evaluate(async (element) => {
    const id = getComputedStyle(element).backdropFilter.match(/url\("?#(yuki-glass-[^")]+)/)![1]!
    const pieces = [...document.getElementById(id)!.querySelectorAll('feImage')].filter((node) =>
      node.getAttribute('result')!.startsWith('bevel-'),
    )
    const scales = await Promise.all(
      pieces.map(async (piece) => {
        const image = new Image()
        image.src = piece.getAttribute('href')!
        await image.decode()
        // A piece stretched along a straight side is a CSS pixel long; across, at full scale.
        return Math.max(
          image.width / Number(piece.getAttribute('width')),
          image.height / Number(piece.getAttribute('height')),
        )
      }),
    )
    return { ratio: devicePixelRatio, scales }
  })
  evidence.restingLightMap = resolution
  for (const scale of resolution.scales) expect(scale).toBeGreaterThanOrEqual(resolution.ratio)
  // 10, as revised by the Dock's measurement (dock.ts): the rim is added to what the tone gives,
  // 52 levels at the top's outermost pixel and 6 at 3pt; no outline on top.
  const glass = await dockGlass(lit)
  evidence.restingLight = glass.rim
  expect(glass.rim?.added).toBe(true)
  expect(Math.abs(glass.rim!.edge - 52)).toBeLessThanOrEqual(2)
  expect(Math.abs(glass.rim!.inside - 6)).toBeLessThanOrEqual(1)
  expect(await lit.evaluate((surface) => getComputedStyle(surface, '::before').content)).toBe(
    'none',
  )

  // An entering reply reaches past its bubble only while it enters.
  await page.evaluate(() =>
    (window as unknown as GlassWindow).regression.receiveGlassReply('已把問題放在摘要最後。'),
  )
  const reply = page.locator('article[data-event-id="35"] [data-surface="bubble"]')
  await expect(reply).toHaveAttribute('data-liquid', '')
  expect(await reply.evaluate((surface) => getComputedStyle(surface).clipPath)).not.toBe('none')
  await expect(reply).not.toHaveAttribute('data-liquid', '')
  expect(await reply.evaluate((surface) => getComputedStyle(surface).clipPath)).toBe('none')
})

test('floating panes blur before they bend, never disperse, and draw no ring', async ({ page }) => {
  await openConversation(page)
  const composer = page.locator('[data-region="composer"]')
  await expect(composer).toHaveAttribute('data-refracting', 'true')
  // 4, as revised by the final glass: the blur comes first, so its soft shapes melt in the bend.
  const filter = await composer.evaluate((element) => getComputedStyle(element).backdropFilter)
  expect(filter).toMatch(/^blur\([\d.]+px\) url\(/)
  const bends = await composer.evaluate((element) => {
    const id = getComputedStyle(element).backdropFilter.match(/#([^")]+)/)![1]!
    const filter = document.getElementById(id)!
    return {
      scales: [...filter.querySelectorAll('feDisplacementMap')].map((map) =>
        Number(map.getAttribute('scale')),
      ),
    }
  })
  evidence.composerBends = bends
  // The bevel's bend alone (the Dock shows no wobble), so no colour is parted.
  expect(bends.scales).toHaveLength(1)
  // 3: the rim shapes the glass: no ring or shadow lies around it, light or dark (the Dock draws
  // none); increased contrast draws its own edge instead.
  const edge = () =>
    composer.evaluate((element) => ({
      shadow: getComputedStyle(element).boxShadow,
      outline: `${getComputedStyle(element).outlineStyle} ${getComputedStyle(element).outlineColor}`,
    }))
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'))
  expect(await edge()).toEqual({ shadow: 'none', outline: expect.stringMatching(/^none/) })
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  expect(await edge()).toEqual({ shadow: 'none', outline: expect.stringMatching(/^none/) })
  await page.evaluate(() => (document.documentElement.dataset.contrast = 'true'))
  expect((await edge()).shadow).not.toBe('none')
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'))
  expect((await edge()).outline).toMatch(/^none/)
})

// What shows through a pane, read from the screen: the grid's contrast in its clear middle.
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
    return { contrast: Math.max(...light) - Math.min(...light) }
  }, shot.toString('base64'))
}

test('a floating pane lets the backdrop through', async ({ page }) => {
  for (const [theme, least] of [
    ['light', 6],
    ['dark', 4],
  ] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await openConversation(page)
    // Bars broad enough to outlast the final glass's 2–3px blur and the body light in its middle.
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
      document.documentElement.dataset.backdrop = 'grid'
      document.documentElement.style.setProperty(
        '--backdrop-grid',
        `repeating-linear-gradient(90deg, ${theme === 'dark' ? 'rgb(255 255 255 / 0.3)' : 'rgb(20 30 50 / 0.3)'} 0 8px, transparent 8px 24px)`,
      )
    }, theme)
    await page.mouse.move(10, 700)
    await expect(page.locator('[data-region="composer"]')).toHaveAttribute(
      'data-refracting',
      'true',
    )
    // The glass bends in as it appears; it is measured once it has fully.
    await expect
      .poll(() =>
        page.locator('[data-region="composer"]').evaluate(async (element) => {
          const id = getComputedStyle(element).backdropFilter.match(/#(yuki-glass-\d+)/)![1]!
          const scale = () =>
            document.getElementById(id)!.querySelector('feDisplacementMap')!.getAttribute('scale')
          const first = scale()
          await new Promise((resolve) => setTimeout(resolve, 100))
          return first === scale()
        }),
      )
      .toBe(true)
    const seen = await through(page, '[data-region="composer"]')
    evidence[`composer-${theme}`] = seen
    // 8: the grid behind still shows through the clear middle.
    expect(seen.contrast).toBeGreaterThanOrEqual(least)
  }
})

test('narrow glass bends at the display resolution', async ({ page }) => {
  await openConversation(page)
  const short = page.locator('[data-region="toolbar"] [data-glass="toolbar"]').first()
  await expect(short).toHaveAttribute('data-refracting', 'true')
  // 5 (透明磨砂 task book): glass this narrow is mapped at the display's own pixels.
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
  // Over the page itself, which the Dock's dark tone (20 + 0.67·B) lifts; over a bright backdrop
  // it darkens it, as the Dock's does (materials/dock.ts).
  for (const backdrop of ['plain']) {
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
    test('glass over a translucent panel is as light as the panel', async ({ page }) => {
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
