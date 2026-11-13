import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// 液态玻璃组件统一任务书 (2026-11-12), failure cases 20–22: a long conversation stays as quick to
// type in, point at and scroll as a short one.
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('long-conversation.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

async function open(page: Page, messages: number) {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto(
    `http://127.0.0.1:4178/renderer-regressions.html?case=conversation-scroll&messages=${messages}`,
  )
  await expect(page.locator('article')).toHaveCount(messages)
  await page.waitForTimeout(1000)
}

async function typing(page: Page) {
  const composer = page.getByRole('textbox', { name: /說點什麼/ })
  await composer.click()
  await page.evaluate(() => {
    const state = window as unknown as { long: number[] }
    state.long = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.long.push(Math.round(entry.duration))
    }).observe({ type: 'longtask' })
  })
  const start = Date.now()
  await composer.pressSequentially('長對話裡打字不該比短對話慢：一二三四五六七八九十', {
    delay: 30,
  })
  return {
    elapsed: Date.now() - start,
    long: await page.evaluate(() => (window as unknown as { long: number[] }).long),
  }
}

test('typing in a long conversation is as quick as in a short one', async ({ page }) => {
  await open(page, 25)
  const short = await typing(page)
  await open(page, 300)
  const long = await typing(page)
  evidence.typing = { short, long }
  // 20
  expect(long.long.filter((duration) => duration > 50)).toEqual([])
  expect(long.elapsed).toBeLessThanOrEqual(short.elapsed * 1.3)
})

test('pointing and scrolling cost the same however long the conversation is', async ({ page }) => {
  test.setTimeout(120000)
  // The style work of one pointer move, on this machine.
  const pointing = async (messages: number) => {
    await open(page, messages)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const recalc = async () =>
      (await cdp.send('Performance.getMetrics')).metrics.find(
        (metric) => metric.name === 'RecalcStyleDuration',
      )!.value
    const before = await recalc()
    for (let step = 0; step < 60; step++)
      await page.mouse.move(400 + (step % 30) * 15, 300 + (step % 7) * 20)
    return ((await recalc()) - before) * (1000 / 60)
  }
  const short = await pointing(25)
  const perMove = await pointing(300)
  // The main thread's work while scrolling from the end up, per step: what the page does, not the
  // pace at which this machine draws frames. Each length is measured twice, in turn, so neither
  // is the one measured cold.
  const scrolling = async (messages: number) => {
    await open(page, messages)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const busy = async () =>
      (await cdp.send('Performance.getMetrics')).metrics.find(
        (metric) => metric.name === 'TaskDuration',
      )!.value
    const log = page.getByRole('log', { name: '對話訊息' })
    await log.evaluate(async (log) => {
      log.scrollTop = log.scrollHeight
      await new Promise((resolve) => setTimeout(resolve, 200))
    })
    const before = await busy()
    await log.evaluate(async (log) => {
      for (let step = 0; step < 120; step++) {
        log.scrollTop = Math.max(0, log.scrollTop - 40)
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
    })
    return ((await busy()) - before) * (1000 / 120)
  }
  const shorter = [await scrolling(120)]
  const long = [await scrolling(300)]
  shorter.push(await scrolling(120))
  long.push(await scrolling(300))
  evidence.pointing = { short, perMove, scrolling: { 120: shorter, 300: long } }
  // 21: what a pointer move costs does not grow with the conversation (it was four times as much
  // at 300 messages as at 25), on any machine.
  expect(perMove).toBeLessThanOrEqual(Math.max(short * 1.5, 0.5))
  // 22: scrolling costs no more as the conversation grows, on any machine. (That the conversation
  // itself carries no glass, which made each visible bubble a lens, is checked where bubbles are:
  // conversation-glass, glass-floating.)
  expect(Math.min(...long)).toBeLessThanOrEqual(Math.min(...shorter) * 1.5 + 0.5)
})
