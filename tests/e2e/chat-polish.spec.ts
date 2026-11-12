import { expect, test } from '@playwright/test'

test('selecting a message frames its bubble, not the avatar beside it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  const reply = page.locator('article[data-event-id="34"]')
  await expect(reply).toBeVisible()
  await reply.locator('[data-bubble-copy]').click()
  await expect(reply).toHaveClass(/selected/)
  const frame = await reply.evaluate((article) => {
    const bubble = article.querySelector<HTMLElement>('[data-glass="bubble"]')!.parentElement!
    const avatar = article.querySelector('[role="img"]')!.getBoundingClientRect()
    const box = bubble.getBoundingClientRect()
    return {
      article: getComputedStyle(article).outlineStyle,
      bubble: getComputedStyle(bubble).outlineStyle,
      offset: parseFloat(getComputedStyle(bubble).outlineOffset),
      // The outline is drawn around the bubble's own box; the avatar sits wholly outside it.
      clear: avatar.right < box.left - parseFloat(getComputedStyle(bubble).outlineOffset) - 2,
    }
  })
  expect(frame).toEqual({ article: 'none', bubble: 'solid', offset: 2, clear: true })
})

test('each conversation backdrop sits behind the glass, and solid material replaces it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  const backdrop = (choice: string) =>
    page.evaluate((choice) => {
      document.documentElement.dataset.backdrop = choice
      const chat = document.querySelector('[role="log"]')!.parentElement!
      const image = getComputedStyle(chat).backgroundImage
      return {
        radial: (image.match(/radial-gradient/g) ?? []).length,
        repeating: (image.match(/repeating-linear-gradient/g) ?? []).length,
        linear: (image.match(/(^|[^-])linear-gradient/g) ?? []).length,
      }
    }, choice)
  expect(await backdrop('lens')).toEqual({ radial: 2, repeating: 0, linear: 1 })
  expect(await backdrop('plain')).toEqual({ radial: 0, repeating: 0, linear: 0 })
  expect(await backdrop('aurora')).toEqual({ radial: 4, repeating: 0, linear: 0 })
  expect(await backdrop('sunset')).toEqual({ radial: 3, repeating: 0, linear: 0 })
  expect(await backdrop('grid')).toEqual({ radial: 0, repeating: 2, linear: 0 })
  await page.screenshot({ path: test.info().outputPath('backdrop-grid.png') })
  // With transparency off the glass is solid, and so is what lies behind it.
  await page.evaluate(() => (document.documentElement.dataset.opaque = 'true'))
  expect(await backdrop('aurora')).toEqual({ radial: 0, repeating: 0, linear: 0 })
})

test('the desktop backdrop lets the system frost through, keeps something for the glass to bend, and falls back when it cannot', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  const look = (material: string, theme: string) =>
    page.evaluate(
      ([material, theme]) => {
        const root = document.documentElement
        root.dataset.backdrop = 'desktop'
        root.dataset.material = material
        root.dataset.theme = theme
        const chat = document.querySelector('[role="log"]')!.parentElement!
        const main = chat.closest('section')!
        const alpha = (colour: string) => {
          const context = new OffscreenCanvas(1, 1).getContext('2d')!
          context.fillStyle = colour
          context.fillRect(0, 0, 1, 1)
          return context.getImageData(0, 0, 1, 1).data[3]! / 255
        }
        const image = getComputedStyle(chat).backgroundImage
        return {
          panel: alpha(getComputedStyle(main).backgroundColor),
          chatBase: alpha(getComputedStyle(chat).backgroundColor),
          texture: (image.match(/gradient/g) ?? []).length,
        }
      },
      [material, theme],
    )
  for (const theme of ['light', 'dark']) {
    // 1 and 2: the panel is its own colour, half clear; the chat lays no solid sheet over it,
    // only a faint texture for the glass to bend.
    const frosted = await look('vibrancy', theme)
    expect(frosted.panel).toBeGreaterThan(0.2)
    expect(frosted.panel).toBeLessThan(0.9)
    expect(frosted.chatBase).toBeLessThan(0.05)
    expect(frosted.texture).toBeGreaterThan(0)
  }
  await page.screenshot({ path: test.info().outputPath('backdrop-desktop.png') })
  // 3: with no system material behind it, it is a solid backdrop again.
  const solid = await look('none', 'light')
  expect(solid.panel).toBe(1)
  expect(solid.chatBase).toBe(1)
})
