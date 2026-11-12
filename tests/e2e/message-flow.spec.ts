import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

type FlowWindow = Window & {
  regression: {
    connection(state: 'online'): void
    confirmGlassSend(): void
    receiveGlassReply(text: string): void
  }
  flow: { frames: Frame[]; stop(): void }
}
interface Frame {
  t: number
  scroll: number
  end: number
  earlier: number
  noteTop: number | null
  noteHeight: number | null
}

async function openConversation(page: Page) {
  // A short window, so the conversation scrolls and every arrival has to move it.
  await page.setViewportSize({ width: 1100, height: 560 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as FlowWindow).regression.connection('online'))
  const log = page.getByRole('log', { name: '對話訊息' })
  await expect
    .poll(() => log.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThan(2)
  return log
}

// Records what a person sees every frame, in real time, until stopped.
const record = (page: Page) =>
  page.evaluate(() => {
    const log = document.querySelector<HTMLElement>('[role="log"]')!
    const earlier = log.querySelector<HTMLElement>('article[data-event-id="34"]')!
    const frames: Frame[] = []
    let live = true
    const start = performance.now()
    const tick = () => {
      const note = log.querySelector<HTMLElement>(':scope > [role="status"]')
      frames.push({
        t: performance.now() - start,
        scroll: log.scrollTop,
        end: log.scrollHeight - log.clientHeight,
        earlier: earlier.getBoundingClientRect().top,
        noteTop: note ? note.getBoundingClientRect().top : null,
        noteHeight: note ? note.getBoundingClientRect().height : null,
      })
      if (live) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    ;(window as unknown as FlowWindow).flow = { frames, stop: () => (live = false) }
  })
const stop = (page: Page) =>
  page.evaluate(() => {
    const flow = (window as unknown as FlowWindow).flow
    flow.stop()
    return flow.frames
  })
const steps = (values: number[]) =>
  values.slice(1).map((value, index) => Math.abs(value - values[index]!))

test('a message and its reply move the conversation on one spring, without a single jump', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const log = await openConversation(page)
  const draft = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
  await draft.fill('請把下次訪談要追問的問題加進摘要。')
  await record(page)
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await page.waitForTimeout(400)
  await page.evaluate(() => (window as unknown as FlowWindow).regression.confirmGlassSend())
  const note = page.locator('[role="log"] > [role="status"]')
  await expect(note).toBeVisible()
  // 4: the processing note grows in like a reply.
  expect(await note.evaluate((row) => row.getAnimations({ subtree: true }).length)).toBeGreaterThan(
    0,
  )
  await page.waitForTimeout(900)
  await page.evaluate(() =>
    (window as unknown as FlowWindow).regression.receiveGlassReply(
      '已把問題放在摘要最後，並附上原始訪談的來源。',
    ),
  )
  // 7: the request's new state arrives as a new label.
  const label = page
    .locator('article[data-message-request]')
    .getByText('已取得原回執', { exact: true })
  await expect(label).toBeVisible()
  expect(await label.evaluate((node) => node.getAnimations().length)).toBeGreaterThan(0)
  await expect(note).toHaveCount(0)
  await page.waitForTimeout(900)
  const frames = await stop(page)
  const scrolls = frames.map((frame) => frame.scroll)
  const total = Math.max(...scrolls) - Math.min(...scrolls)
  // 1: the list never jumps, from send to reply.
  expect(total).toBeGreaterThan(40)
  expect(Math.max(...steps(scrolls))).toBeLessThanOrEqual(Math.min(40, total * 0.4))
  // 2: earlier messages glide too.
  expect(Math.max(...steps(frames.map((frame) => frame.earlier)))).toBeLessThanOrEqual(40)
  // 4 and 5: the note moves only smoothly, whether growing in or pushed by the reply.
  const noted = frames.filter((frame) => frame.noteTop !== null)
  expect(Math.max(...steps(noted.map((frame) => frame.noteTop!)))).toBeLessThanOrEqual(40)
  // 6: it folds away over several frames before it leaves.
  const folding = steps(noted.map((frame) => frame.noteHeight!)).filter((step) => step > 0.5)
  expect(folding.length).toBeGreaterThanOrEqual(5)
  // 3: the sent bubble ends where it rests, at the end of the list.
  const last = frames.at(-1)!
  expect(Math.abs(last.end - last.scroll)).toBeLessThan(2)
  expect(
    await page
      .locator('article[data-message-request] [data-glass="bubble"]')
      .evaluate((surface) => getComputedStyle(surface.parentElement!).transform),
  ).toBe('none')
  await writeFile(
    test.info().outputPath('message-flow.json'),
    JSON.stringify({ total, frames }, null, 2) + '\n',
  )
  await log.evaluate(() => {})
})

test('the person scrolling during a glide takes the list back at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const log = await openConversation(page)
  await page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true }).fill('滾動中途接手')
  await page.getByRole('button', { name: '送出', exact: true }).click()
  const box = (await log.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -300)
  await page.waitForTimeout(1200)
  // 8: the glide stopped, the list stays where the person took it, and it is no longer "at the end".
  expect(
    await log.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
  ).toBeGreaterThan(64)
  await page.evaluate(() => (window as unknown as FlowWindow).regression.confirmGlassSend())
  await expect(page.getByRole('button', { name: /新訊息/ })).toBeVisible()
})

