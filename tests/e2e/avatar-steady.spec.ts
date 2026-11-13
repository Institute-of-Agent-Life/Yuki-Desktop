import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// Switching between the desktop conversation and a QQ or Telegram one leaves Yuki's picture in
// the top left as it is. Failure cases:
// 1. the picture's bytes are read again on a switch (each read is a fresh copy, as over IPC, so
//    every picture of Yuki gets a new address);
// 2. the top-left picture is replaced by a new image, or fades in again, on a switch.
type AvatarWindow = Window & {
  regression: { avatarReads(): number }
  seen: { image: number; src: string; opacity: string }[]
}

test("switching conversations leaves Yuki's picture in the top left as it is", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 760 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=showcase&readonly=1')
  const nav = page.getByRole('navigation', { name: '主要導覽' })
  const picture = nav.locator('img').first()
  await expect(picture).toBeVisible()
  await expect.poll(() => picture.evaluate((image) => getComputedStyle(image).opacity)).toBe('1')
  const reads = () =>
    page.evaluate(() => (window as unknown as AvatarWindow).regression.avatarReads())
  const before = await reads()
  // Every frame through the switches: which image is shown, from where, and how opaque.
  await page.evaluate(() => {
    const state = window as unknown as AvatarWindow
    const ids = new WeakMap<Element, number>()
    let next = 0
    state.seen = []
    const start = performance.now()
    const record = () => {
      const image = document.querySelector('nav[aria-label="主要導覽"] img')
      if (image && !ids.has(image)) ids.set(image, ++next)
      state.seen.push({
        image: image ? ids.get(image)! : 0,
        src: image?.getAttribute('src') ?? '',
        opacity: image ? getComputedStyle(image).opacity : '',
      })
      if (performance.now() - start < 4000) requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
  for (let round = 0; round < 2; round++) {
    await nav.getByRole('button', { name: /QQ 私聊/ }).click()
    await page.waitForTimeout(800)
    await nav.getByRole('button', { name: /桌面對話/ }).click()
    await page.waitForTimeout(800)
  }
  await page.waitForTimeout(800)
  const seen = await page.evaluate(() => (window as unknown as AvatarWindow).seen)
  const evidence = {
    reads: (await reads()) - before,
    images: [...new Set(seen.map((frame) => frame.image))],
    addresses: [...new Set(seen.map((frame) => frame.src))].length,
    faded: seen.filter((frame) => frame.opacity !== '1').length,
  }
  await writeFile(test.info().outputPath('avatar-steady.json'), JSON.stringify(evidence, null, 2))
  // 1
  expect(evidence.reads).toBe(0)
  // 2
  expect(evidence).toMatchObject({ images: [1], addresses: 1, faded: 0 })
})
