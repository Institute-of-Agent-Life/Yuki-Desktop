import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// A screen recording (2026-11-13) showed the conversation jumping on its own. Failure cases:
// 1. a sync hint (as after the stream reconnects) reloads every picture: each shows as its file
//    card, then as a picture again, and the rows move;
// 2. a picture scrolled far out of view and back shows as its file card again and is read again;
// 3. at the end, something above the view getting shorter (the list's end held where it is) makes
//    the rows in view jump and slide back;
// 4. reading in the middle, something above the view growing (a picture loading) pushes the rows
//    in view away.
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('steady-pictures.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

type SteadyWindow = Window & {
  regression: {
    connection(state: 'online'): void
    receiveGlassPicture(content: string, sticker: boolean): void
    receiveGlassReply(text: string): void
    previewOpens(): number
    hint(kind: string): void
  }
  watched: { cards: number; src: string[]; image: number[]; tops: number[][] }
}

async function open(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1100, height: 560 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const regression = (window as unknown as SteadyWindow).regression
    regression.connection('online')
    regression.receiveGlassPicture('一張照片', false)
  })
  const picture = page.locator('article').filter({ hasText: '一張照片' }).locator('img')
  await expect
    .poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
  await page.waitForTimeout(800)
  return picture
}

// Every frame for `duration`: the picture's element and address, whether any file card shows,
// and where the rows in view stand on screen.
async function watch(page: Page, duration: number, act: () => Promise<void>) {
  await page.evaluate((duration) => {
    const state = window as unknown as SteadyWindow
    const ids = new WeakMap<Element, number>()
    let next = 0
    state.watched = { cards: 0, src: [], image: [], tops: [] }
    const start = performance.now()
    const record = () => {
      const log = document.querySelector<HTMLElement>('[role="log"]')!
      const image = [...log.querySelectorAll('article')]
        .find((row) => row.textContent?.includes('一張照片'))
        ?.querySelector('img')
      if (image && !ids.has(image)) ids.set(image, ++next)
      state.watched.image.push(image ? ids.get(image)! : 0)
      state.watched.src.push(image?.getAttribute('src') ?? '')
      if (log.querySelector('article [class*="file"]')) state.watched.cards++
      const view = log.getBoundingClientRect()
      state.watched.tops.push(
        [...log.querySelectorAll('article')]
          .map((row) => row.getBoundingClientRect())
          .filter((rect) => rect.bottom > view.top && rect.top < view.bottom)
          .map((rect) => Math.round(rect.top)),
      )
      if (performance.now() - start < duration) requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  }, duration)
  await act()
  await page.waitForTimeout(duration + 200)
  return page.evaluate(() => (window as unknown as SteadyWindow).watched)
}

// Rows in view that moved on screen from one frame to the next.
const moves = (tops: number[][]) =>
  tops
    .slice(1)
    .map((now, index) => {
      const before = tops[index]!
      return now.length === before.length
        ? Math.max(0, ...now.map((top, row) => Math.abs(top - before[row]!)))
        : 0
    })
    .filter((distance) => distance > 1)

test('a sync hint leaves the pictures as they are', async ({ page }) => {
  await open(page)
  const opens = await page.evaluate(() =>
    (window as unknown as SteadyWindow).regression.previewOpens(),
  )
  const seen = await watch(page, 1200, () =>
    page.evaluate(() => (window as unknown as SteadyWindow).regression.hint('sync')),
  )
  evidence.sync = { cards: seen.cards, src: [...new Set(seen.src)], moves: moves(seen.tops) }
  // 1
  expect(seen.cards).toBe(0)
  expect(new Set(seen.image).size).toBe(1)
  expect(new Set(seen.src).size).toBe(1)
  expect(moves(seen.tops)).toEqual([])
  evidence.syncOpens =
    (await page.evaluate(() => (window as unknown as SteadyWindow).regression.previewOpens())) -
    opens
})

test('a picture scrolled out of view and back is shown as it was', async ({ page }) => {
  await open(page)
  const row = page.locator('article').filter({ hasText: '一張照片' })
  for (let index = 0; index < 16; index++)
    await page.evaluate(
      (index) =>
        (window as unknown as SteadyWindow).regression.receiveGlassReply(`再一則 ${index}`),
      index,
    )
  await page.waitForTimeout(800)
  // The replies have carried the picture far above the view.
  await expect
    .poll(() =>
      row.evaluate((row) => {
        const log = row.closest('[role="log"]')!.getBoundingClientRect()
        return log.top - row.getBoundingClientRect().bottom
      }),
    )
    .toBeGreaterThan(400)
  const opens = await page.evaluate(() =>
    (window as unknown as SteadyWindow).regression.previewOpens(),
  )
  const seen = await watch(page, 1200, () =>
    row.evaluate((row) => row.scrollIntoView({ block: 'center' })),
  )
  await expect(row).toBeInViewport()
  evidence.scrolledBack = {
    cards: seen.cards,
    src: [...new Set(seen.src)],
    opens:
      (await page.evaluate(() => (window as unknown as SteadyWindow).regression.previewOpens())) -
      opens,
  }
  // 2
  expect(seen.cards).toBe(0)
  expect(new Set(seen.image.filter(Boolean)).size).toBe(1)
  expect(evidence.scrolledBack).toMatchObject({ opens: 0 })
})

test('something above the view changing size leaves the rows in view where they are', async ({
  page,
}) => {
  await open(page)
  for (let index = 0; index < 8; index++)
    await page.evaluate(
      (index) =>
        (window as unknown as SteadyWindow).regression.receiveGlassReply(`再一則 ${index}`),
      index,
    )
  await page.waitForTimeout(1200)
  // The first row grows and settles, out of view.
  const first = page.locator('article').first()
  await first.evaluate((row) => {
    // As a picture loading inside it: the row's own content grows.
    const spacer = row.querySelector<HTMLElement>('[data-spacer]') ?? document.createElement('div')
    spacer.dataset.spacer = ''
    spacer.style.height = '240px'
    row.querySelector('[class*="messageBody"]')!.append(spacer)
  })
  await page.waitForTimeout(1200)
  // 3: at the end, it gets shorter again.
  // In the app such a change comes with a render (a picture reloading); selecting a message in
  // view is one that moves nothing.
  const shrinking = await watch(page, 900, async () => {
    await first.evaluate((row) =>
      row.querySelector<HTMLElement>('[data-spacer]')!.style.setProperty('height', '0'),
    )
    await page.locator('article').last().click()
  })
  evidence.shrinkAtEnd = moves(shrinking.tops)
  expect(moves(shrinking.tops)).toEqual([])
  // 4: reading in the middle, it grows.
  const log = page.getByRole('log', { name: '對話訊息' })
  await log.hover()
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(600)
  await expect(first).not.toBeInViewport()
  const growing = await watch(page, 900, async () => {
    await first.evaluate((row) =>
      row.querySelector<HTMLElement>('[data-spacer]')!.style.setProperty('height', '240px'),
    )
  })
  evidence.growWhileReading = moves(growing.tops)
  expect(moves(growing.tops)).toEqual([])
})

// A slow machine can deliver a picture's crossings together: out of view as it mounted, then in
// view once scrolled to. Failure case: only the first entry was read, so the picture stayed a file
// card for good (seen on a Windows CI runner).
test('a picture loads when the observer reports its crossings together', async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.IntersectionObserver
    window.IntersectionObserver = class {
      private queue: IntersectionObserverEntry[] = []
      private timer?: ReturnType<typeof setTimeout>
      private readonly native: IntersectionObserver
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.native = new Native((entries) => {
          this.queue.push(...entries)
          clearTimeout(this.timer)
          this.timer = setTimeout(() => {
            const batch = this.queue
            this.queue = []
            callback(batch, this as unknown as IntersectionObserver)
          }, 400)
        }, options)
      }
      observe(target: Element) {
        this.native.observe(target)
      }
      unobserve(target: Element) {
        this.native.unobserve(target)
      }
      disconnect() {
        clearTimeout(this.timer)
        this.native.disconnect()
      }
      takeRecords() {
        return this.native.takeRecords()
      }
    } as unknown as typeof IntersectionObserver
  })
  await page.setViewportSize({ width: 1100, height: 560 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const regression = (window as unknown as SteadyWindow).regression
    regression.connection('online')
    for (let index = 0; index < 12; index++) regression.receiveGlassReply(`再一則 ${index}`)
  })
  await page.waitForTimeout(800)
  const log = page.locator('[role="log"]')
  // Reading from the top, so the picture arrives far below the view.
  await log.evaluate((log) => (log.scrollTop = 0))
  await page.waitForTimeout(300)
  await page.evaluate(() =>
    (window as unknown as SteadyWindow).regression.receiveGlassPicture('一張照片', false),
  )
  await page.waitForTimeout(50)
  await log.evaluate((log) => (log.scrollTop = log.scrollHeight))
  const picture = page.locator('article').filter({ hasText: '一張照片' })
  await expect(picture).toBeInViewport()
  await expect.poll(() => picture.locator('img').count(), { timeout: 3000 }).toBe(1)
  await expect
    .poll(() => picture.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
})
