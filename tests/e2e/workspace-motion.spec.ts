import { expect, test, type Locator } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const gallery = 'http://127.0.0.1:4178/components.html'

async function move(button: Locator, reverse = false) {
  return button.evaluate(async (element, reverse) => {
    const control = element as HTMLButtonElement
    const content = document.querySelector<HTMLElement>('[data-region="content"]')!
    const sidebarToggle = document.querySelector<HTMLElement>('button[aria-label="側邊欄"]')!
    const read = () => {
      const center = content.getBoundingClientRect()
      const sidebar = document.querySelector<HTMLElement>('[data-region="sidebar"]')!
      const detail = document.querySelector<HTMLElement>('[data-region="inspector"]')
      return {
        left: center.left,
        right: center.right,
        sidebarToggle: sidebarToggle.getBoundingClientRect().left,
        sidebar: sidebar.getBoundingClientRect().left,
        detail: detail?.getBoundingClientRect().left ?? null,
        sidebarInert: sidebar.inert,
        detailInert: detail?.inert ?? null,
      }
    }
    const before = read()
    const frames: ReturnType<typeof read>[] = []
    let reversal = -1
    control.click()
    const until = performance.now() + 430
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    while (performance.now() < until || frames.length < 2) {
      await nextFrame()
      const frame = read()
      frames.push(frame)
      if (reverse && reversal === -1 && frame.left < before.left - 40 && frame.left > 70) {
        reversal = frames.length - 1
        control.click()
      }
    }
    // Slow runners may still be moving after the sampling window: read the settled
    // state once the finite motions have finished and React has rendered their end.
    while (
      document
        .getAnimations()
        .some(
          (animation) =>
            animation.playState === 'running' &&
            animation.effect?.getComputedTiming().endTime !== Infinity,
        )
    )
      await nextFrame()
    await nextFrame()
    await nextFrame()
    return { before, frames, reversal, after: read() }
  }, reverse)
}

const intermediate = (values: number[], first: number, last: number) =>
  new Set(
    values
      .map(Math.round)
      .filter((value) => value > Math.min(first, last) + 2 && value < Math.max(first, last) - 2),
  ).size

test('desktop panels and content move together and reverse from the visible position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(gallery + '?platform=darwin')
  const sidebar = page.getByRole('button', { name: '側邊欄', exact: true })
  const details = page.getByRole('button', { name: '詳情', exact: true })
  const reversal = await move(sidebar, true)
  expect(reversal.reversal).toBeGreaterThanOrEqual(0)
  const pivot = reversal.frames[reversal.reversal]!
  expect(pivot.sidebarInert).toBe(true)
  expect(reversal.frames[reversal.reversal + 1]!.left).toBeLessThan(reversal.before.left - 10)
  expect(reversal.after.left).toBeCloseTo(reversal.before.left, 0)

  const closeLeft = await move(sidebar)
  expect(closeLeft.after.left).toBeLessThan(closeLeft.before.left)
  const positions = [closeLeft.before, ...closeLeft.frames, closeLeft.after].map(
    (frame) => frame.sidebarToggle,
  )
  expect(Math.min(...positions)).toBeGreaterThanOrEqual(closeLeft.after.sidebarToggle - 0.25)
  expect(positions.slice(1).every((value, index) => value <= positions[index]! + 0.25)).toBe(true)
  expect(
    intermediate(
      closeLeft.frames.map((frame) => frame.left),
      closeLeft.before.left,
      closeLeft.after.left,
    ),
  ).toBeGreaterThan(0)
  expect(closeLeft.after.sidebarInert).toBe(true)
  const openLeft = await move(sidebar)
  expect(openLeft.after.left).toBeCloseTo(closeLeft.before.left, 0)
  expect(openLeft.after.sidebarInert).toBe(false)

  const openRight = await move(details)
  expect(openRight.after.right).toBeLessThan(openRight.before.right)
  expect(
    intermediate(
      openRight.frames.map((frame) => frame.right),
      openRight.before.right,
      openRight.after.right,
    ),
    // Slow runners draw few frames; one in-between position already shows a move, not a jump.
  ).toBeGreaterThan(0)
  expect(
    openRight.frames.some(
      (frame) => frame.detailInert === false && frame.detail! > openRight.after.detail! + 20,
    ),
  ).toBe(true)
  const closeRight = await move(details)
  expect(closeRight.frames.some((frame) => frame.detailInert === true)).toBe(true)
  expect(closeRight.after.detail).toBeNull()
  expect(closeRight.after.right).toBeCloseTo(openRight.before.right, 0)
  await writeFile(
    test.info().outputPath('workspace-panel-motion.json'),
    JSON.stringify({ reversal, closeLeft, openLeft, openRight, closeRight }, null, 2),
  )
  await page.screenshot({ path: test.info().outputPath('workspace-panels-settled.png') })
})

test('narrow overlays leave the workspace in place and reduced motion settles immediately', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 650 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(gallery)
  const left = page.getByRole('button', { name: '側邊欄', exact: true })
  const openLeft = await move(left)
  expect(openLeft.after.left).toBe(openLeft.before.left)
  expect(
    intermediate(
      openLeft.frames.map((frame) => frame.sidebar),
      openLeft.before.sidebar,
      openLeft.after.sidebar,
    ),
  ).toBeGreaterThan(1)
  await move(left)
  const details = page.getByRole('button', { name: '詳情', exact: true })
  const openRight = await move(details)
  expect(openRight.after.detail).not.toBeNull()
  expect(
    openRight.frames.some(
      (frame) => frame.detail !== null && frame.detail > openRight.after.detail! + 2,
    ),
  ).toBe(true)
  const close = page.getByRole('button', { name: '關閉詳情', exact: true })
  await expect(close).toBeFocused()
  await page.screenshot({ path: test.info().outputPath('workspace-narrow-detail.png') })
  const closeRight = await move(close)
  await expect(details).toBeFocused()
  expect(closeRight.after.detail).toBeNull()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reduced = await move(details)
  expect(reduced.frames[0]!.detail).toBe(reduced.after.detail)
  await writeFile(
    test.info().outputPath('workspace-narrow-motion.json'),
    JSON.stringify({ openLeft, openRight, closeRight, reduced }, null, 2),
  )
})
