import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

interface GlassFixture {
  connection(state: 'online'): void
  confirmGlassSend(): void
  receiveGlassReply(text: string): void
  snapshot(): { submissions: number }
}

interface GlassMotion {
  text: string
  paths: string[]
}

type GlassWindow = Window & {
  regression: GlassFixture
  glassMotion: GlassMotion[]
  // While armed, every animation that starts is held at its first frame for sampling.
  motionHold: { armed: boolean; held: Animation[] }
}

type Box = { left: number; right: number; top: number; bottom: number }
interface Frame {
  t: number
  glass: Box
  rest: number
  copy: Box
  ink: number
  copyClip: string
  edge: number
  rim: number
  scroll: number
  lift: string
  release: { opacity: number; top: number } | null
}

async function openConversation(page: Page) {
  await page.addInitScript(() => {
    const observed = new WeakSet<Animation>()
    const motion: GlassMotion[] = []
    const hold = { armed: false, held: [] as Animation[] }
    ;(window as unknown as GlassWindow).glassMotion = motion
    ;(window as unknown as GlassWindow).motionHold = hold
    const observe = () => {
      for (const animation of document.getAnimations()) {
        if (observed.has(animation)) continue
        observed.add(animation)
        if (hold.armed) {
          animation.pause()
          animation.currentTime = 0
          hold.held.push(animation)
        }
        const effect = animation.effect
        if (
          !(effect instanceof KeyframeEffect) ||
          effect.pseudoElement ||
          !effect.target?.matches('[data-glass="bubble"]')
        )
          continue
        motion.push({
          text: effect.target.parentElement?.textContent ?? '',
          paths: effect.getKeyframes().map((frame) => String(frame.clipPath ?? '')),
        })
      }
      requestAnimationFrame(observe)
    }
    requestAnimationFrame(observe)
  })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as GlassWindow).regression.connection('online'))
}

// Starts an entry with every animation held, then reads each frame of it in turn.
async function filmEntry(page: Page, row: string, start: () => Promise<void>) {
  await page.evaluate(() => {
    const hold = (window as unknown as GlassWindow).motionHold
    hold.armed = true
    hold.held = []
  })
  await start()
  const duration = await expect
    .poll(() =>
      page.evaluate((row) => {
        const surface = [...document.querySelectorAll(row)].at(-1)?.querySelector('[data-liquid]')
        const glass = (window as unknown as GlassWindow).motionHold.held.find(
          (animation) =>
            animation.effect instanceof KeyframeEffect &&
            !animation.effect.pseudoElement &&
            animation.effect.target === surface,
        )
        return Number(glass?.effect?.getTiming().duration ?? 0)
      }, row),
    )
    .toBeGreaterThan(0)
    .then(() =>
      page.evaluate(() => {
        const hold = (window as unknown as GlassWindow).motionHold
        hold.armed = false
        return Math.max(
          ...hold.held.map((animation) => Number(animation.effect!.getTiming().duration)),
        )
      }),
    )
  const frames: Frame[] = []
  const times = Array.from(
    { length: Math.floor((duration * 60) / 1000) },
    (_, i) => (i * 1000) / 60,
  )
  for (const t of [...times, duration - 0.5])
    frames.push(
      await page.evaluate(
        ({ row, t }) => {
          for (const animation of (window as unknown as GlassWindow).motionHold.held)
            animation.currentTime = Math.min(
              t,
              Number(animation.effect!.getTiming().duration) - 0.5,
            )
          const article = [...document.querySelectorAll(row)].at(-1)!
          const surface = article.querySelector<HTMLElement>('[data-glass="bubble"]')!
          const copy = article.querySelector<HTMLElement>('[data-bubble-copy]')!
          const edge = article.querySelector('[data-liquid-outline] path')!
          const box = surface.getBoundingClientRect()
          const numbers = (getComputedStyle(surface).clipPath.match(/-?\d+(?:\.\d+)?/g) ?? []).map(
            Number,
          )
          const xs = numbers.filter((_, index) => index % 2 === 0)
          const ys = numbers.filter((_, index) => index % 2 === 1)
          const copyBox = copy.getBoundingClientRect()
          const release = document.querySelector<HTMLElement>('[data-draft-release]')
          return {
            t,
            glass: {
              left: box.left + Math.min(...xs),
              right: box.left + Math.max(...xs),
              top: box.top + Math.min(...ys),
              bottom: box.top + Math.max(...ys),
            },
            rest: surface.parentElement!.getBoundingClientRect().bottom,
            copy: {
              left: copyBox.left,
              right: copyBox.right,
              top: copyBox.top,
              bottom: copyBox.bottom,
            },
            ink: Number(getComputedStyle(copy).opacity),
            copyClip: getComputedStyle(copy).clipPath,
            edge: Number(getComputedStyle(edge).opacity),
            rim: Number(getComputedStyle(surface, '::before').opacity),
            scroll: article.closest('[role="log"]')!.scrollHeight,
            lift: getComputedStyle(surface.parentElement!).boxShadow,
            release: release
              ? {
                  opacity: Number(getComputedStyle(release).opacity),
                  top: release.getBoundingClientRect().top,
                }
              : null,
          }
        },
        { row, t },
      ),
    )
  return frames
}

