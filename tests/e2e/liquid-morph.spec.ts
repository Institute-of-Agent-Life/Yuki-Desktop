import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const gallery = 'http://127.0.0.1:4178/components.html'
const evidence: Record<string, unknown> = {}

test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('liquid-morph.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

type MorphWindow = Window & { motionHold: { armed: boolean; held: Animation[] } }
interface Frame {
  centerX: number
  centerY: number
  width: number
  height: number
  scale: number
  radiusX: number
  radiusY: number
  ink: number
}

// While armed, every animation that starts is held at its first frame for sampling.
async function holdMotion(page: Page) {
  await page.addInitScript(() => {
    const hold = { armed: false, held: [] as Animation[] }
    ;(window as unknown as MorphWindow).motionHold = hold
    const seen = new WeakSet<Animation>()
    const observe = () => {
      for (const animation of document.getAnimations()) {
        if (seen.has(animation)) continue
        seen.add(animation)
        if (!hold.armed) continue
        animation.pause()
        animation.currentTime = 0
        hold.held.push(animation)
      }
      requestAnimationFrame(observe)
    }
    requestAnimationFrame(observe)
  })
}
const arm = (page: Page, armed = true) =>
  page.evaluate((armed) => {
    const hold = (window as unknown as MorphWindow).motionHold
    hold.armed = armed
    if (armed) hold.held = []
  }, armed)
const release = (page: Page) =>
  page.evaluate(() => {
    for (const animation of (window as unknown as MorphWindow).motionHold.held)
      if (animation.effect?.getTiming().iterations !== Infinity) animation.finish()
  })

// Reads every frame of the held animations whose target is `pane`.
async function film(page: Page, pane: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (pane) =>
          (window as unknown as MorphWindow).motionHold.held.filter(
            (animation) =>
              animation.effect instanceof KeyframeEffect &&
              !animation.effect.pseudoElement &&
              animation.effect.target === document.querySelector(pane),
          ).length,
        pane,
      ),
    )
    .toBeGreaterThan(0)
  await page.waitForTimeout(50)
  const duration = await page.evaluate(
    (pane) =>
      Number(
        (window as unknown as MorphWindow).motionHold.held
          .find(
            (animation) =>
              animation.effect instanceof KeyframeEffect &&
              !animation.effect.pseudoElement &&
              animation.effect.target === document.querySelector(pane),
          )!
          .effect!.getTiming().duration,
      ),
    pane,
  )
  const frames: Frame[] = []
  for (let t = 0; t < duration; t += 1000 / 60)
    frames.push(
      await page.evaluate(
        ({ pane, t }) => {
          for (const animation of (window as unknown as MorphWindow).motionHold.held)
            animation.currentTime = Math.min(
              t,
              Number(animation.effect!.getTiming().duration) - 0.5,
            )
          const element = document.querySelector<HTMLElement>(pane)!
          const box = element.getBoundingClientRect()
          const scale = box.width / element.offsetWidth
          const [radiusX, radiusY = radiusX] = getComputedStyle(element)
            .borderTopLeftRadius.split(' ')
            .map(parseFloat)
          const child = element.firstElementChild
          return {
            centerX: box.left + box.width / 2,
            centerY: box.top + box.height / 2,
            width: box.width,
            height: box.height,
            scale,
            radiusX: radiusX! * scale,
            radiusY: radiusY! * (box.height / element.offsetHeight),
            ink: child ? Number(getComputedStyle(child).opacity) : 1,
          }
        },
        { pane, t },
      ),
    )
  return frames
}

const center = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
})

function expectGrowsFrom(
  frames: Frame[],
  trigger: { x: number; y: number; width: number; height: number },
) {
  const first = frames[0]!,
    origin = center(trigger)
  // 4: the first frame sits on the button, at the button's size.
  expect(Math.abs(first.centerX - origin.x)).toBeLessThanOrEqual(4)
  expect(Math.abs(first.centerY - origin.y)).toBeLessThanOrEqual(4)
  expect(Math.abs(first.width / trigger.width - 1)).toBeLessThanOrEqual(0.25)
  expect(Math.abs(first.height / trigger.height - 1)).toBeLessThanOrEqual(0.25)
  // 5: every frame is an ordinary rounded rectangle, never a squashed ellipse.
  for (const frame of frames) {
    expect(Math.abs(frame.radiusX - frame.radiusY)).toBeLessThanOrEqual(1.5)
    expect(frame.radiusX).toBeLessThanOrEqual(Math.min(frame.width, frame.height) / 2 + 1.5)
  }
  // 6: a small liquid overshoot, then the whole pane.
  expect(Math.max(...frames.map((frame) => frame.scale))).toBeGreaterThan(1.003)
  // 7: the content arrives after the glass.
  expect(first.ink).toBeLessThanOrEqual(0.05)
}

