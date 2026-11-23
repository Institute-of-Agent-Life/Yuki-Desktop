import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/*
 * 透明度滑塊 v2 (2026-11-23), research prototype only (tests/fixtures/glass-slider.*). Failure
 * cases, written before the prototype:
 *   1. grabbing the thumb away from its centre moves the value (it must not jump to the pointer);
 *      a drag then moves it by the distance dragged, not to where the pointer is;
 *   2. a move while dragging leaves the value, or the CSS variable the preview draws from,
 *      unchanged: both must change on every move, not on release; the preference is committed
 *      (the IPC call) only once, on release;
 *   3. dragged to the left end the value is not 0, or the preview window is not solid at that
 *      same moment (background alpha 1, no blur), before the pointer is released;
 *   4. arrow, Home and End keys do not move the value, or keyboard focus shows no ring;
 *   5. after release the thumb does not return to its resting size (24 by 20) and solid face, or
 *      takes longer than a second to settle;
 *   6. a pointer press leaves a focus ring (Apple draws none for a press; only keyboard focus).
 * Pictures, the drag sequence and the measured release curve are written under YUKI_LAB_OUTPUT.
 */
test.use({ deviceScaleFactor: 2, viewport: { width: 900, height: 420 } })
test.skip(!process.env.YUKI_LAB_OUTPUT, 'set YUKI_LAB_OUTPUT to run')
const url = 'http://127.0.0.1:4178/glass-slider.html'
const output = () => join(process.env.YUKI_LAB_OUTPUT!, 'glass-slider')

async function open(page: Page, query = '') {
  await page.goto(`${url}${query}`)
  await expect(page.locator('html[data-lab-ready]')).toBeAttached({ timeout: 10000 })
  await page.mouse.move(2, 2)
  await page.waitForTimeout(300)
}
const value = async (page: Page) =>
  Number(await page.getByRole('slider').getAttribute('aria-valuenow'))
const variable = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--window-transparency').trim(),
  )
const commits = (page: Page) =>
  page.evaluate(() => (window as unknown as { glassSliderCommits: number[] }).glassSliderCommits)
async function thumb(page: Page) {
  const box = (await page.locator('.gs-thumb').boundingBox())!
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}
const span = async (page: Page) =>
  (await page.getByRole('slider').boundingBox())!.width - 24 /* the resting thumb's width */
const ring = (page: Page) =>
  page.evaluate(() => {
    const knob = document.querySelector('.gs-thumb')!,
      slider = document.querySelector('[role="slider"]')!
    return {
      focused: document.activeElement === slider,
      visible: slider.matches(':focus-visible'),
      outline: getComputedStyle(knob).outlineStyle,
    }
  })
const clip = { x: 30, y: 80, width: 840, height: 260 }

