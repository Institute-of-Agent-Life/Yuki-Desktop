import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { frost } from '../fixtures/frost'

/*
 * The conversation's bubbles are frosted (a blur behind a translucent tint), but what lies behind
 * them is only the conversation's backdrop, which does not move: it is blurred once, and each
 * bubble shows that one blurred copy through its own shape, lined up with the backdrop at every
 * scroll position and scale. No bubble has a backdrop filter of its own, so a frame costs as many
 * blurs however many bubbles are shown (glass-material and long-conversation measure the cost).
 * Over a picture of one's own the copy is made by the app (materials/backdrop.ts): apple-style
 * measures it in the real app.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('frosted-bubbles.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

async function open(page: Page) {
  await page.setViewportSize({ width: 1200, height: 640 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  // Enough to scroll: the conversation's own messages, repeated.
  await page
    .locator('[role="log"]')
    .first()
    .evaluate((log) => {
      const rows = [...log.children]
      for (let copy = 0; copy < 4; copy++) for (const row of rows) log.append(row.cloneNode(true))
      log.scrollTop = log.scrollHeight
    })
  await page.waitForTimeout(300)
}

for (const scale of [1, 2])
  test(`at ${scale}x, every bubble shows one blurred copy of the backdrop, lined up as it scrolls`, async ({
    browser,
  }) => {
    test.setTimeout(240000)
    const page = await browser.newPage({ deviceScaleFactor: scale })
    await open(page)
    const log = page.locator('[role="log"]').first()
    await page.mouse.move(600, 300)
    for (const theme of ['light', 'dark'] as const)
      for (const backdrop of ['plain', 'lens', 'aurora', 'sunset', 'grid']) {
        await page.evaluate(
          ([theme, backdrop]) => {
            document.documentElement.dataset.theme = theme
            document.documentElement.dataset.backdrop = backdrop
          },
          [theme, backdrop],
        )
        await log.evaluate((log) => (log.scrollTop = log.scrollHeight))
        const filters = await page
          .locator('[data-surface]')
          .evaluateAll((surfaces) => [
            ...new Set(surfaces.map((surface) => getComputedStyle(surface).backdropFilter)),
          ])
        expect
          .soft(filters, `${theme} ${backdrop}: no backdrop filter of a bubble's own`)
          .toEqual(['none'])
        // At the end; by half a device pixel; by the wheel (scrolled on the compositor); by a
        // screen.
        const moves: [string, () => Promise<unknown>][] = [
          ['end', async () => {}],
          ['half a pixel', () => log.evaluate((log, by) => (log.scrollTop -= by), 0.5 / scale)],
          ['wheel', () => page.mouse.wheel(0, -137)],
          ['a screen', () => log.evaluate((log) => (log.scrollTop -= 413))],
        ]
        for (const [where, move] of moves) {
          await move()
          const result = await frost(page, backdrop === 'plain' ? 0 : 2)
          evidence[`${scale}x ${theme} ${backdrop} ${where}`] = result
          const name = `${scale}x ${theme} ${backdrop} ${where}`
          expect.soft(result.bubbles, `${name}: bubbles measured`).toBeGreaterThan(0)
          expect.soft(result.mean, `${name}: mean`).toBeLessThanOrEqual(1.5)
          expect.soft(result.p99, `${name}: 99th percentile`).toBeLessThanOrEqual(5)
        }
      }
    await page.close()
  })
