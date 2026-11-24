import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pairUI, systemOpaque, yukiFixture } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'
import { picture } from '../fixtures/pictures'
import { closeUps, enlarge, pixels, type Pixels } from '../fixtures/edges'

/*
 * The edges of the glass, to Liquid Glass as measured on iOS 26 (the owner's screenshots registered
 * against their own wallpapers; glass.ts). Failure cases, written before the glass was changed:
 *   1. the rim is not lit from the upper left by the measured law: the upper-right corner keeps
 *      more than 0.1 of the upper-left's light, (at 2x) the top is not 0.45–0.75 of it, a side not
 *      0.3–0.55, or the top no brighter than a side; on a 1x screen the top lifts dark glass by
 *      under 15 levels, or the brightest corner by over 80 (iOS: top +51–55, corners +72 at 3x,
 *      where the 1.2pt rim spans 4 pixels; at 1x one pixel averages it); over a pale page light glass's rim reaches white (253 or more);
 *   2. a ring lies around the glass: just outside it the page is darker than 3pt farther out by
 *      more than 1.5 levels; or light spills out (brighter by more than 2);
 *   3. a shade lies within the rim: 2–6pt in is darker than 7pt in by more than 1.5 levels;
 *   4. the rim takes the colour of what lies outside the edge, not of what the bend brings from
 *      inside: over orange outside and blue inside, the rim is not blue;
 *   5. the band does not mirror: over a ramp darkening toward the edge, the rim shows no deeper
 *      (brighter) a sample than 4pt in, by at least 8 levels; or past the fold the ramp does not
 *      resume; or a pane's bend at the rim is not iOS's 19.9pt (a map's full scale of 39.8);
 *   6. colours are parted: over a grey grid the 99th percentile of chroma in the band exceeds 4;
 *   7. a line bent across the band steps and breaks: the band's finest detail over a grid (99th
 *      percentile of each pixel's distance from its 3×3 mean) exceeds 2.3 levels on a pane, 9.5 on
 *      a held control;
 *   8. nothing joins the bent pixels again: no blur after the bend.
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
function edges(image: Pixels, glass: Glass) {
  const { x, y, width, radius } = glass,
    face = luminance(image, x + width / 2, y + glass.height / 2)
  const top = across(image, x + width / 2, y, 0, -1)
  // Around the upper-right corner, every ten degrees from the top to the right side.
  const arc = Array.from({ length: 10 }, (_, step) => {
    const angle = (step * Math.PI) / 18,
      nx = Math.sin(angle),
      ny = -Math.cos(angle)
    return across(image, x + width - radius + nx * radius, y + radius + ny * radius, nx, ny)
  })
  // And around the upper-left one, from the top to the left side.
  const left = Array.from({ length: 10 }, (_, step) => {
    const angle = (step * Math.PI) / 18,
      nx = -Math.sin(angle),
      ny = -Math.cos(angle)
    return across(image, x + radius + nx * radius, y + radius + ny * radius, nx, ny)
  })
  // The rim's light: its first 3pt, against the face.
  const lift = (profile: { depth: number; value: number }[]) =>
    Math.max(
      ...profile
        .filter((point) => point.depth >= 0 && point.depth <= 3)
        .map((point) => point.value),
    ) - face
  return {
    face,
    top,
    arc,
    lift,
    topLift: lift(top),
    arcLifts: arc.map(lift),
    leftLifts: left.map(lift),
  }
}

test.describe('the edges of the glass', () => {
  test.describe.configure({ timeout: 120000 })
  for (const scale of [1, 2])
    test.describe(`at ${scale}x`, () => {
      test.use({ deviceScaleFactor: scale })
      test('dark glass is lit from the upper left by the measured law, with no ring and no shade', async ({
        page,
      }) => {
        const { glass, image } = await scene(page, 'dark', 'dark', scale)
        // A shade shows over a mid-grey page; over near-black there is little left to darken.
        const grey = await scene(page, 'dark', 'gray', scale)
        const found: Record<
          string,
          { peak: number; across: number; top: number; side: number; shade: number; spill: number }
        > = {}
        for (const name of panes) {
          const edge = edges(image, glass[name]!),
            shaded = edges(grey.image, grey.glass[name]!)
          const { x, y, height } = glass[name]!
          const side = across(image, x, y + height / 2, -1, 0)
          const page = luminance(image, 2, 2)
          const past = shaded.top.find((point) => point.depth >= 7)!.value
          found[name] = {
            peak: Math.max(edge.leftLifts[4]!, edge.leftLifts[5]!),
            across: Math.max(edge.arcLifts[4]!, edge.arcLifts[5]!),
            top: edge.topLift,
            side: edge.lift(side),
            shade:
              Math.min(
                ...shaded.top
                  .filter((point) => point.depth >= 2 && point.depth <= 6)
                  .map((point) => point.value),
              ) - past,
            spill: Math.max(...edge.top.filter((p) => p.depth <= -1).map((p) => p.value)) - page,
          }
        }
        evidence[`dark-${scale}x`] = found
        for (const name of panes) {
          const { peak, across: anti, top, side, shade, spill } = found[name]!
          // 1
          expect(anti, `${name}: the upper right`).toBeLessThanOrEqual(0.1 * peak)
          // The corner's own share, on a screen with pixels enough to follow a corner.
          if (scale === 2) {
            expect(top / peak, `${name}: the top`).toBeGreaterThanOrEqual(0.45)
            expect(top / peak, `${name}: the top`).toBeLessThanOrEqual(0.75)
            expect(side / peak, `${name}: a side`).toBeGreaterThanOrEqual(0.3)
            expect(side / peak, `${name}: a side`).toBeLessThanOrEqual(0.55)
          }
          expect(top, `${name}: the top against a side`).toBeGreaterThan(side)
          if (scale === 1) {
            expect(top, `${name}: the top`).toBeGreaterThanOrEqual(15)
            expect(peak, `${name}: the brightest corner`).toBeLessThanOrEqual(80)
          }
          // 2
          expect(spill, `${name}: outside`).toBeLessThanOrEqual(2)
          // 3
          expect(shade, `${name}: no shade within`).toBeGreaterThanOrEqual(-1.5)
        }
      })

      test('light glass has no ring and no shade, and its rim never clips', async ({ page }) => {
        // 1: over a pale page the brightest of the rim stays short of white.
        const pale = await scene(page, 'light', 'pale', scale)
        const brightest: Record<string, number> = {}
        for (const name of panes) {
          const edge = edges(pale.image, pale.glass[name]!)
          brightest[name] = Math.max(
            ...[edge.top, ...edge.arc]
              .flat()
              .filter((point) => point.depth >= 0 && point.depth <= 3)
              .map((point) => point.value),
          )
        }
        evidence[`pale-${scale}x`] = brightest
        for (const name of panes) expect(brightest[name], `${name}: brightest`).toBeLessThan(253)
        const { glass, image } = await scene(page, 'light', 'white', scale)
        const found: Record<string, { ring: number; shade: number }> = {}
        for (const name of panes) {
          const edge = edges(image, glass[name]!)
          const outside = edge.top.filter((point) => point.depth < 0)
          // Against the page 3pt out: the pane's soft shadow darkens it slowly; a ring is steep.
          const page = outside[0]!.value
          const past = edge.top.find((point) => point.depth >= 7)!.value
          found[name] = {
            ring: Math.min(...outside.map((point) => point.value)) - page,
            shade:
              Math.min(
                ...edge.top
                  .filter((point) => point.depth >= 2 && point.depth <= 6)
                  .map((point) => point.value),
              ) - past,
          }
        }
        evidence[`light-${scale}x`] = found
        for (const name of panes) {
          // 2, 3
          expect(found[name]!.ring, `${name}: no ring`).toBeGreaterThanOrEqual(-1.5)
          expect(found[name]!.shade, `${name}: no shade within`).toBeGreaterThanOrEqual(-1.5)
        }
      })
    })

  test.describe('in colour and depth', () => {
    test.use({ deviceScaleFactor: 2 })
    test('the rim keeps the colour the bend brings from inside', async ({ page }) => {
      const found: Record<string, unknown> = {}
      for (const theme of ['light', 'dark'] as const) {
        const { glass, image } = await scene(page, theme, 'band', 2)
        const { x, y, width } = glass.composer!
        const rgb = (px: number, py: number) => {
          const k = (Math.floor(py * 2) * image.width + Math.floor(px * 2)) * 4
          return [image.rgba[k]!, image.rgba[k + 1]!, image.rgba[k + 2]!] as const
        }
        // Along the top, away from the corners: the outermost device pixel of the rim.
        const rim = rgb(x + width / 2, y + 0.25),
          outside = rgb(x + width / 2, y - 3)
        found[theme] = { rim, outside }
        // 4: blue (inside), not orange (outside).
        expect(rim[2] - rim[0], `${theme}: a blue rim`).toBeGreaterThan(0)
        expect(outside[0] - outside[2], `${theme}: orange outside`).toBeGreaterThan(0)
      }
      evidence.colour = found
    })

    test('the band mirrors what lies just inside and parts no colours', async ({ page }) => {
      // 5: a ramp, dark at the top: deeper is brighter.
      const ramp = await scene(page, 'light', 'ramp', 2)
      const { x, y, width } = ramp.glass.composer!
      const at = (d: number) => luminance(ramp.image, x + width / 2, y + d)
      const profile = [0.25, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((d) => [d, at(d)] as const)
      evidence.ramp = profile
      expect(at(0.25) - at(4), 'the rim shows a deeper sample than 4pt in').toBeGreaterThanOrEqual(
        8,
      )
      expect(at(12), 'past the fold the ramp resumes').toBeGreaterThan(at(7))
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
          2 * 21.1 * (1 - Math.exp(-7.5 / 2.62)),
          0,
        )

      // 6: over a grey grid, no colour is parted in the band.
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
            if (distance > -1.5 || distance < -7.5) continue
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
  })

  test.describe('bent over a grid', () => {
    test.use({ deviceScaleFactor: 2 })
    test('a line bent across the bevel stays smooth', async ({ page }) => {
      const { glass, image } = await scene(page, 'light', 'grid', 2)
      const found: Record<string, number> = {}
      for (const name of [...panes.filter((name) => name !== 'sheet'), 'segment']) {
        const { x, y, width, height, radius } = glass[name]!
        const band: number[] = []
        // Within the band: from 1.5pt in to 7.5pt (a held control's: 0.45 of its radius).
        const deepest = name === 'segment' ? 0.45 * radius : 7.5
        for (let i = Math.floor(y * 2); i < (y + height) * 2; i++)
          for (let j = Math.floor(x * 2); j < (x + width) * 2; j++) {
            const px = (j + 0.5) / 2 - x - width / 2,
              py = (i + 0.5) / 2 - y - height / 2
            const qx = Math.abs(px) - width / 2 + radius,
              qy = Math.abs(py) - height / 2 + radius
            const distance =
              Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
            if (distance > -1.5 || distance < -deepest) continue
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
        expect(detail, name).toBeLessThanOrEqual(name === 'segment' ? 9.5 : 2.3)
      // 8
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
    await page
      .getByRole('radiogroup', { name: '對話背景', exact: true })
      .getByRole('radio', { name: '自訂圖片', exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await chat('lineart')
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
