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