const steps = (series: number[]) => series.slice(1).map((value, index) => value - series[index]!)

// The first frame before the drop is 95% there where it slows below a tenth of its
// fastest step after having moved at speed, or -1 when it never stalls.
function stall(series: number[]) {
  const total = series.at(-1)! - series[0]!,
    deltas = steps(series).map(Math.abs),
    peak = Math.max(...deltas)
  let moving = false
  for (const [index, speed] of deltas.entries()) {
    if ((series[index + 1]! - series[0]!) / total >= 0.95) break
    if (speed >= 0.3 * peak) moving = true
    else if (moving && speed < 0.1 * peak) return index
  }
  return -1
}

function expectNaturalEntry(frames: Frame[], travel: number[]) {
  // 1: neither the travel nor the growth stops halfway.
  expect(stall(travel)).toBe(-1)
  expect(stall(frames.map((frame) => frame.glass.right - frame.glass.left))).toBe(-1)
  // 2: the tail is longest at full speed and gone at rest.
  const tails = frames.map((frame) => Math.max(0, frame.glass.bottom - frame.rest))
  const speeds = steps(travel).map(Math.abs)
  expect(
    Math.abs(tails.indexOf(Math.max(...tails)) - 1 - speeds.indexOf(Math.max(...speeds))),
  ).toBeLessThanOrEqual(3)
  expect(Math.max(...tails)).toBeGreaterThan(4)
  expect(tails.at(-1)!).toBeLessThan(0.5)
  for (const frame of frames) {
    // 5: the text is never masked.
    expect(frame.copyClip).toBe('none')
    // 6: visible text stays inside the glass.
    if (frame.ink > 0.05) {
      expect(frame.copy.left).toBeGreaterThanOrEqual(frame.glass.left - 1)
      expect(frame.copy.right).toBeLessThanOrEqual(frame.glass.right + 1)
      expect(frame.copy.top).toBeGreaterThanOrEqual(frame.glass.top - 1)
      expect(frame.copy.bottom).toBeLessThanOrEqual(frame.glass.bottom + 1)
    }
  }
  // 7: the drawn edge has handed over to the resting rim by the last frame.
  expect(frames.at(-1)!.edge).toBeLessThanOrEqual(0.05)
  expect(frames.at(-1)!.rim).toBeGreaterThanOrEqual(0.95)
  expect(frames.at(-1)!.ink).toBe(1)
  // 17: the drop gains its resting shadow only once it holds the resting shape.
  expect(frames[0]!.lift).toBe('none')
  expect(frames.at(-1)!.lift).not.toBe('none')
}

