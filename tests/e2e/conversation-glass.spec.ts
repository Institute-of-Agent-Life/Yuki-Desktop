import { expect, test, type Page } from '@playwright/test'

interface GlassFixture {
  connection(state: 'online'): void
  confirmGlassSend(): void
  receiveGlassReply(text: string): void
  snapshot(): { submissions: number }
}

interface GlassMotion {
  text: string
  transforms: string[]
}

type GlassWindow = Window & {
  regression: GlassFixture
  glassMotion: GlassMotion[]
}

async function openConversation(page: Page) {
  await page.addInitScript(() => {
    const observed = new WeakSet<Animation>()
    const motion: GlassMotion[] = []
    ;(window as unknown as GlassWindow).glassMotion = motion
    const observe = () => {
      for (const animation of document.getAnimations()) {
        if (observed.has(animation)) continue
        observed.add(animation)
        const effect = animation.effect
        if (!(effect instanceof KeyframeEffect) || !effect.target?.matches('[data-glass="bubble"]'))
          continue
        motion.push({
          text: effect.target.parentElement?.textContent ?? '',
          transforms: effect.getKeyframes().map((frame) => String(frame.transform ?? '')),
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

test('new conversation bubbles enter once, including a send that later receives its original event', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openConversation(page)
  const draft = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
  const send = page.getByRole('button', { name: '送出', exact: true })
  const text = '請把下次訪談要追問的問題加進摘要。'
  const reply = '已把問題放在摘要最後，並附上原始訪談的來源。'
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
  await send.click()
  await expect(page.getByText(text, { exact: true })).toHaveCount(1)
  await expect.poll(motion, { timeout: 3000 }).toHaveLength(1)
  const [outgoing] = await motion()
  expect(outgoing!.text).toContain(text)
  expect(outgoing!.transforms.some((frame) => frame.includes('translateY'))).toBe(true)

  await page.evaluate(() => (window as unknown as GlassWindow).regression.confirmGlassSend())
  await expect(page.locator('article[data-event-id="35"]')).toContainText(text)
  await expect(page.getByText(text, { exact: true })).toHaveCount(1)
  await expect(page.getByRole('status').getByText('Yuki 正在處理', { exact: true })).toBeVisible()
  await page.evaluate(
    (value) => (window as unknown as GlassWindow).regression.receiveGlassReply(value),
    reply,
  )
  await expect(page.getByText(reply, { exact: true })).toBeVisible()
  await expect.poll(motion, { timeout: 3000 }).toHaveLength(2)
  const [, incoming] = await motion()
  expect(incoming!.text).toContain(reply)
  expect(incoming!.transforms).not.toEqual(outgoing!.transforms)
  expect(
    await page.evaluate(() => (window as unknown as GlassWindow).regression.snapshot().submissions),
  ).toBe(1)
  await page.screenshot({
    path: test.info().outputPath('conversation-glass.png'),
    animations: 'disabled',
  })
  await test.info().attach('conversation-motion', {
    body: JSON.stringify(await motion()),
    contentType: 'application/json',
  })
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
})
