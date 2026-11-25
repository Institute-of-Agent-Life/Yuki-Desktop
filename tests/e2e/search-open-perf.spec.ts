import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { contentSize } from '../fixtures/visual'

/*
 * Opening the search panel (the toolbar's magnifier) over a long conversation stuttered: it felt as
 * if it loaded too much at once. In the real app, with hundreds of loaded messages and several
 * works, the panel is opened six times; the first opening also makes the glass's maps once for
 * the session (glass-material.spec.ts holds that to its own 100ms), so the cost of an opening is
 * read from the five after it.
 *
 * Fails when, at any of the five:
 *   1. a task blocks the page for more than 100ms (glass-material's frame budget for a long task);
 *   2. the opening runs more than two frames of script (33ms): work beyond the panel's own, such
 *      as rendering each loaded message of the conversation behind it again;
 * or when
 *   3. the panel's first frame comes more than 100ms after the click, at the median;
 *   4. the panel does not list every loaded message and work (what it searches is all that is
 *      loaded, none left out to make it quicker).
 * Every opening's measurements are written to search-open-perf.json.
 */
const messages = 400,
  works = 8

interface Opening {
  firstFrame: number
  longTasks: number[]
  frames: { duration: number; blocking: number }[]
  script: number
  style: number
  layout: number
  options: number
}

async function metrics(cdp: CDPSession) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const value = (name: string) => metrics.find((metric) => metric.name === name)!.value * 1000
  return {
    script: value('ScriptDuration'),
    style: value('RecalcStyleDuration'),
    layout: value('LayoutDuration'),
  }
}

async function open(page: Page, cdp: CDPSession): Promise<Opening> {
  const dialog = page.getByRole('dialog', { name: '指令面板', exact: true })
  await page.evaluate(() => {
    type Probe = { start: number; end: number; long: number[]; frames: unknown[] }
    const probe: Probe = { start: 0, end: 0, long: [], frames: [] }
    ;(window as unknown as { probe: Probe }).probe = probe
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.long.push(entry.duration)
    }).observe({ type: 'longtask' })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        probe.frames.push({
          duration: entry.duration,
          blocking: (entry as PerformanceEntry & { blockingDuration: number }).blockingDuration,
        })
    }).observe({ type: 'long-animation-frame' })
    addEventListener('pointerdown', (event) => (probe.start = event.timeStamp), {
      once: true,
      capture: true,
    })
    // The panel's first frame: the first animation frame once it is in the document, and the
    // rendering that follows it in that frame (a message posted from it runs after).
    const watch = new MutationObserver(() => {
      if (!document.querySelector('dialog[open]')) return
      watch.disconnect()
      requestAnimationFrame(() => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => (probe.end = performance.now())
        channel.port2.postMessage(null)
      })
    })
    watch.observe(document.body, { subtree: true, childList: true, attributes: true })
  })
  const before = await metrics(cdp)
  await page.getByRole('button', { name: '搜尋已載入內容', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { probe: { end: number } }).probe.end))
    .toBeGreaterThan(0)
  const after = await metrics(cdp)
  // What follows the first frame while the panel settles (its glass, its emerging) is counted
  // for long tasks too.
  await page.waitForTimeout(1000)
  const probe = await page.evaluate(() => {
    const { start, end, long, frames } = (
      window as unknown as {
        probe: {
          start: number
          end: number
          long: number[]
          frames: { duration: number; blocking: number }[]
        }
      }
    ).probe
    return { firstFrame: end - start, long, frames }
  })
  const options = await dialog.getByRole('option').count()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.waitForTimeout(800)
  return {
    firstFrame: probe.firstFrame,
    longTasks: probe.long,
    frames: probe.frames,
    script: after.script - before.script,
    style: after.style - before.style,
    layout: after.layout - before.layout,
    options,
  }
}

test('opening the search panel over hundreds of loaded messages stays within the frame budget', async () => {
  test.setTimeout(300000)
  await mkdir(test.info().outputPath(), { recursive: true })
  const rig = await yukiFixture({ character: true }),
    app = await rig.launch('search-open-perf')
  let success = false
  const evidence: Record<string, unknown> = { messages, works }
  try {
    const page = await app.firstWindow()
    await contentSize(app, page, 1100, 760)
    await pairUI(page, rig.base, await rig.code())
    const post = (path: string) => fetch(`${rig.base}${path}`, { method: 'POST' })
    await post(`/__test/history?count=${messages}`)
    for (let i = 0; i < works; i++) await post('/__test/work')
    const log = page.locator('[role="log"]').first()
    await expect(page.getByText(`歷史訊息 ${messages}`, { exact: true })).toBeVisible({
      timeout: 30000,
    })
    // Every page of the history loaded, as a person scrolling back through it would.
    await expect
      .poll(
        async () => {
          await log.evaluate((element) => (element.scrollTop = 0))
          return page.getByText('歷史訊息 1', { exact: true }).count()
        },
        { timeout: 60000, intervals: [700] },
      )
      .toBe(1)
    await log.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await page.waitForTimeout(1500)
    evidence.loaded = await page.evaluate(() => ({
      messages: document.querySelectorAll('[role="log"] article').length,
      elements: document.querySelectorAll('*').length,
    }))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const first = await open(page, cdp)
    const openings: Opening[] = []
    for (let i = 0; i < 5; i++) openings.push(await open(page, cdp))
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[2]!
    const summary = {
      firstFrame: {
        median: median(openings.map((item) => item.firstFrame)),
        worst: Math.max(...openings.map((item) => item.firstFrame)),
      },
      longestTask: Math.max(0, ...openings.flatMap((item) => item.longTasks)),
      script: {
        median: median(openings.map((item) => item.script)),
        worst: Math.max(...openings.map((item) => item.script)),
      },
      style: { median: median(openings.map((item) => item.style)) },
    }
    Object.assign(evidence, { first, openings, summary })
    // 4
    for (const opening of [first, ...openings])
      expect(opening.options).toBeGreaterThanOrEqual(messages + works)
    for (const [index, opening] of openings.entries()) {
      // 1
      expect(
        opening.longTasks.filter((duration) => duration > 100),
        `opening ${index + 2}`,
      ).toEqual([])
      // 2
      expect(opening.script, `opening ${index + 2}: script`).toBeLessThanOrEqual(33)
    }
    // 3
    expect(summary.firstFrame.median).toBeLessThanOrEqual(100)
    success = true
  } finally {
    await writeFile(
      test.info().outputPath('search-open-perf.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    await app.close()
    await rig.close(success)
  }
})
