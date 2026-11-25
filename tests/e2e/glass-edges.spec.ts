import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pairUI, systemOpaque, yukiFixture } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'
import { picture } from '../fixtures/pictures'
import { closeUps, enlarge, pixels, type Pixels } from '../fixtures/edges'

/*
 * The glass, to the macOS Dock's as measured on this Mac (Apple's own glass filter fitted to the
 * real Dock, then the Dock's edge measured; glass.ts). Failure cases, written before the glass was
 * changed:
 *   1. the face is not the Dock's tone of what lies behind it: over flat greys of 21, 128 and 255
 *      the face is not 11 + 0.919·B − 0.000992·B² (dark) or 48.4 + 0.695·B (light) within 2.5
 *      levels: a tint, a fill or a lift is still laid on, or a brightness filter;
 *   2. anything is drawn outside the glass: within 4pt of its edge the page differs from the page
 *      farther out by more than 1 level (a hairline, a ring, a shadow);
 *   3. the band does not mirror what lies inside as the Dock's lens does: over a ramp darkening
 *      toward the edge the rim shows no deeper (brighter) a sample than 6pt in, by at least 8
 *      levels; past the band (13pt) the ramp does not resume; or a pane's bend at the rim is not
 *      the Dock's 24.5pt (a map's full scale of 49.0);
 *   4. the rim is not the real Dock's (dock.ts), out = (1 − a)·face + c, the same on red, green
 *      and blue (so it keeps the colour within), within 5 levels at the outermost device pixel:
 *      the top and bottom brighten, dark as a screen (a 0.33, c +76: over the dark page 66 over
 *      the face, over mid grey only 39), light by +65 nearly alone (a 0.04); a side mixes toward
 *      black, 36% dark (c −3.5) or 26% light (c −13); 7pt in more than 2.5 from the face (a
 *      sheet's shadow nearby shades the page a little); over blue inside an orange outside, the
 *      top rim is not blue;
 *   4a. the rim is as thick as the Dock's own rather than thinner (dock.ts): the bright band is
 *      more than the outermost device pixel (the next one, 0.5pt in at 2x, keeps half of its lift
 *      or more), or the tail within still adds more than 2.5 levels 2.25pt in (the Dock's adds
 *      about 11 there) on a pane, or 1.25pt in on a control of 28pt;
 *   5. colours are parted: over a grey grid the 99th percentile of chroma in the band exceeds 4;
 *   6. a line bent across the band steps and breaks: the band's finest detail over a grid (99th
 *      percentile of each pixel's distance from its 3×3 mean) exceeds 2.6 levels on a pane, 9.5 on
 *      a held control;
 *   7. nothing joins the bent pixels again: no smoothing after the bend.
 * The real app's close-ups (6x: the sidebar's pane, toolbar, composer, sheet, the held slider and
 * the segmented control, light, dark and over a line-art backdrop) are written as the test's output.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('glass-edges.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

const answerWith = (app: ElectronApplication, path: string) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, path)

// As large as 1100 by 760 where the screen allows, at the window's own pixels: a close-up is cut from
// a screenshot, which an emulated size larger than the window would not hold.
async function windowSize(app: ElectronApplication, page: Page) {
  const area = await app.evaluate(
    ({ BrowserWindow, screen }) =>
      screen.getDisplayMatching(BrowserWindow.getAllWindows()[0]!.getBounds()).workArea,
  )
  await contentSize(app, page, Math.min(1100, area.width), Math.min(760, area.height - 40))
}

// The page reads its preferences when it starts: written from outside, it is reloaded to show them,
// at the size it had.
async function themed(app: ElectronApplication, page: Page, theme: 'light' | 'dark') {
  if ((await page.locator(`html[data-theme="${theme}"]`).count()) === 0) {
    await page.evaluate((theme) => window.yuki.preferences({ theme }), theme)
    await page.reload()
    await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
    await windowSize(app, page)
    await page.addStyleTag({ content: ':root { background: var(--bg-window) !important }' })
  }
  await page.waitForTimeout(800)
}

async function shoot(page: Page, element: Locator, name: string) {
  // Absent, or (as a sidebar folded away on a small screen) not wholly in the window.
  const shown = await element
    .evaluate(
      (node) => {
        const { left, top, right, bottom } = node.getBoundingClientRect()
        return right > left && left >= 0 && top >= 0 && right <= innerWidth && bottom <= innerHeight
      },
      undefined,
      { timeout: 3000 },
    )
    .catch(() => false)
  if (!shown) return void (evidence[name] = 'absent')
  evidence[name] = (await closeUps(page, element, name)).shape
  await element.screenshot({ path: test.info().outputPath(`${name}-whole.png`) })
}

interface Glass {
  name: string
  x: number
  y: number
  width: number
  height: number
  radius: number
}
const panes = ['button', 'toolbar', 'composer', 'card', 'sheet', 'folder']
// The Dock's glass: every pane but a sheet (which opens over the page, thicker, to be read).
const docked = panes.filter((name) => name !== 'sheet')
// The Dock's tone over grey, in levels (dock.ts): light 48.4 + 0.695·Y, dark 11 + 0.919·Y −
// 0.000992·Y².
const tone = {
  light: (y: number) => 48.4 + 0.695 * y,
  dark: (y: number) => 11 + 0.919 * y - 0.000992 * y * y,
} as const

async function scene(page: Page, theme: 'light' | 'dark', background: string, scale: number) {
  await page.setViewportSize({ width: 800, height: 520 })
  await page.goto(
    `http://127.0.0.1:4178/glass-edges.html?scene=set&theme=${theme}&bg=${background}&scale=${scale}`,
  )
  await expect(page.locator('html[data-ready]')).toBeAttached()
  await page.mouse.move(-10, -10)
  await page.waitForTimeout(600)
  const glass: Glass[] = await page.locator('[data-name]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect()
      return {
        name: (node as HTMLElement).dataset.name!,
        x,
        y,
        width,
        height,
        radius: parseFloat(getComputedStyle(node).borderTopLeftRadius),
      }
    }),
  )
  const image = await pixels(page, { x: 0, y: 0, width: 800, height: 520 })
  await enlarge(
    page,
    image,
    1,
    test.info().outputPath(`scene-${background}-${theme}-${scale}x.png`),
  )
  return { glass: Object.fromEntries(glass.map((item) => [item.name, item])), image }
}

// Luminance at a point given in CSS pixels.
const luminance = (image: Pixels, x: number, y: number) => {
  const i = Math.floor(y * image.scale),
    j = Math.floor(x * image.scale),
    k = (i * image.width + j) * 4
  return 0.2126 * image.rgba[k]! + 0.7152 * image.rgba[k + 1]! + 0.0722 * image.rgba[k + 2]!
}
// Across the edge, a device pixel at a time, from `from` outside to `to` inside along the normal
// (nx, ny) out of the point (x, y) on the edge.
function across(image: Pixels, x: number, y: number, nx: number, ny: number, from = 3, to = 10) {
  const values: { depth: number; value: number }[] = []
  for (let depth = -from; depth <= to; depth += 1 / image.scale) {
    const at = depth + 0.5 / image.scale
    values.push({ depth, value: luminance(image, x - nx * at, y - ny * at) })
  }
  return values
}
test.describe('the edges of the glass', () => {
  test.describe.configure({ timeout: 120000 })
  test.use({ deviceScaleFactor: 2 })
  for (const theme of ['dark', 'light'] as const)
    test(`${theme} glass is the Dock's: its tone, nothing outside, and its rim`, async ({
      page,
    }) => {
      const found: Record<string, unknown> = {}
      // 1, 2
      for (const [background, level] of [
        ['dark', 0x15],
        ['gray', 128],
        ['white', 255],
      ] as const) {
        const { glass, image } = await scene(page, theme, background, 2)
        for (const name of docked) {
          const { x, y, width, height } = glass[name]!
          const face = luminance(image, x + width / 2, y + height / 2)
          // The page within 4pt of the left edge (away from the sheet's shadow), against the
          // page 8pt out.
          const profile = across(image, x, y + height / 2, -1, 0, 8, 0),
            ground = profile[0]!.value
          const drawn = Math.max(
            ...profile
              .filter((point) => point.depth >= -4 && point.depth < 0)
              .map((point) => Math.abs(point.value - ground)),
          )
          found[`${background} ${name}`] = { face, drawn }
          expect
            .soft(face, `${theme} over ${level}: ${name}'s face`)
            .toBeCloseTo(tone[theme](level), -0.7)
          expect.soft(drawn, `${theme} over ${level}: ${name} draws outside`).toBeLessThanOrEqual(1)
        }
      }
      // 4: over the dark page and mid grey, the rim against the face, in levels: what the law
      // gives, (1 − a)·face + c, less the face.
      const law = {
        dark: { top: [0.33, 76], side: [0.36, -3.5] },
        light: { top: [0.04, 65], side: [0.26, -13] },
      }[theme]
      const over = (face: number, [a, c]: number[]) => (1 - a!) * face + c! - face
      for (const background of ['dark', 'gray'] as const) {
        const lit = await scene(page, theme, background, 2)
        for (const name of docked) {
          const { x, y, width, height } = lit.glass[name]!
          const face = luminance(lit.image, x + width / 2, y + height / 2)
          const at = (px: number, py: number) => luminance(lit.image, px, py) - face
          const rim = {
            top: at(x + width / 2, y + 0.25),
            bottom: at(x + width / 2, y + height - 0.25),
            side: at(x + 0.25, y + height / 2),
            next: at(x + width / 2, y + 0.75),
            tail: at(x + width / 2, y + (height <= 28 ? 1.25 : 2.25)),
            past: at(x + width / 2, y + 7),
          }
          found[`rim ${background} ${name}`] = { face, ...rim }
          const where = `${theme} over ${background}, ${name}`
          expect.soft(rim.top, `${where}: the top`).toBeCloseTo(over(face, law.top), -1)
          expect.soft(rim.bottom, `${where}: the bottom`).toBeCloseTo(over(face, law.top), -1)
          expect.soft(rim.side, `${where}: a side`).toBeCloseTo(over(face, law.side), -1)
          // 4a. (Against 7pt in, as a sheet's shadow nearby shades the folder's face a little.)
          expect.soft(rim.next, `${where}: one device pixel`).toBeLessThan(0.5 * rim.top)
          expect
            .soft(Math.abs(rim.tail - rim.past), `${where}: the top's tail`)
            .toBeLessThanOrEqual(2.5)
          expect.soft(Math.abs(rim.past), `${where}: past the rim`).toBeLessThanOrEqual(2.5)
        }
      }
      // 4: the rim keeps the colour the lens brings from inside.
      const band = await scene(page, theme, 'band', 2)
      const { x, y, width } = band.glass.composer!
      const k =
        (Math.floor((y + 0.25) * 2) * band.image.width + Math.floor((x + width / 2) * 2)) * 4
      const rim = [band.image.rgba[k]!, band.image.rgba[k + 1]!, band.image.rgba[k + 2]!]
      found.colour = rim
      expect.soft(rim[2]! - rim[0]!, `${theme}: a blue rim`).toBeGreaterThan(0)
      evidence[`dock-${theme}`] = found
    })

  test("the band mirrors what lies just inside, to the Dock's depth, and parts no colours", async ({
    page,
  }) => {
    // 3: a ramp, dark at the top: deeper is brighter.
    const ramp = await scene(page, 'light', 'ramp', 2)
    const { x, y, width } = ramp.glass.composer!
    const at = (d: number) => luminance(ramp.image, x + width / 2, y + d)
    const profile = [0.25, 1, 2, 3, 4, 6, 8, 10, 12, 13, 14, 16].map((d) => [d, at(d)] as const)
    evidence.ramp = profile
    expect(at(0.25) - at(6), 'the rim shows a deeper sample than 6pt in').toBeGreaterThanOrEqual(8)
    expect(at(16), 'past the band the ramp resumes').toBeGreaterThan(at(13))
    const spans = await page.locator('[data-name]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const id = getComputedStyle(node).backdropFilter.match(/#(yuki-glass-[^")]+)/)?.[1]
        const map = id && document.getElementById(id)!.querySelector('feDisplacementMap')
        return {
          name: (node as HTMLElement).dataset.name!,
          span: map ? Number(map.getAttribute('scale')) : 0,
        }
      }),
    )
    evidence.spans = spans
    for (const { name, span } of spans.filter((item) => panes.includes(item.name)))
      expect(span, `${name}: the map's full scale`).toBeCloseTo(
        2 * 25.5 * (1 - Math.exp(-13 / 4)),
        0,
      )

    // 5: over a grey grid, no colour is parted in the band.
    const { glass, image } = await scene(page, 'light', 'grid', 2)
    const found: Record<string, number> = {}
    for (const name of ['composer', 'card', 'folder']) {
      const { x, y, width, height, radius } = glass[name]!
      const chroma: number[] = []
      for (let i = Math.floor(y * 2); i < (y + height) * 2; i++)
        for (let j = Math.floor(x * 2); j < (x + width) * 2; j++) {
          const px = (j + 0.5) / 2 - x - width / 2,
            py = (i + 0.5) / 2 - y - height / 2
          const qx = Math.abs(px) - width / 2 + radius,
            qy = Math.abs(py) - height / 2 + radius
          const distance =
            Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
          if (distance > -1.5 || distance < -13) continue
          const k = (i * image.width + j) * 4,
            rgb = [image.rgba[k]!, image.rgba[k + 1]!, image.rgba[k + 2]!]
          chroma.push(Math.max(...rgb) - Math.min(...rgb))
        }
      chroma.sort((a, b) => a - b)
      found[name] = chroma[Math.floor(0.99 * chroma.length)]!
    }
    evidence.chroma = found
    for (const [name, value] of Object.entries(found))
      expect(value, `${name}: no parted colours`).toBeLessThanOrEqual(4)
  })

  test.describe('bent over a grid', () => {
    test.use({ deviceScaleFactor: 2 })
    test('a line bent across the bevel stays smooth', async ({ page }) => {
      const { glass, image } = await scene(page, 'light', 'grid', 2)
      const found: Record<string, number> = {}
      for (const name of [...panes.filter((name) => name !== 'sheet'), 'segment']) {
        const { x, y, width, height, radius } = glass[name]!
        const band: number[] = []
        // Within the band, past the rim and its tail (gone by 2.25pt: dock.ts): from 2.5pt in to
        // 13pt (a held control's: from 2pt to 0.45 of its radius).
        const [shallowest, deepest] = name === 'segment' ? [2, 0.45 * radius] : [2.5, 13]
        for (let i = Math.floor(y * 2); i < (y + height) * 2; i++)
          for (let j = Math.floor(x * 2); j < (x + width) * 2; j++) {
            const px = (j + 0.5) / 2 - x - width / 2,
              py = (i + 0.5) / 2 - y - height / 2
            const qx = Math.abs(px) - width / 2 + radius,
              qy = Math.abs(py) - height / 2 + radius
            const distance =
              Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
            if (distance > -shallowest || distance < -deepest) continue
            let sum = 0
            for (let di = -1; di <= 1; di++)
              for (let dj = -1; dj <= 1; dj++)
                sum += luminance(image, (j + dj + 0.5) / 2, (i + di + 0.5) / 2)
            band.push(Math.abs(luminance(image, (j + 0.5) / 2, (i + 0.5) / 2) - sum / 9))
          }
        band.sort((a, b) => a - b)
        found[name] = band[Math.floor(0.99 * band.length)]!
      }
      evidence.bent = found
      // 7
      for (const [name, detail] of Object.entries(found))
        // (The rim's tail falls a few levels across the band, which this counts too.)
        expect(detail, name).toBeLessThanOrEqual(name === 'segment' ? 9.5 : 2.6)
      // 7: a half pixel's blur after the bend.
      const order = await page.locator('[data-name="card"]').evaluate((element) => {
        const id = getComputedStyle(element).backdropFilter.match(/#([^")]+)/)![1]!
        return [...document.getElementById(id)!.children].map((node) => node.localName)
      })
      const bend = order.lastIndexOf('feDisplacementMap')
      expect(order.slice(bend + 1)).toContain('feGaussianBlur')
    })
  })
})

test('glass edges in the real app', async () => {
  test.setTimeout(600000)
  const rig = await yukiFixture(),
    app = await rig.launch('glass-edges')
  let success = false
  try {
    const page = await app.firstWindow()
    await windowSize(app, page)
    const opaque = await systemOpaque(page)
    await page.addStyleTag({ content: ':root { background: var(--bg-window) !important }' })
    // The largest glass in the window: the sidebar's pane (macOS; elsewhere it lies flush).
    for (const theme of ['light', 'dark'] as const) {
      await themed(app, page, theme)
      await shoot(page, page.locator('[data-region="sidebar"]'), `sidebar-${theme}`)
    }
    await pairUI(page, rig.base, await rig.code())
    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
    })
    for (const text of [
      '幫我整理一下這週的訪談筆記，重點放在使用者對新版工作流程的回饋。',
      'Liquid Glass bends light at its edges, so the content beneath stays legible.',
    ]) {
      await composer.fill(text)
      await page.getByRole('button', { name: '送出', exact: true }).click()
      await expect(page.getByText(text, { exact: true })).toBeVisible()
    }
    await windowSize(app, page)
    // The theme is chosen in Appearance, as a person would: the page does not hear a preference
    // written behind its back once it has saved its own.
    const appearance = async (theme: 'light' | 'dark') => {
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radiogroup', { name: '主題', exact: true })
        .getByRole('radio', { name: theme === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
    }
    const chat = async (background: string) => {
      for (const theme of ['light', 'dark'] as const) {
        if (background === 'builtin') await themed(app, page, theme)
        else {
          await page.keyboard.press('ControlOrMeta+,')
          await appearance(theme)
          await page.getByRole('button', { name: '返回', exact: true }).click()
          await page.waitForTimeout(800)
        }
        await shoot(
          page,
          page.locator('[data-region="composer"]'),
          `composer-${background}-${theme}`,
        )
        await shoot(
          page,
          page.locator('[data-region="toolbar"] [data-glass="toolbar"]').first(),
          `toolbar-${background}-${theme}`,
        )
      }
    }
    await chat('builtin')

    await page.keyboard.press('ControlOrMeta+,')
    for (const theme of ['light', 'dark'] as const) {
      await appearance(theme)
      await page.waitForTimeout(800)
      const visible = (selector: string) => page.locator(selector).filter({ visible: true }).first()
      await shoot(page, visible('[data-glass="segment"]'), `segment-${theme}`)
      await shoot(page, visible('[data-glass="toggle"]'), `toggle-${theme}`)
      const thumb = page.locator('[data-glass="slider"]').first()
      await thumb.scrollIntoViewIfNeeded()
      const box = (await thumb.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      // A system that reduces transparency (as CI's macOS does) shows no glass at all.
      if (!opaque) await expect(thumb).toHaveAttribute('data-refracting', 'true')
      await page.waitForTimeout(700)
      await shoot(page, thumb, `slider-held-${theme}`)
      await page.mouse.up()
      await page.waitForTimeout(600)
      await page.getByRole('tab', { name: '連線', exact: true }).click()
      await page.getByRole('button', { name: '登出…', exact: true }).click()
      const dialog = page.getByRole('dialog')
      if (opaque) await expect(dialog).toBeVisible()
      else await expect(dialog).toHaveAttribute('data-refracting', 'true')
      await page.waitForTimeout(900)
      await shoot(page, dialog, `sheet-${theme}`)
      await shoot(
        page,
        dialog.locator('button').filter({ visible: true }).first(),
        `sheet-button-${theme}`,
      )
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }

    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const lineart = join(test.info().outputPath(), 'lineart.png')
    await writeFile(lineart, await picture(page, 'lineart'))
    await answerWith(app, lineart)
    await page.getByRole('button', { name: '加入圖片…', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await chat('lineart')
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