test('with reduced motion the list reaches the end at once and nothing glides', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const log = await openConversation(page)
  await page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true }).fill('立即到底')
  await record(page)
  await page.getByRole('button', { name: '送出', exact: true }).click()
  await page.evaluate(() => (window as unknown as FlowWindow).regression.confirmGlassSend())
  await page.waitForTimeout(600)
  const frames = await stop(page)
  // 9: one move to the end, no frames in between.
  const moves = steps(frames.map((frame) => frame.scroll)).filter((step) => step > 0.5)
  expect(moves.length).toBeLessThanOrEqual(2)
  expect(
    await log.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
  ).toBeLessThan(2)
  expect(await page.locator('[role="log"] [data-liquid]').count()).toBe(0)
})

test('a scroll made by anything else, like a jump to a message, also stops a glide', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const log = await openConversation(page)
  await page
    .getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
    .fill('程式捲動中途接手')
  await page.getByRole('button', { name: '送出', exact: true }).click()
  // 8: a programmatic scroll during the glide, as a jump to an earlier message makes. The draft
  // rising in the list means its glide has begun; a scroll before that is overtaken by the send.
  await expect(page.locator('[role="log"] [data-liquid]')).not.toHaveCount(0)
  await log.evaluate((node) => (node.scrollTop = 0))
  await page.waitForTimeout(1200)
  expect(await log.evaluate((node) => node.scrollTop)).toBeLessThan(2)
  await page.evaluate(() => (window as unknown as FlowWindow).regression.confirmGlassSend())
  await expect(page.getByRole('button', { name: /新訊息/ })).toBeVisible()
})

test('a glide yields to any other scroll even on a list the app has not placed before', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('http://127.0.0.1:4178/components.html')
  // 8, on a fresh list: the glide owns the place it starts from, so a scroll before its first frame
  // is someone else's.
  const top = await page.evaluate(async (module) => {
    const { glide } = (await import(/* @vite-ignore */ module)) as {
      glide(list: HTMLElement, top: number | 'end'): void
    }
    const list = document.createElement('div')
    list.style.cssText = 'position:fixed;inset:0 auto auto 0;width:200px;height:200px;overflow:auto'
    list.innerHTML = '<div style="height:2000px"></div>'
    document.body.append(list)
    list.scrollTop = 500
    glide(list, 'end')
    list.scrollTop = 0
    await new Promise((resolve) => setTimeout(resolve, 800))
    return list.scrollTop
  }, `/@fs${process.cwd()}/src/renderer/motion/glide.ts`)
  expect(top).toBeLessThan(2)
})
