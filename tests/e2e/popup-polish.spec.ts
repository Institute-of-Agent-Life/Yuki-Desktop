import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('popup-polish.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

// Holds every animation at its first frame, so a closing pane's glass can be read as it starts.
async function freeze(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 })
}
const box = (locator: Locator) =>
  locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height }
  })
// The glass a closing pane leaves: its size, its light map and whether its bend still exists.
const ghost = (page: Page) =>
  page
    .locator('[data-withdrawing]')
    .last()
    .evaluate((element: HTMLElement) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      const filter = getComputedStyle(element).backdropFilter
      const id = filter.match(/url\("?#([^")]+)/)?.[1]
      return {
        box: { x, y, width, height },
        rim: getComputedStyle(element).getPropertyValue('--rim').startsWith('url('),
        bend: !!id && document.getElementById(id) instanceof SVGFilterElement,
      }
    })
const sameBox = (
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
) => {
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(1)
}

test('the Yuki switcher closes from its own button and withdraws as the same glass', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('http://127.0.0.1:4178/role-switcher.html')
  const toggle = page.getByRole('button', { name: '切換 Yuki', exact: true })
  const menu = page.getByRole('menu', { name: 'Yuki', exact: true })
  await toggle.click()
  await expect(menu).toHaveAttribute('data-refracting', 'true')
  // 1: the switcher's own button puts the menu away and it stays away.
  await toggle.click()
  await expect(menu).toHaveCount(0)
  await page.waitForTimeout(400)
  await expect(menu).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await toggle.click()
  await expect(menu).toHaveAttribute('data-refracting', 'true')
  const open = await box(menu)
  await freeze(page)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  // 2: the withdrawing glass keeps its light and its bend.
  const closing = await ghost(page)
  evidence.menu = { open, closing }
  expect(closing.rim).toBe(true)
  expect(closing.bend).toBe(true)
  sameBox(closing.box, open)
})

test('a sheet withdraws from the size it had, whether its owner clears it or removes it', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('http://127.0.0.1:4178/about-profile.html?collections=full')
  await page.getByRole('button', { name: /原有的個人記憶/ }).click()
  await page.getByRole('button', { name: '更正', exact: true }).first().click()
  const correction = page.getByRole('dialog', { name: '更正記憶', exact: true })
  await expect(correction).toHaveAttribute('data-refracting', 'true')
  await page.waitForTimeout(1200)
  // 5: the scrim only dims; a blurred window under the sheet's own glass costs every frame.
  expect(
    await correction.evaluate((dialog) => getComputedStyle(dialog, '::backdrop').backdropFilter),
  ).toBe('none')
  const corrected = await box(correction)
  await freeze(page)
  await correction.getByRole('button', { name: '取消', exact: true }).click()
  // 3: its owner clears the content as it closes; the glass still starts at the open size.
  const correctionGhost = await ghost(page)
  evidence.correction = { open: corrected, closing: correctionGhost }
  sameBox(correctionGhost.box, corrected)
  expect(correctionGhost.rim).toBe(true)
  expect(correctionGhost.bend).toBe(true)

  await page.goto('http://127.0.0.1:4178/about-profile.html?administrator=true&avatar=supported')
  await page
    .getByRole('region', { name: '頭像', exact: true })
    .getByRole('button', { name: '更換頭像', exact: true })
    .click()
  const avatar = page.getByRole('dialog', { name: '更換 Yuki 的頭像' })
  await expect(avatar).toHaveAttribute('data-refracting', 'true')
  await page.waitForTimeout(1200)
  const opened = await box(avatar)
  await freeze(page)
  await avatar.getByRole('button', { name: '取消', exact: true }).click()
  await expect(avatar).toHaveCount(0)
  // 4: removed with its owner, the sheet still withdraws from the size it had.
  const avatarGhost = await ghost(page)
  evidence.avatar = { open: opened, closing: avatarGhost }
  sameBox(avatarGhost.box, opened)
  expect(avatarGhost.rim).toBe(true)
  expect(avatarGhost.bend).toBe(true)
})

test('the command palette scrim only dims', async ({ page }) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=palette')
  const palette = page.locator('dialog[data-glass="sheet"]')
  await expect(palette).toBeVisible()
  // 5
  expect(
    await palette.evaluate((dialog) => getComputedStyle(dialog, '::backdrop').backdropFilter),
  ).toBe('none')
})
