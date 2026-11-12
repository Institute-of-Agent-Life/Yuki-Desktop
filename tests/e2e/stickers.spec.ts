import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

type StickerWindow = Window & {
  regression: {
    connection(state: 'online'): void
    receiveGlassPicture(content: string, sticker: boolean): void
  }
}

const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(test.info().outputPath('stickers.json'), JSON.stringify(evidence, null, 2) + '\n')
})

async function openConversation(page: Page) {
  await page.setViewportSize({ width: 1100, height: 720 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as StickerWindow).regression.connection('online'))
}

test('a sticker from Yuki shows as a sticker, and an ordinary picture as an attachment', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await openConversation(page)
  await page.evaluate(() => {
    const created = window as unknown as { created: string[] }
    created.created = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (this: Element, keyframes, options) {
      if (this.closest('[data-sticker]')) created.created.push('sticker')
      return animate.call(this, keyframes, options)
    }
    ;(window as unknown as StickerWindow).regression.receiveGlassPicture('[表情: 开心]', true)
  })
  const sticker = page.getByRole('img', { name: '表情：开心', exact: true })
  // 3: the sticker is named by its tags.
  await expect(sticker).toBeVisible()
  const row = page.locator('article').filter({ has: sticker })
  // 1: no glass bubble, no attachment card and no "[表情: …]" text.
  await expect(row.locator('[data-glass="bubble"]')).toHaveCount(0)
  await expect(row.getByText('[表情: 开心]')).toHaveCount(0)
  // The picture has loaded before its shape is read.
  await expect
    .poll(() => sticker.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
  const look = await sticker.evaluate((image: HTMLImageElement) => {
    const frame = image.closest('button')!
    const style = getComputedStyle(frame)
    return {
      width: image.getBoundingClientRect().width,
      height: image.getBoundingClientRect().height,
      natural: image.naturalWidth / image.naturalHeight,
      border: style.borderTopWidth,
      background: style.backgroundColor,
    }
  })
  evidence.sticker = look
  expect(look.border).toBe('0px')
  expect(look.background).toBe('rgba(0, 0, 0, 0)')
  // 2: at a sticker's size, its own proportions kept.
  expect(Math.max(look.width, look.height)).toBeLessThanOrEqual(140)
  expect(look.width / look.height).toBeCloseTo(look.natural, 1)
  // 4: it arrives on the bubbles' spring.
  expect(
    await page.evaluate(() => (window as unknown as { created: string[] }).created.length),
  ).toBeGreaterThan(0)
  await page.screenshot({ path: test.info().outputPath('sticker.png') })

  // 5: an ordinary picture keeps its attachment card in a bubble.
  await page.evaluate(() =>
    (window as unknown as StickerWindow).regression.receiveGlassPicture('一張照片', false),
  )
  const picture = page.locator('article').filter({ hasText: '一張照片' })
  await expect(picture.locator('[data-glass="bubble"]')).toHaveCount(1)
  await expect(picture.locator('[data-sticker]')).toHaveCount(0)
})

test('with reduced motion a sticker simply appears', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openConversation(page)
  await page.evaluate(() =>
    (window as unknown as StickerWindow).regression.receiveGlassPicture('[表情: 开心]', true),
  )
  const sticker = page.getByRole('img', { name: '表情：开心', exact: true })
  await expect(sticker).toBeVisible()
  // 4
  expect(
    await page
      .locator('[data-sticker]')
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0)
})