async function boxOf(locator: Locator) {
  return (await locator.boundingBox())!
}

test('a held button bulges and follows the pointer, and rests again without delaying its action', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(gallery)
  const icon = page.getByRole('button', { name: '搜尋已載入內容', exact: true }),
    command = page.getByRole('button', { name: '次要', exact: true })
  const scaleOf = (button: Locator) =>
    button.evaluate((node) => Number.parseFloat(getComputedStyle(node).scale) || 1)
  const iconBox = await boxOf(icon)
  await page.mouse.move(iconBox.x + iconBox.width / 2, iconBox.y + iconBox.height / 2)
  await page.mouse.down()
  // 1: an icon bulges past 1.05.
  await expect.poll(() => scaleOf(icon)).toBeGreaterThan(1.05)
  // 2: and is drawn toward the pointer.
  await page.mouse.move(iconBox.x + iconBox.width - 2, iconBox.y + iconBox.height / 2)
  await expect
    .poll(() => icon.evaluate((node) => Number.parseFloat(getComputedStyle(node).translate) || 0))
    .toBeGreaterThan(0.5)
  evidence.iconHeld = await icon.evaluate((node) => ({
    scale: getComputedStyle(node).scale,
    translate: getComputedStyle(node).translate,
  }))
  await page.mouse.move(iconBox.x + iconBox.width + 40, iconBox.y + iconBox.height / 2)
  await page.mouse.up()
  await expect(icon).toHaveCSS('scale', 'none')
  await expect(icon).toHaveCSS('translate', 'none')

  const before = JSON.parse((await page.getByLabel('互動次數').textContent())!).button as number
  const commandBox = await boxOf(command)
  await page.mouse.move(commandBox.x + commandBox.width / 2, commandBox.y + commandBox.height / 2)
  await page.mouse.down()
  await expect.poll(() => scaleOf(command)).toBeGreaterThan(1.02)
  await page.mouse.up()
  // 12: the click lands at release, not after the spring settles.
  expect(JSON.parse((await page.getByLabel('互動次數').textContent())!).button).toBe(before + 1)
  await expect(command).toHaveCSS('scale', 'none')

  // 3: with reduced motion a press changes nothing.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(commandBox.x + commandBox.width / 2, commandBox.y + commandBox.height / 2)
  await page.mouse.down()
  await expect(command).toHaveAttribute('data-held', 'true')
  await page.mouse.move(commandBox.x + commandBox.width - 2, commandBox.y + 4)
  await expect(command).toHaveCSS('scale', 'none')
  await expect(command).toHaveCSS('translate', 'none')
  await page.mouse.up()
})

test('a dialog grows out of its button and shrinks back into it while focus returns at once', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await holdMotion(page)
  await page.goto(gallery)
  const open = page.getByRole('button', { name: '開啟對話框', exact: true })
  const trigger = await boxOf(open)
  await arm(page)
  await open.click()
  const opening = await film(page, 'dialog[data-glass="sheet"]')
  expectGrowsFrom(opening, trigger)
  evidence.dialogOpening = opening
  await release(page)
  await arm(page, false)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const last = opening.at(-1)!,
    rest = await boxOf(dialog)
  expect(Math.abs(last.width - rest.width)).toBeLessThanOrEqual(1)

  await arm(page)
  await page.keyboard.press('Escape')
  // 8 and 12: the dialog has closed and focus is back before any shrinking is seen.
  expect(await page.evaluate(() => document.querySelector('dialog')!.open)).toBe(false)
  await expect(open).toBeFocused()
  const closing = await film(page, '[data-withdrawing]')
  const end = closing.at(-1)!,
    origin = center(trigger)
  expect(Math.abs(end.centerX - origin.x)).toBeLessThanOrEqual(4)
  expect(Math.abs(end.centerY - origin.y)).toBeLessThanOrEqual(4)
  expect(closing[0]!.width).toBeCloseTo(rest.width, 0)
  evidence.dialogClosing = closing
  await release(page)
  await expect(page.locator('[data-withdrawing]')).toHaveCount(0)

  // 11: reduced motion opens and closes without any morph.
  await arm(page, false)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open.click()
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate((node) => node.getAnimations().length)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-withdrawing]')).toHaveCount(0)
  await expect(dialog).toHaveCount(0)
})

