import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { dockGlass } from '../fixtures/dock-glass'

const regressions = 'http://127.0.0.1:4178/renderer-regressions.html'
const gallery = 'http://127.0.0.1:4178/components.html'
const evidence: Record<string, unknown> = {}

test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('liquid-glass.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

// The macOS Dock's glass (glass.ts, dock.ts): it bends once, its rim adds 76 (dark) or 65 (light)
// levels at the top's outermost pixel and 7 or 7.5 at 3pt, and a pane takes the Dock's colour (a
// held control stays clear).
async function expectLiquidGlass(name: string, pane: Locator, docked = true) {
  const theme = await pane.evaluate(() => document.documentElement.dataset.theme)
  // 1: refracting glass.
  await expect(pane).toHaveAttribute('data-refracting', 'true', { timeout: 5000 })
  // A pane growing out of a button is read once it has its own corners.
  await expect.poll(() => pane.evaluate((element) => element.getAnimations().length)).toBe(0)
  const glass = await dockGlass(pane)
  evidence[name] = glass
  expect(glass.backdrop).toMatch(/url\(/)
  expect(glass.bends).toBe(1)
  expect(glass.rim?.added).toBe(true)
  // A held control is small: the middle of its top lies between device pixels, a degree or two
  // off the vertical, where the rim falls 28 levels in 15° (dock.ts), so it reads a few under.
  const slack = docked ? 0 : 2
  expect(Math.abs(glass.rim!.edge - (theme === 'dark' ? 76 : 65))).toBeLessThanOrEqual(2 + slack)
  // Its tail, pressed thinner than the Dock's (dock.ts), adds nothing 3pt in (the Dock's 7–7.5).
  expect(Math.abs(glass.rim!.inside)).toBeLessThanOrEqual(1 + slack / 2)
  expect(glass.gain).toBe(docked ? (theme === 'dark' ? 1.08 : 1.2) : 1)
}

// 2: transparency off turns every pane into solid material.
async function expectSolid(page: Page, pane: Locator) {
  await page.evaluate(() => (document.documentElement.dataset.opaque = 'true'))
  await expect(pane).not.toHaveAttribute('data-refracting', 'true')
  expect(await pane.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe('none')
  const alpha = await pane.evaluate((element) => {
    const sample = document.createElement('canvas').getContext('2d')!
    sample.fillStyle = getComputedStyle(element).backgroundColor
    sample.fillRect(0, 0, 1, 1)
    return sample.getImageData(0, 0, 1, 1).data[3]! / 255
  })
  expect(alpha).toBe(1)
  await page.evaluate(() => delete document.documentElement.dataset.opaque)
}

async function brightness(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
) {
  const shot = await page.screenshot({ clip })
  return page.evaluate(async (bytes) => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + bytes
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, image.width, image.height).data
    let sum = 0
    for (let k = 0; k < data.length; k += 4) sum += data[k]! + data[k + 1]! + data[k + 2]!
    return sum / (data.length / 4) / 3
  }, shot.toString('base64'))
}

test('every floating conversation pane is lit liquid glass', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto(`${regressions}?case=conversation-glass`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() =>
    (
      window as unknown as { regression: { connection(state: 'online'): void } }
    ).regression.connection('online'),
  )
  const composer = page.locator('[data-region="composer"]')
  await expectLiquidGlass('composer', composer)
  // Q1 of the 液态玻璃组件统一 task book: bubbles and work cards are content, with no lens: only
  // frosted, by the backdrop blurred once (frosted-bubbles), not a filter of their own.
  for (const content of [
    page.locator('article[data-event-id="34"] [data-surface="bubble"]'),
    page.locator('[data-surface="work-card"]').first(),
  ])
    await expect(content).toHaveCSS('backdrop-filter', 'none')
  await page.screenshot({ path: test.info().outputPath('conversation-light.png') })
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await expectLiquidGlass('composer-dark', composer)
  await page.screenshot({ path: test.info().outputPath('conversation-dark.png') })

  await expectSolid(page, composer)
})

test('a conversation from another platform ends in a glass notice, not a frosted slab', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto(`${regressions}?case=conversation-glass&readonly=1`)
  const notice = page.locator('[data-floating-footer]')
  await expect(notice.getByText(/這是你在 QQ/)).toBeVisible()
  await expectLiquidGlass('readonly', notice)
  await page.screenshot({ path: test.info().outputPath('readonly-notice.png') })
  await expectSolid(page, notice)
})