test('clear lenses bend the backdrop and a sent message rises from the composer as one drop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openConversation(page)
  const draft = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
  const send = page.getByRole('button', { name: '送出', exact: true })
  const text = '請把下次訪談要追問的問題加進摘要。'
  const reply = '已把問題放在摘要最後，並附上原始訪談的來源。'
  for (const eventId of [33, 34]) {
    const glass = page.locator(`article[data-event-id="${eventId}"] [data-glass="bubble"]`)
    await expect(glass).toHaveAttribute('data-refracting', 'true', { timeout: 2500 })
    await expect(glass).toHaveCSS('backdrop-filter', /url\(/)
  }
  // 16: the rim catches light from the upper left; the far edge keeps only a faint bounce.
  const rim = await page
    .locator('article[data-event-id="34"] [data-glass="bubble"]')
    .evaluate(async (surface) => {
      const style = getComputedStyle(surface)
      const image = new Image()
      image.src = style.getPropertyValue('--rim').match(/url\("?(.*?)"?\)$/)![1]!
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const scale = image.width / surface.getBoundingClientRect().width
      const inline = parseFloat(style.paddingInlineStart) * scale
      const bottom = image.height - parseFloat(style.paddingBottom) * scale
      const alpha = (x: number, y: number) =>
        Math.max(
          ...[-1, 0, 1].flatMap((dx) =>
            [-1, 0, 1].map(
              (dy) =>
                context.getImageData(Math.round(x + dx), Math.round(y + dy), 1, 1).data[3]! / 255,
            ),
          ),
        )
      return {
        top: alpha(image.width / 2, 1),
        bottom: alpha(image.width / 2, bottom - 2),
        left: alpha(inline + 1, bottom / 2),
        right: alpha(image.width - inline - 2, bottom / 2),
      }
    })
  expect(rim.bottom).toBeLessThan(rim.top * 0.4)
  expect(rim.right).toBeLessThan(rim.left * 0.6)
  expect(rim.right).toBeLessThan(0.2)
  // 17: resting bubbles are lifted off the backdrop by a shadow.
  await expect(
    page.locator('article[data-event-id="34"] [data-glass="bubble"]').locator('..'),
  ).not.toHaveCSS('box-shadow', 'none')
  await draft.fill(text)
  const box = (await send.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 50, box.y - 50)
  await page.mouse.up()
  await expect(draft).toHaveValue(text)
  expect(
    await page.evaluate(() => (window as unknown as GlassWindow).regression.snapshot().submissions),
  ).toBe(0)

  const motion = () => page.evaluate(() => (window as unknown as GlassWindow).glassMotion)
  expect(await motion()).toEqual([])
  const field = (await page.locator('[data-region="composer"]').boundingBox())!
  const outgoing = await filmEntry(page, '[data-message-request]', () => send.click())
  await expect(draft).toHaveValue('')
  expect(await motion()).toHaveLength(1)
  expect((await motion())[0]!.text).toContain(text)
  const middle = (frame: Frame) => (frame.glass.top + frame.glass.bottom) / 2
  // 3: the drop starts inside the composer.
  expect(middle(outgoing[0]!)).toBeGreaterThanOrEqual(field.y)
  expect(middle(outgoing[0]!)).toBeLessThanOrEqual(field.y + field.height)
  expectNaturalEntry(
    outgoing,
    outgoing.map((frame) => frame.glass.top),
  )
  // 4: the typed words leave upward and fade.
  const release = outgoing.filter((frame) => frame.t < 180).map((frame) => frame.release!)
  expect(release[0]!.opacity).toBeGreaterThan(0.9)
  for (const [index, now] of release.slice(1).entries()) {
    expect(now.opacity).toBeLessThan(release[index]!.opacity)
    expect(now.top).toBeLessThan(release[index]!.top)
  }
  // 8: the list never gains scroll range while the drop rises.
  expect(new Set(outgoing.map((frame) => frame.scroll)).size).toBe(1)

  // 9: a receipt that arrives mid-entry keeps the same bubble.
  const originalSurface = await page
    .locator('[data-message-request] [data-glass="bubble"]')
    .elementHandle()
  await page.evaluate(() => {
    for (const animation of (window as unknown as GlassWindow).motionHold.held) {
      animation.currentTime = 110
      animation.play()
    }
  })
  await page.evaluate(() => (window as unknown as GlassWindow).regression.confirmGlassSend())
  const confirmed = page.locator('article[data-event-id="35"]')
  await expect(confirmed).toContainText(text)
  await expect(page.getByText(text, { exact: true })).toHaveCount(1)
  expect(
    await confirmed
      .locator('[data-glass="bubble"]')
      .evaluate((surface, before) => surface === before, originalSurface),
  ).toBe(true)
  await expect(page.locator('[data-draft-release]')).toHaveCount(0, { timeout: 300 })
  await expect(page.getByRole('status').getByText('Yuki 正在處理', { exact: true })).toBeVisible()
  await expect(confirmed.locator('[data-liquid]')).toHaveCount(0)

  // 10: Yuki's reply grows in place by the same rules.
  const incoming = await filmEntry(page, 'article[data-event-id="36"]', () =>
    page.evaluate(
      (value) => (window as unknown as GlassWindow).regression.receiveGlassReply(value),
      reply,
    ),
  )
  expectNaturalEntry(
    incoming,
    incoming.map((frame) => frame.glass.right - frame.glass.left),
  )
  await page.evaluate(() => {
    for (const animation of (window as unknown as GlassWindow).motionHold.held) animation.play()
  })
  await expect(page.getByText(reply, { exact: true })).toBeVisible()
  expect((await motion()).filter((segment) => segment.text.includes(text))).toHaveLength(1)
  expect(
    await page.evaluate(() => (window as unknown as GlassWindow).regression.snapshot().submissions),
  ).toBe(1)
  await page.screenshot({
    path: test.info().outputPath('conversation-glass.png'),
    animations: 'disabled',
  })
  await writeFile(
    test.info().outputPath('send-motion.json'),
    JSON.stringify({ rim, field, outgoing, incoming }, null, 2) + '\n',
  )
})

