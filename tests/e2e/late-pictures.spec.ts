import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// A picture or sticker that arrives while the person is at the end loads after the list has
// already glided there: the list follows it on the same spring rather than jumping, and a sticker
// keeps its place until it shows. Failure cases:
// 1. a picture or sticker finishing after the glide moves the list in one frame (it jumped 126px
//    and 160px in one frame);
// 2. a sticker's row shrinks before its picture shows (the waiting square went, leaving 25px);
// 3. a person who has scrolled up is pulled down when a picture below finishes;
// 4. a window resize glides instead of keeping the end at once.
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('late-pictures.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

type PictureWindow = Window & {
  regression: {
    connection(state: 'online'): void
    receiveGlassPicture(content: string, sticker: boolean): void
  }
  recorded: { top: number; gap: number; row: number }[]
}

async function open(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  // The pictures come slowly, as over a network: long after the list has glided to the end.
  await page.route(/(sticker|picture)\.svg/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await route.continue()
  })
  await page.setViewportSize({ width: 1100, height: 560 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as PictureWindow).regression.connection('online'))
  await page.waitForTimeout(800)
}

// Every frame while a picture arrives and loads: where the list stands, how far from its end,
// and how tall the newest row is.
async function receive(page: Page, content: string, sticker: boolean) {
  await page.evaluate(
    ([content, sticker]) => {
      const state = window as unknown as PictureWindow
      state.recorded = []
      const log = document.querySelector<HTMLElement>('[role="log"]')!
      const start = performance.now()
      const record = () => {
        const row = [...log.querySelectorAll<HTMLElement>('article')].at(-1)!
        state.recorded.push({
          top: log.scrollTop,
          gap: log.scrollHeight - log.scrollTop - log.clientHeight,
          row: row.getBoundingClientRect().height,
        })
        if (performance.now() - start < 2200) requestAnimationFrame(record)
      }
      requestAnimationFrame(record)
      state.regression.receiveGlassPicture(content, sticker)
    },
    [content, sticker] as const,
  )
  await page.waitForTimeout(2400)
  return page.evaluate(() => (window as unknown as PictureWindow).recorded)
}

const largestStep = (frames: { top: number }[]) =>
  Math.max(...frames.slice(1).map((frame, index) => Math.abs(frame.top - frames[index]!.top)))

test('a picture or sticker loading after the glide is followed on the spring, not jumped to', async ({
  page,
}) => {
  await open(page)
  for (const [content, sticker] of [
    ['[表情: 开心]', true],
    ['一張照片', false],
  ] as const) {
    const frames = await receive(page, content, sticker)
    const moved = frames.at(-1)!.top - frames[0]!.top
    evidence[content] = { moved, largestStep: largestStep(frames), frames }
    // It ends at the end.
    expect(frames.at(-1)!.gap, content).toBeLessThanOrEqual(1)
    expect(moved, content).toBeGreaterThan(100)
    // 1: no frame carries the list most of the way at once.
    expect(largestStep(frames), content).toBeLessThan(moved / 3)
    // 2: a sticker's row never shrinks on its way to showing.
    if (sticker) {
      const rows = frames.map((frame) => frame.row)
      const shrinks = rows.filter((row, index) => index > 0 && row < rows[index - 1]! - 1)
      expect(shrinks, 'sticker row').toEqual([])
    }
  }
})

test('a picture loading below a person who has scrolled up leaves them where they are', async ({
  page,
}) => {
  await open(page)
  const log = page.getByRole('log', { name: '對話訊息' })
  await receive(page, '先來一張照片', false)
  await log.hover()
  await page.mouse.wheel(0, -200)
  await page.waitForTimeout(400)
  const frames = await receive(page, '再來一張照片', false)
  evidence.scrolledUp = frames
  // 3
  expect(new Set(frames.map((frame) => Math.round(frame.top))).size).toBe(1)
})

test('a window resize keeps the end at once', async ({ page }) => {
  await open(page)
  await receive(page, '一張照片', false)
  const log = page.getByRole('log', { name: '對話訊息' })
  await page.setViewportSize({ width: 1100, height: 440 })
  // 4: in the frame after the resize the end is already in view.
  const gap = await log.evaluate(
    (log) =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(log.scrollHeight - log.scrollTop - log.clientHeight)),
        ),
      ),
  )
  evidence.resize = gap
  expect(gap).toBeLessThanOrEqual(1)
})
