import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const regressions = 'http://127.0.0.1:4178/renderer-regressions.html'
const gallery = 'http://127.0.0.1:4178/components.html'
const evidence: Record<string, unknown> = {}

test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('liquid-glass.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

// Light map alpha along each straight edge, on the four corner arcs (45° round each corner, half a
// pixel in) and 3px inside the top edge.
function rimLight(pane: Locator) {
  return pane.evaluate(async (element) => {
    const style = getComputedStyle(element)
    const image = new Image()
    image.src = style.getPropertyValue('--rim').match(/url\("?(.*?)"?\)$/)![1]!
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    // The map is a tile of the glass's corners (glass.ts): its scale is a sliced side's slice over
    // its border, or the whole map over the glass where neither side is sliced.
    const [sliceY, sliceX] = style.getPropertyValue('--rim-slice').trim().split(/\s+/).map(Number)
    const [borderY, borderX] = style
      .getPropertyValue('--rim-border')
      .trim()
      .split(/\s+/)
      .map((value) => parseFloat(value))
    const scale = sliceX
      ? sliceX / borderX!
      : sliceY
        ? sliceY / borderY!
        : image.width / (element as HTMLElement).offsetWidth
    const radius = Math.min(
      parseFloat(style.borderTopLeftRadius),
      (element as HTMLElement).offsetWidth / 2,
      (element as HTMLElement).offsetHeight / 2,
    )
    const alpha = (x: number, y: number) =>
      Math.max(
        ...[-1, 0, 1].flatMap((dx) =>
          [-1, 0, 1].map(
            (dy) =>
              context.getImageData(Math.round(x + dx), Math.round(y + dy), 1, 1).data[3]! / 255,
          ),
        ),
      )
    const along = (radius - (radius - 0.5) * Math.SQRT1_2) * scale
    return {
      top: alpha(image.width / 2, 1),
      inside:
        context.getImageData(Math.round(image.width / 2), Math.round(3 * scale) + 1, 1, 1)
          .data[3]! / 255,
      bottom: alpha(image.width / 2, image.height - 2),
      left: alpha(1, image.height / 2),
      right: alpha(image.width - 2, image.height / 2),
      upperRight: alpha(image.width - along, along),
      upperLeft: alpha(along, along),
      lowerLeft: alpha(along, image.height - along),
      lowerRight: alpha(image.width - along, image.height - along),
    }
  })
}

async function expectLiquidGlass(name: string, pane: Locator) {
  // 1: refracting glass.
  await expect(pane).toHaveAttribute('data-refracting', 'true', { timeout: 5000 })
  // A pane growing out of a button is read once it has its own corners.
  await expect.poll(() => pane.evaluate((element) => element.getAnimations().length)).toBe(0)
  const filter = await pane.evaluate((element) => getComputedStyle(element).backdropFilter)
  expect(filter).toMatch(/url\(/)
  // 3–4, as revised by the iOS 26 measurement (glass.ts `lights`): lit from the upper left: the
  // upper-left and lower-right corners brightest, the sides at about half of them, the upper-right
  // and lower-left dark.
  const rim = await rimLight(pane)
  evidence[name] = { filter, rim }
  // (The arcs are read a pixel off the diagonal, where the light has begun to rise again.)
  expect(rim.upperRight).toBeLessThan(rim.upperLeft * 0.3)
  expect(rim.lowerLeft).toBeLessThan(rim.lowerRight * 0.3)
  for (const side of [rim.top, rim.bottom, rim.left, rim.right]) {
    // Dimmer than the brightest corner (about 0.6 of it on the top and bottom, 0.4 on the sides; a
    // small held control's corner is read off its brightest pixel, so only the order is kept).
    expect(side).toBeLessThan(Math.max(rim.upperLeft, rim.lowerRight))
    expect(Math.abs(side - rim.top)).toBeLessThanOrEqual(0.06)
  }
  expect(rim.inside).toBeLessThan(rim.top * 0.4)
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
  // frosted.
  for (const content of [
    page.locator('article[data-event-id="34"] [data-surface="bubble"]'),
    page.locator('[data-surface="work-card"]').first(),
  ])
    await expect(content).toHaveCSS('backdrop-filter', 'blur(12px)')
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
    await expectLiquidGlass(kind, page.locator(`[data-glass="${kind}"]`).first())
    await page.mouse.up()
  }
  // The slider's held thumb bends too, but draws its own rim (slider-v2.md), not the map's.
  const slider = page.getByRole('slider').first(),
    thumb = slider.locator('[data-glass="slider"]'),
    box = (await thumb.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(thumb).toHaveAttribute('data-refracting', 'true')
  expect(await thumb.evaluate((element) => getComputedStyle(element).backdropFilter)).toMatch(
    /^url\(/,
  )
  expect(await thumb.evaluate((element) => getComputedStyle(element, '::after').display)).toBe(
    'none',
  )
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

test('the floating macOS sidebar has a rim lit from the upper left; a flush one has none', async ({
  page,
}) => {
  await page.goto(`${regressions}?case=settings-transition`)
  const sidebar = page.locator('[data-glass="sidebar"]')
  await expect(sidebar).toBeVisible()
  const rim = (platform: string) =>
    sidebar.evaluate((element, platform) => {
      document.documentElement.dataset.platform = platform
      const style = getComputedStyle(element, '::before')
      return { display: style.display, image: style.backgroundImage }
    }, platform)
  // 9: the same light direction as every refracting pane; with no light map of its own the
  // floating sidebar draws that rim, which refracting glass never does.
  const floating = await rim('darwin')
  expect(floating.display).toBe('block')
  expect(floating.image).toMatch(/^linear-gradient\(154deg/)
  // On Windows and Linux the sidebar lies flush with the window, divided by a hairline.
  expect((await rim('win32')).display).toBe('none')
})

test('no pane disperses, and blue buttons are tinted glass lit like the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto(`${regressions}?case=conversation-glass`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  // Dispersion cost a red and a blue bend on every frame; iOS 26 parts no colours (measured).
  const bends = (pane: Locator) =>
    pane.evaluate((element) => {
      const id = getComputedStyle(element).backdropFilter.match(/url\("?#([^")]+)/)![1]!
      const filter = document.getElementById(id)!
      return {
        bends: filter.querySelectorAll('feDisplacementMap').length,
        colours: filter.querySelectorAll('feColorMatrix').length,
      }
    })
  const composer = page.locator('[data-region="composer"]')
  await expect(composer).toHaveAttribute('data-refracting', 'true')
  const bubble = page.locator('article[data-event-id="34"] [data-surface="bubble"]')
  evidence.bends = { composer: await bends(composer) }
  // The bevel's bend alone.
  expect(await bends(composer)).toEqual({ bends: 1, colours: 0 })
  // Content bends nothing at all (Q1 of the 液态玻璃组件统一 task book): it is only frosted.
  expect(await bubble.evaluate((element) => getComputedStyle(element).backdropFilter)).toMatch(
    /^blur\([\d.]+px\)$/,
  )

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
  // Any character's accent, in either theme, leaves white text at least 4.5:1 on the fill.
  const contrast = await page.evaluate(async () => {
    const accents = [
      '#3a6bd6',
      '#7fa4ff',
      '#2e8b57',
      '#6fd39a',
      '#c93c78',
      '#ff8fbf',
      '#b8860b',
      '#ffd166',
      '#0e9aa7',
      '#5fe0e8',
      '#7b4fd6',
      '#b79cff',
    ]
    const button = [...document.querySelectorAll('button')].find(
      (node) => node.textContent === '開啟對話框',
    )!
    const probe = document.createElement('span')
    button.append(probe)
    const canvas = document.createElement('canvas').getContext('2d')!
    const luminance = (css: string) => {
      canvas.fillStyle = '#000'
      canvas.fillStyle = css
      canvas.fillRect(0, 0, 1, 1)
      const [r, g, b] = [...canvas.getImageData(0, 0, 1, 1).data].map((value) => {
        const v = value / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const ratios: Record<string, number> = {}
    for (const accent of accents) {
      document.documentElement.style.setProperty('--accent', accent)
      probe.style.color = 'var(--tinted)'
      const fill = luminance(getComputedStyle(probe).color),
        text = luminance(getComputedStyle(button).color)
      ratios[accent] = (Math.max(fill, text) + 0.05) / (Math.min(fill, text) + 0.05)
    }
    probe.remove()
    document.documentElement.style.removeProperty('--accent')
    return ratios
  })
  evidence.tintedContrast = contrast
  for (const ratio of Object.values(contrast)) expect(ratio).toBeGreaterThanOrEqual(4.5)
})