test('dialogs, the command palette and controls share the glass without long tasks, and pairing lies on the window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.goto(gallery)
  await page.evaluate(() => {
    const long: number[] = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) long.push(entry.duration)
    }).observe({ type: 'longtask' })
    ;(window as unknown as { longTasks: number[] }).longTasks = long
  })
  await page.getByRole('button', { name: '開啟對話框', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expectLiquidGlass('dialog', dialog)
  // 8: opening the pane builds its lens without a long task.
  const long = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks)
  evidence.dialogLongTasks = long
  expect(long.filter((duration) => duration > 100)).toEqual([])
  await page.screenshot({ path: test.info().outputPath('dialog.png') })
  await expectSolid(page, dialog)
  await page.keyboard.press('Escape')
  // 1, as revised by the 液态玻璃组件统一 task book: a control is glass while it is held.
  for (const [kind, control] of [
    ['toggle', page.getByRole('switch').first()],
    [
      'segment',
      page.locator('[data-glass="segment"]').first().locator('..').locator('button').first(),
    ],
  ] as const) {
    const box = (await control.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expectLiquidGlass(kind, page.locator(`[data-glass="${kind}"]`).first(), false)
    await page.mouse.up()
  }
  // The slider's held thumb bends too, but draws its own rim (slider-v2.md), none in the map.
  const slider = page.getByRole('slider').first(),
    thumb = slider.locator('[data-glass="slider"]'),
    box = (await thumb.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(thumb).toHaveAttribute('data-refracting', 'true')
  expect(await thumb.evaluate((element) => getComputedStyle(element).backdropFilter)).toMatch(
    /^url\(/,
  )
  expect((await dockGlass(thumb)).rim!.edge).toBe(0)
  await page.mouse.up()

  await page.goto(`${regressions}?case=palette`)
  const palette = page.locator('dialog[data-glass="sheet"]')
  await expectLiquidGlass('palette', palette)
  await page.screenshot({ path: test.info().outputPath('palette.png') })
  await expectSolid(page, palette)

  // Pairing is a page, not a pane over one (hig-audit.md §6): it lies on the window, no glass.
  await page.goto('http://127.0.0.1:4178/pairing-regressions.html')
  await expect(page.locator('[data-page="connection"]').first()).toBeVisible()
  await expect(page.locator('[data-page="connection"] [data-glass]')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('pairing.png') })
})

test("the floating macOS sidebar is the Dock's glass, untinted; a flush one is not glass", async ({
  page,
}) => {
  await page.goto(`${regressions}?case=settings-transition`)
  const sidebar = page.locator('[data-glass="sidebar"]')
  await expect(sidebar).toBeVisible()
  const glass = (platform: string) =>
    sidebar.evaluate((element, platform) => {
      document.documentElement.dataset.platform = platform
      const style = getComputedStyle(element)
      return { filter: style.backdropFilter, fill: style.backgroundColor, shadow: style.boxShadow }
    }, platform)
  // 9: on macOS it floats as the Dock's glass (a little blur, no tint, no shadow).
  const floating = await glass('darwin')
  expect(floating.filter).toMatch(/^blur\(2px\)/)
  expect(floating.fill).toBe('rgba(0, 0, 0, 0)')
  expect(floating.shadow).toBe('none')
  // On Windows and Linux the sidebar lies flush with the window, divided by a hairline.
  expect((await glass('win32')).filter).toBe('none')
})

test('no pane disperses, and blue buttons are tinted glass lit like the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto(`${regressions}?case=conversation-glass`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  // Dispersion cost a red and a blue bend on every frame; the Dock parts no colours (measured).
  const composer = page.locator('[data-region="composer"]')
  await expect(composer).toHaveAttribute('data-refracting', 'true')
  const bubble = page.locator('article[data-event-id="34"] [data-surface="bubble"]')
  const glass = await dockGlass(composer)
  evidence.bends = { composer: glass }
  // The bevel's bend alone.
  expect(glass.bends).toBe(1)
  // Content bends nothing at all (Q1 of the 液态玻璃组件统一 task book): it is only frosted, by the
  // backdrop blurred once, with no filter of its own.
  expect(await bubble.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe('none')

  await page.goto(gallery)
  const primary = page.getByRole('button', { name: '開啟對話框', exact: true })
  const rim = (button: Locator) =>
    button.evaluate((node) => ({
      fill: getComputedStyle(node).backgroundImage,
      edge: getComputedStyle(node, '::before').backgroundImage,
      shown: getComputedStyle(node, '::before').display,
    }))
  const lit = await rim(primary)
  evidence.tinted = lit
  // One flat fill: depth comes from the rim light, never from a gradient in the colour.
  expect(lit.fill).toBe('none')
  expect(lit.edge).toMatch(/radial-gradient.*linear-gradient\(154deg/)
  // The rim nearest the pointer catches more light, as on clear glass.
  const box = (await primary.boundingBox())!
  const edge = { x: box.x + box.width - 14, y: box.y, width: 8, height: 2 }
  await page.mouse.move(5, 5)
  await page.waitForTimeout(100)
  const far = await brightness(page, edge)
  await page.mouse.move(edge.x + 4, edge.y - 6)
  await page.waitForTimeout(100)
  const near = await brightness(page, edge)
  evidence.tintedPointer = { far, near }
  expect(near).toBeGreaterThan(far + 3)
  expect((await rim(page.getByRole('button', { name: '停用', exact: true }))).shown).toBe('none')
})