test('the transparency slider grabs, drags, commits and springs back as specified', async ({
  page,
}) => {
  await mkdir(output(), { recursive: true })
  await open(page, '?value=60')
  await page.screenshot({ path: join(output(), 'rest-light.png') })

  // 1. A grab off the thumb's centre does not jump; the drag moves by the distance dragged.
  const start = await thumb(page),
    width = await span(page)
  const sequence: Buffer[] = [await page.screenshot({ clip })]
  await page.mouse.move(start.cx + 7, start.cy + 3)
  await page.mouse.down()
  sequence.push(await page.screenshot({ clip }))
  await page.waitForTimeout(400)
  expect(await value(page)).toBe(60)
  sequence.push(await page.screenshot({ clip }))
  await page.screenshot({ path: join(output(), 'held-light.png') })
  await page.screenshot({ path: join(output(), 'held-thumb.png'), clip: thumbClip(start) })
  await page.mouse.move(start.cx + 7 + 22, start.cy + 3, { steps: 2 })
  expect(Math.abs((await value(page)) - Math.round(60 + (22 / width) * 100))).toBeLessThanOrEqual(1)

  // 2. Every move changes the value and the variable the preview draws from; nothing commits yet.
  sequence.push(await page.screenshot({ clip }))
  let previous = { value: await value(page), variable: await variable(page) },
    x = start.cx + 29
  for (let step = 0; step < 10; step++) {
    x -= 9
    await page.mouse.move(x, start.cy + 3)
    const now = { value: await value(page), variable: await variable(page) }
    expect(now.value).not.toBe(previous.value)
    expect(now.variable).not.toBe(previous.variable)
    expect(now.variable).toBe(String(now.value / 100))
    previous = now
    sequence.push(await page.screenshot({ clip }))
  }
  expect(await commits(page)).toEqual([])

  // 3. At the left end the value is 0 and the preview is solid at once, while still held.
  const left = (await page.getByRole('slider').boundingBox())!.x
  await page.mouse.move(left - 30, start.cy + 3, { steps: 3 })
  expect(await value(page)).toBe(0)
  const window = await page.getByTestId('preview-window').evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, backdrop: style.backdropFilter }
  })
  expect(alpha(window.background)).toBe(1)
  expect(window.backdrop).toMatch(/blur\(0px\)/)
  sequence.push(await page.screenshot({ clip }))
  await page.screenshot({ path: join(output(), 'opaque-held.png') })

  // 5. Released, the thumb returns to rest: its size every frame for 1.2s.
  await page.mouse.move(left + 60, start.cy + 3, { steps: 4 })
  sequence.push(await page.screenshot({ clip }))
  const recording = page.evaluate(
    () =>
      new Promise<{ t: number; width: number; height: number; clear: number }[]>((resolve) => {
        const knob = document.querySelector<HTMLElement>('.gs-thumb')!,
          samples: { t: number; width: number; height: number; clear: number }[] = []
        const begin = performance.now()
        const frame = (now: number) => {
          samples.push({
            t: (now - begin) / 1000,
            width: parseFloat(knob.style.width),
            height: parseFloat(knob.style.height),
            clear: Number(knob.style.getPropertyValue('--clear')),
          })
          if (now - begin < 1200) requestAnimationFrame(frame)
          else resolve(samples)
        }
        requestAnimationFrame(frame)
      }),
  )
  await page.mouse.up()
  for (let i = 0; i < 8; i++) sequence.push(await page.screenshot({ clip }))
  const release = await recording
  const committed = await commits(page)
  expect(committed).toEqual([await value(page)])
  const last = release.at(-1)!
  expect(last.width).toBeCloseTo(24, 1)
  expect(last.height).toBeCloseTo(20, 1)
  expect(last.clear).toBe(0)
  const settled = release.find((_, i) =>
    release.slice(i).every((s) => Math.abs(s.width - 24) < 0.25 && Math.abs(s.height - 20) < 0.25),
  )!
  expect(settled.t).toBeLessThan(1)
  await expect(page.locator('.gs-thumb[data-rest="true"]')).toBeAttached({ timeout: 2000 })

  // 6. The press left keyboard focus on the slider, but no ring.
  expect(await ring(page)).toEqual({ focused: true, visible: false, outline: 'none' })

  // 4. Keys move the value; keyboard focus shows the ring.
  await page.mouse.click(4, 4)
  await page.keyboard.press('Tab')
  const keyed = await value(page)
  await page.keyboard.press('ArrowRight')
  expect(await value(page)).toBe(keyed + 5)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  expect(await value(page)).toBe(keyed - 5)
  await page.keyboard.press('End')
  expect(await value(page)).toBe(100)
  await page.keyboard.press('Home')
  expect(await value(page)).toBe(0)
  expect(await variable(page)).toBe('0')
  expect(await ring(page)).toEqual({ focused: true, visible: true, outline: 'solid' })
  await page.keyboard.press('End')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(output(), 'keyboard-focus.png') })

  // Dark, at rest and held, for the record.
  await open(page, '?value=60&theme=dark')
  await page.screenshot({ path: join(output(), 'rest-dark.png') })
  const dark = await thumb(page)
  await page.mouse.move(dark.cx, dark.cy)
  await page.mouse.down()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(output(), 'held-dark.png') })
  await page.screenshot({ path: join(output(), 'held-thumb-dark.png'), clip: thumbClip(dark) })
  await page.mouse.up()

  await mkdir(join(output(), 'sequence'), { recursive: true })
  await Promise.all(
    sequence.map((shot, i) =>
      writeFile(join(output(), 'sequence', `${String(i).padStart(2, '0')}.png`), shot),
    ),
  )
  await writeFile(
    join(output(), 'release.json'),
    JSON.stringify({ committed, settledAfter: settled.t, samples: release }, null, 1),
  )
})

const thumbClip = (box: { cx: number; cy: number }) => ({
  x: box.cx - 40,
  y: box.cy - 26,
  width: 80,
  height: 52,
})
function alpha(color: string) {
  const parts = color.match(/[\d.]+/g)!.map(Number)
  return parts.length > 3 ? parts[3]! : 1
}