test('a receipt after the tail settles preserves the bubble size and the conversation work card refracts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openConversation(page)
  const draft = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
  const text = '請把下次訪談的問題放到摘要最後。'
  await draft.fill(text)
  await page.getByRole('button', { name: '送出', exact: true }).click()
  const pending = page.locator('[data-message-request]')
  const surface = pending.locator('[data-glass="bubble"]')
  await expect(surface).toHaveAttribute('data-liquid', '')
  await expect(surface).not.toHaveAttribute('data-liquid', '')
  const before = (await pending.boundingBox())!
  await page.evaluate(() => (window as unknown as GlassWindow).regression.confirmGlassSend())
  const confirmed = page.locator('article[data-event-id="35"]')
  await expect(confirmed).toContainText(text)
  const after = (await confirmed.boundingBox())!
  expect(after.width).toBeCloseTo(before.width, 0)
  expect(after.height).toBeCloseTo(before.height, 0)
  const card = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: '整理訪談筆記', exact: true }),
  })
  const glass = card.locator('[data-glass="work-card"]')
  await expect(glass).toHaveCSS('backdrop-filter', /url\(/)
  await page.screenshot({ path: test.info().outputPath('clear-work-card.png') })
  await page.evaluate(() => {
    document.documentElement.dataset.opaque = 'true'
  })
  await expect(glass).toHaveCSS('backdrop-filter', 'none')
  await card.getByRole('button', { name: '查看詳情', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '詳情', exact: true })).toBeVisible()
})

