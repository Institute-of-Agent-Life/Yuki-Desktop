import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { chooseTransparency } from '../fixtures/transparency'

/*
 * The transparency slider (docs/reports/2026-11-23-liquid-glass/slider-v2.md, phase 2): the window's
 * transparency is a number from 0 (opaque) to 100, chosen on a glass slider in Appearance.
 * Failure cases, written before the slider replaced the two-way material choice:
 *   1. Appearance still offers frosted or opaque, or the slider is missing, unnamed or unlabelled;
 *   2. grabbing the thumb makes the value jump;
 *   3. dragging writes the preference on every move, or the window does not follow while dragged;
 *   4. dragging to the far left is not opaque at once: no save until the thumb is let go;
 *   5. letting go saves nothing, or saves a value other than the one shown;
 *   6. the thumb does not grow into clear glass while held, or stays large or clear once let go;
 *   7. keys do not move it (arrows ±5, pages ±25, Home, End), or do not save;
 *   8. a press draws the keyboard's focus ring, or the keyboard's focus draws none;
 *   9. an earlier `opaque` preference is lost: true is not read as 0, false not as the default;
 *  10. the main process takes values outside 0–100, fractions or non-numbers, or keeps `opaque`;
 *  11. the window's native material does not turn off at 0 and back on above it;
 *  12. the page does not follow: `data-opaque` and `--window-transparency` disagree with the value.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('transparency.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})
test.use({ deviceScaleFactor: 2 })

const saves = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { preferenceSaves?: { transparency?: number }[] }).preferenceSaves,
  )
const transparencySaves = async (page: Page) =>
  ((await saves(page)) ?? [])
    .filter((patch) => 'transparency' in patch)
    .map((patch) => patch.transparency)
const size = (thumb: Locator) =>
  thumb.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect()
    return [Math.round(width), Math.round(height)]
  })
const variable = (page: Page) =>
  page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--window-transparency').trim(),
  )

async function openAppearance(page: Page) {
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=settings')
  await page.getByRole('tab', { name: '外觀', exact: true }).click()
  return page.getByRole('slider', { name: '透明度', exact: true })
}

test('the transparency slider follows the pointer, saves once when let go and is glass while held', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const slider = await openAppearance(page)
  const thumb = slider.locator('[data-glass="slider"]')
  // 1
  await expect(page.getByRole('radiogroup', { name: '視窗材質', exact: true })).toHaveCount(0)
  await expect(slider).toHaveAttribute('aria-valuenow', '70')
  await expect(slider).toHaveAttribute('aria-valuetext', '70%')
  await expect(page.getByRole('img', { name: '不透明', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: '透明', exact: true })).toBeVisible()
  await expect(page.getByText(/向右讓桌面透出更多/)).toBeVisible()
  // 6: solid and small at rest.
  expect(await size(thumb)).toEqual([24, 20])
  await expect(thumb).not.toHaveAttribute('data-refracting')
  await page.screenshot({ path: test.info().outputPath('slider-rest.png') })

  // 2: grabbed off its centre, it stays where it is.
  const box = (await thumb.boundingBox())!
  const start = { x: box.x + box.width / 2 + 4, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await expect(slider).toHaveAttribute('aria-valuenow', '70')
  // 6: held, it grows into clear glass.
  await expect(thumb).toHaveAttribute('data-refracting', 'true')
  await expect.poll(() => size(thumb)).toEqual([37, 33])
  await page.screenshot({ path: test.info().outputPath('slider-held.png') })

  // 3: twenty small steps, each a new value written to the page, none saved.
  const track = (await slider.boundingBox())!
  const seen = new Set<string>()
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(start.x + step * 3, start.y)
    seen.add((await slider.getAttribute('aria-valuenow'))!)
    expect(await variable(page)).toBe(
      String(Number(await slider.getAttribute('aria-valuenow')) / 100),
    )
  }
  evidence.dragged = [...seen]
  expect(seen.size).toBeGreaterThanOrEqual(12)
  expect(await transparencySaves(page)).toEqual([])
  // 5: let go, the value shown is saved once.
  await page.mouse.up()
  const shown = Number(await slider.getAttribute('aria-valuenow'))
  expect(shown).toBeGreaterThan(70)
  await expect.poll(() => transparencySaves(page)).toEqual([shown])
  // 6: back to its solid resting size within a second.
  await expect.poll(() => size(thumb), { timeout: 1000 }).toEqual([24, 20])
  await expect(thumb).not.toHaveAttribute('data-refracting', { timeout: 1000 })

  // 4: dragged past the left end it is opaque at once, saved before it is let go.
  const now = (await thumb.boundingBox())!
  await page.mouse.move(now.x + now.width / 2, now.y + now.height / 2)
  await page.mouse.down()
  await page.mouse.move(track.x - 40, now.y + now.height / 2, { steps: 8 })
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  await expect(slider).toHaveAttribute('aria-valuetext', '不透明')
  await expect.poll(() => transparencySaves(page)).toEqual([shown, 0])
  expect(await variable(page)).toBe('0')
  await page.screenshot({ path: test.info().outputPath('slider-opaque-held.png') })
  await page.mouse.up()
  await expect.poll(async () => (await transparencySaves(page)).at(-1)).toBe(0)
  evidence.saves = await transparencySaves(page)

  // 8: a press focuses the slider without the keyboard's ring.
  const ring = () => thumb.evaluate((element) => getComputedStyle(element).outlineStyle)
  await expect(slider).toBeFocused()
  expect(await ring()).toBe('none')
})

test('keys move the transparency by steps and save each one', async ({ page }) => {
  const slider = await openAppearance(page)
  const thumb = slider.locator('[data-glass="slider"]')
  // 8: reached by the keyboard, it shows the ring.
  await page.getByRole('tab', { name: '外觀', exact: true }).focus()
  for (
    let tab = 0;
    tab < 12 && !(await slider.evaluate((e) => e === document.activeElement));
    tab++
  )
    await page.keyboard.press('Tab')
  await expect(slider).toBeFocused()
  expect(await thumb.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid')
  await page.screenshot({ path: test.info().outputPath('slider-focus.png') })
  // 7
  const steps: [string, number][] = [
    ['ArrowLeft', 65],
    ['ArrowDown', 60],
    ['ArrowUp', 65],
    ['ArrowRight', 70],
    ['PageDown', 45],
    ['PageUp', 70],
    ['Home', 0],
    ['End', 100],
  ]
  for (const [key, value] of steps) {
    await page.keyboard.press(key)
    await expect(slider).toHaveAttribute('aria-valuenow', String(value))
  }
  expect(await transparencySaves(page)).toEqual(steps.map(([, value]) => value))
})

// The real app, from an isolated profile: what it read, what it keeps and the window it draws.
async function launch(root: string, profile: string, appearance?: Record<string, unknown>) {
  const desktop = await isolatedDesktop(root)
  let app = await desktop.launch(profile)
  if (appearance) {
    // An earlier version's preferences, written where that version kept them.
    await (await app.firstWindow()).waitForLoadState('domcontentloaded')
    await app.evaluate(({ app }, appearance) => {
      const path = process.getBuiltinModule('node:path')
      const require = process
        .getBuiltinModule('node:module')
        .createRequire(path.join(app.getAppPath(), 'package.json'))
      const Database = require('better-sqlite3') as typeof import('better-sqlite3')
      const db = new Database(path.join(app.getPath('userData'), 'desktop.sqlite3'))
      db.prepare("UPDATE preferences SET value=? WHERE key='appearance'").run(
        JSON.stringify(appearance),
      )
      db.close()
    }, appearance)
    await app.close()
    app = await desktop.launch(profile)
  }
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}
// The window's own solid colours (window-appearance.ts); behind native material it is clear,
// which Electron reports without its alpha.
const solid = (colour: string) => ['#101215', '#E9EDF3'].includes(colour.toUpperCase())
const background = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor())

test('an earlier opaque choice is kept, and the window turns its material off only at 0', async () => {
  test.setTimeout(120000)
  const root = await mkdtemp(join(tmpdir(), 'yuki-transparency-'))
  // 9
  const earlier: Record<string, unknown> = {}
  for (const [opaque, expected] of [
    [true, 0],
    [false, 70],
  ] as const) {
    const { app, page } = await launch(root, `opaque-${opaque}`, { keepInTray: false, opaque })
    try {
      const preferences = await page.evaluate(async () => (await window.yuki.boot()).preferences)
      earlier[String(opaque)] = preferences
      expect(preferences.transparency).toBe(expected)
      expect(preferences).not.toHaveProperty('opaque')
    } finally {
      await app.close()
    }
  }
  evidence.earlier = earlier

  const { app, page } = await launch(root, 'values')
  try {
    const boot = await page.evaluate(() => window.yuki.boot())
    const native = boot.nativeMaterial !== 'none' && !boot.reducedTransparency && !boot.highContrast
    const set = (patch: Record<string, unknown>) =>
      page.evaluate(
        async (patch) => (await window.yuki.preferences(patch as never)).transparency,
        patch,
      )
    const look = async () => ({
      opaque: await page.evaluate(() => document.documentElement.dataset.opaque),
      material: await page.evaluate(() => document.documentElement.dataset.material),
      variable: await variable(page),
      background: await background(app),
    })
    const seen: Record<string, unknown> = { boot: boot.preferences.transparency }
    evidence.values = seen
    // 10
    expect(boot.preferences.transparency).toBe(70)
    expect(await set({ transparency: 42.6 })).toBe(43)
    expect(await set({ transparency: -5 })).toBe(0)
    expect(await set({ transparency: 250 })).toBe(100)
    expect(await set({ transparency: Number.NaN })).toBe(100)
    expect(await set({ transparency: '50' })).toBe(100)
    expect(await set({ opaque: true })).toBe(100)
    expect(
      await page.evaluate(async () => (await window.yuki.boot()).preferences),
    ).not.toHaveProperty('opaque')
    // 11, 12: chosen where a person chooses it, in Appearance.
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    for (const value of [0, 35, 0, 100]) {
      await chooseTransparency(page, value)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.opaque))
        .toBe(String(value === 0 || boot.reducedTransparency || boot.highContrast))
      expect(await set({})).toBe(value)
      const now = await look()
      seen[`at-${value}-${Object.keys(seen).length}`] = now
      expect(now.variable).toBe(String(value / 100))
      if (native) {
        expect(now.material).toBe(value === 0 ? 'none' : boot.nativeMaterial)
        expect(solid(now.background)).toBe(value === 0)
      } else expect(solid(now.background)).toBe(true)
    }
  } finally {
    await app.close()
  }
})