test('a palette opened by shortcut swells from its own centre and settles back into it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await holdMotion(page)
  await page.addInitScript(() => ((window as unknown as MorphWindow).motionHold.armed = true))
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=palette')
  const frames = await film(page, 'dialog[data-glass="sheet"]')
  await release(page)
  await arm(page, false)
  const rest = await boxOf(page.locator('dialog[data-glass="sheet"]'))
  const first = frames[0]!
  // 9: no button opened it, so it starts near full size at its own centre.
  expect(first.scale).toBeGreaterThan(0.9)
  expect(first.scale).toBeLessThan(1)
  expect(Math.abs(first.centerX - (rest.x + rest.width / 2))).toBeLessThanOrEqual(2)
  expect(Math.abs(first.centerY - (rest.y + rest.height / 2))).toBeLessThanOrEqual(2)
  // Closing unmounts the palette at once; its glass still settles back into its centre.
  await arm(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[data-glass="sheet"]')).toHaveCount(0)
  const closing = await film(page, '[data-withdrawing]')
  expect(closing[0]!.width).toBeCloseTo(rest.width, 0)
  expect(closing.at(-1)!.scale).toBeLessThan(0.97)
  await release(page)
  await expect(page.locator('[data-withdrawing]')).toHaveCount(0)
  evidence.palette = { opening: frames, closing }
})

test('the Yuki switcher menu is glass that grows out of the switcher and back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await holdMotion(page)
  await page.goto('http://127.0.0.1:4178/role-switcher.html')
  const toggle = page.getByRole('button', { name: '切換 Yuki', exact: true })
  const trigger = await boxOf(toggle)
  await arm(page)
  await toggle.press('Enter')
  const opening = await film(page, '[role="menu"]')
  await release(page)
  await arm(page, false)
  const menu = page.getByRole('menu', { name: 'Yuki', exact: true })
  // 10: refracting glass that starts on the switcher.
  await expect(menu).toHaveAttribute('data-refracting', 'true')
  const first = opening[0]!
  expect(Math.abs(first.centerX - center(trigger).x)).toBeLessThanOrEqual(4)
  expect(Math.abs(first.centerY - center(trigger).y)).toBeLessThanOrEqual(4)
  expect(first.ink).toBeLessThanOrEqual(0.05)
  await arm(page)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(toggle).toBeFocused()
  const closing = await film(page, '[data-withdrawing]')
  expect(Math.abs(closing.at(-1)!.centerY - center(trigger).y)).toBeLessThanOrEqual(4)
  await release(page)
  await expect(page.locator('[data-withdrawing]')).toHaveCount(0)
  evidence.menu = { opening, closing }
})

test('a busy button opens room for its spinner on a liquid spring and keeps even spacing', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await holdMotion(page)
  await page.addInitScript(() => ((window as unknown as MorphWindow).motionHold.armed = true))
  await page.goto(gallery)
  // The spinner's status names the button too, so find it by its label text.
  const busy = page.locator('button[aria-busy="true"]', { hasText: '載入' })
  // 17: the spinner's place opens on a spring that overshoots, so the button swells and settles.
  const peak = await expect
    .poll(() =>
      page.evaluate(() => {
        const opening = (window as unknown as MorphWindow).motionHold.held.find(
          (animation) =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.getKeyframes().some((frame) => '--busy' in frame),
        )
        return opening
          ? Math.max(
              ...(opening.effect as KeyframeEffect)
                .getKeyframes()
                .map((frame) => Number(frame['--busy'])),
            )
          : 0
      }),
    )
    .toBeGreaterThan(1.02)
    .then(() => 'overshoots')
  await release(page)
  await arm(page, false)
  // 18: at rest the spinner sits beside the label with a gap, centred, and padding is even.
  const spinner = busy.getByRole('status', { name: '載入中' })
  await expect(spinner).toBeVisible()
  const layout = await busy.evaluate((button) => {
    const box = button.getBoundingClientRect()
    const spin = button.querySelector('[role="status"]')!.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(button.lastChild!)
    const text = range.getBoundingClientRect()
    return {
      leftPad: spin.left - box.left,
      gap: text.left - spin.right,
      rightPad: box.right - text.right,
      spinMiddle: spin.top + spin.height / 2,
      textMiddle: text.top + text.height / 2,
    }
  })
  evidence.busy = { peak, layout }
  expect(layout.gap).toBeGreaterThanOrEqual(5)
  expect(Math.abs(layout.leftPad - layout.rightPad)).toBeLessThanOrEqual(2)
  expect(Math.abs(layout.spinMiddle - layout.textMiddle)).toBeLessThanOrEqual(1.5)
  // 19: two-character labels keep a button's width, a little air between Han characters,
  // and a disabled button keeps its outline.
  const metrics = await page.getByRole('button', { name: '停用', exact: true }).evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      width: node.getBoundingClientRect().width,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      outline: style.boxShadow,
    }
  })
  evidence.buttonMetrics = metrics
  expect(metrics.width).toBeGreaterThanOrEqual(64)
  expect(parseFloat(metrics.letterSpacing)).toBeGreaterThan(0)
  expect(metrics.lineHeight).toBe('18px')
  expect(metrics.outline).not.toBe('none')
})