test('the floating composer lets the conversation backdrop through in both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openConversation(page)
  const composer = page.locator('[data-region="composer"]')
  const draft = composer.getByRole('textbox')
  const backgroundOpacity = () =>
    composer.evaluate((element) => {
      const sample = document.createElement('canvas').getContext('2d')!
      sample.fillStyle = getComputedStyle(element).backgroundColor
      sample.fillRect(0, 0, 1, 1)
      return sample.getImageData(0, 0, 1, 1).data[3]! / 255
    })

  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme)
    await expect(composer).toHaveCSS('backdrop-filter', /url\(/)
    await expect.poll(backgroundOpacity).toBeLessThan(0.6)
    await page.screenshot({ path: test.info().outputPath(`composer-${theme}.png`) })
  }
  await draft.fill('下一次訪談的問題\n先確認上次記錄的細節。')
  await expect(draft).toBeFocused()
  await expect(composer.getByRole('button', { name: '送出', exact: true })).toBeEnabled()
  await expect.poll(backgroundOpacity).toBeLessThan(0.6)
  await page.screenshot({ path: test.info().outputPath('composer-dark-draft.png') })

  await page.evaluate(() => (document.documentElement.dataset.opaque = 'true'))
  await expect(composer).toHaveCSS('backdrop-filter', 'none')
  expect(await backgroundOpacity()).toBe(1)
  await expect(draft).toHaveValue('下一次訪談的問題\n先確認上次記錄的細節。')
  await page.screenshot({ path: test.info().outputPath('composer-opaque.png') })
})

test('narrow details return to the same draft and reading position with reduced motion and transparency', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 600 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openConversation(page)
  await page.evaluate(() => {
    document.documentElement.dataset.opaque = 'true'
  })
  const draft = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
  const log = page.getByRole('log', { name: '對話訊息' })
  const composer = page.locator('[data-region="composer"]')
  expect((await composer.boundingBox())!.height).toBeLessThan(68)
  await draft.fill('返回後繼續寫這段草稿')
  const work = page.getByRole('button', { name: '查看詳情', exact: true }).first()
  await work.scrollIntoViewIfNeeded()
  const top = await log.evaluate((element) => element.scrollTop)
  await work.click()
  const inspector = page.getByRole('complementary', { name: '詳情', exact: true })
  await expect(inspector.getByRole('heading', { name: '整理訪談筆記' })).toBeVisible()
  await expect(draft).toBeHidden()
  await expect(inspector.getByRole('button', { name: '關閉詳情', exact: true })).toBeFocused()
  await page.screenshot({ path: test.info().outputPath('narrow-work-detail.png') })
  await page.keyboard.press('Escape')
  await expect(inspector).toHaveCount(0)
  await expect(draft).toHaveValue('返回後繼續寫這段草稿')
  expect(await log.evaluate((element) => element.scrollTop)).toBe(top)

  await page.setViewportSize({ width: 960, height: 492 })
  for (const eventId of [31, 32, 33, 34]) {
    const message = log.locator(`article[data-event-id="${eventId}"]`)
    await message.hover()
    await message.getByRole('button', { name: '引用回覆', exact: true }).click()
  }
  await expect(composer.getByRole('button', { name: '移除引用', exact: true })).toHaveCount(4)
  const send = page.getByRole('button', { name: '送出', exact: true })
  await expect(send).toBeInViewport({ ratio: 1, timeout: 2500 })
  await send.click()
  const bubble = page.locator('[data-glass="bubble"]').last()
  await expect(page.getByText('返回後繼續寫這段草稿', { exact: true })).toBeVisible()
  await expect(bubble).toHaveCSS('backdrop-filter', 'none')
  expect(await page.evaluate(() => (window as unknown as GlassWindow).glassMotion)).toEqual([])
  // 11: with reduced motion the composer clears without leaving words behind.
  await expect(draft).toHaveValue('')
  await expect(page.locator('[data-draft-release]')).toHaveCount(0)
})
