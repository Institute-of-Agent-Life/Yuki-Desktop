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
  // 10: light lands only on the edge facing it; the sides stay clear and nothing draws an outline.
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
      side: alpha(image.width - 2, Math.round(image.height / 2)),
      bottom: alpha(Math.round(image.width / 2), image.height - 2),
      outline: getComputedStyle(surface, '::before').backgroundImage,
    }
  })
  evidence.restingLight = light
  expect(light.top).toBeGreaterThan(128)
  expect(light.side).toBeLessThan(light.top / 3)
  expect(light.bottom).toBeLessThan(light.top / 3)
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
