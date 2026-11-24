import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'
import { picture } from '../fixtures/pictures'
import { closeUps, enlarge, pixels, type Pixels } from '../fixtures/edges'

/*
 * The edges of the glass (docs/reports/2026-11-23-liquid-glass §15, the owner's review of the final:
 * "the edge's details fall short"). Failure cases, written before the edges were changed:
 *   1. the lit line breaks up around the glass: a straight side keeps under 0.55 of the brightest
 *      arc, or (on a 2x screen, where a corner has pixels enough to follow) somewhere along a corner
 *      the line fades below 0.45 of its brightest;
 *   2. on a 1x screen the line on a straight side is lost (lifts dark glass by under 48 levels);
 *   3. the bevel is one width on every size: the line on a 128pt folder is no wider than on a
 *      28pt button;
 *   4. no shade lies within the lit line, as on the iOS Dock and folders: the bevel 2–6pt in is not
 *      darker than the face by 4 levels on dark glass over a mid-grey page, 3 on light glass over
 *      white;
 *   5. the dark ring around light glass is two device pixels wide on a 2x screen (an outline rounded
 *      up to a whole CSS pixel), or darker than 42 levels on a 1x one;
 *   6. light spills outside the glass: anything a device pixel or more outside is brighter than
 *      the page beneath by more than 2 levels;
 *   7. a line bent across the bevel steps and breaks: the bevel's finest detail over a grid (99th
 *      percentile of each pixel's distance from its 3×3 mean) exceeds 2.3 levels on a pane, 9.5 on
 *      a held control;
 *   8. nothing joins the bent pixels again: no blur between the bevel's bend and the body's light.
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
  const lift = (profile: { depth: number; value: number }[]) =>
    Math.max(...profile.filter((point) => point.depth >= 0).map((point) => point.value)) - face
  return { face, top, arc, lift, topLift: lift(top), arcLifts: arc.map(lift) }
}

test.describe('the edges of the glass', () => {
  test.describe.configure({ timeout: 120000 })
  for (const scale of [1, 2])
    test.describe(`at ${scale}x`, () => {
      test.use({ deviceScaleFactor: scale })
      test('dark glass is lit all around, by a bevel as wide as the glass, shaded within', async ({
        page,
      }) => {
        const { glass, image } = await scene(page, 'dark', 'dark', scale)
        // The shade shows over a mid-grey page; over near-black there is little left to darken.
        const grey = await scene(page, 'dark', 'gray', scale)
        const found: Record<string, unknown> = {}
        for (const name of panes) {
          const edge = edges(image, glass[name]!),
            shaded = edges(grey.image, grey.glass[name]!)
          const inside = shaded.top.filter((point) => point.depth >= 2 && point.depth <= 6)
          const outside = edge.top.filter((point) => point.depth <= -1)
          const page = luminance(image, 2, 2)
          found[name] = {
            face: edge.face,
            top: edge.topLift,
            arc: edge.arcLifts,
            shade: Math.min(...inside.map((point) => point.value)) - shaded.face,
            spill: Math.max(...outside.map((point) => point.value)) - page,
            width: edge.top.filter(
              (point) => point.depth >= 0 && point.value - edge.face >= edge.topLift / 2,
            ).length,
          }
        }
        evidence[`dark-${scale}x`] = found
        for (const name of panes) {
          const measured = found[name] as {
            top: number
            arc: number[]
            shade: number
            spill: number
          }
          const brightest = Math.max(...measured.arc)
          // 1
          expect(
            measured.top,
            `${name}: straight side against the brightest arc`,
          ).toBeGreaterThanOrEqual(0.55 * brightest)
          if (scale === 2)
            expect(Math.min(...measured.arc), `${name}: around the corner`).toBeGreaterThanOrEqual(
              0.45 * brightest,
            )
          // 2
          if (scale === 1) expect(measured.top, name).toBeGreaterThanOrEqual(48)
          // 4
          expect(measured.shade, `${name}: shade within the line`).toBeLessThanOrEqual(-4)
          // 6
          expect(measured.spill, `${name}: outside`).toBeLessThanOrEqual(2)
        }
        // 3
        if (scale === 2)
          expect(
            (found.folder as { width: number }).width,
            'the folder bevel against the button',
          ).toBeGreaterThan((found.button as { width: number }).width)
      })

      test('light glass has a one-pixel ring and a shade within', async ({ page }) => {
        const { glass, image } = await scene(page, 'light', 'white', scale)
        const found: Record<string, unknown> = {}
        for (const name of panes) {
          const edge = edges(image, glass[name]!)
          const outside = edge.top.filter((point) => point.depth < 0)
          const inside = edge.top.filter((point) => point.depth >= 2 && point.depth <= 6)
          found[name] = {
            ring: outside.filter((point) => point.value - 255 <= -10).length,
            darkest: Math.min(...outside.map((point) => point.value)) - 255,
            shade: Math.min(...inside.map((point) => point.value)) - edge.face,
          }
        }
        evidence[`light-${scale}x`] = found
        for (const name of panes) {
          const measured = found[name] as { ring: number; darkest: number; shade: number }
          // 5
          expect(measured.ring, `${name}: ring`).toBe(1)
          if (scale === 1) expect(measured.darkest, name).toBeGreaterThanOrEqual(-42)
          // 4
          expect(measured.shade, `${name}: shade`).toBeLessThanOrEqual(-3)
        }
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
        // Within the bevel: from 1.5pt in to 0.45 of the radius.
        for (let i = Math.floor(y * 2); i < (y + height) * 2; i++)
          for (let j = Math.floor(x * 2); j < (x + width) * 2; j++) {
            const px = (j + 0.5) / 2 - x - width / 2,
              py = (i + 0.5) / 2 - y - height / 2
            const qx = Math.abs(px) - width / 2 + radius,
              qy = Math.abs(py) - height / 2 + radius
            const distance =
              Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
            if (distance > -1.5 || distance < -0.45 * radius) continue
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
      expect(order.slice(bend + 1, order.indexOf('feComposite', bend))).toContain('feGaussianBlur')
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
      await expect(thumb).toHaveAttribute('data-refracting', 'true')
      await page.waitForTimeout(700)
      await shoot(page, thumb, `slider-held-${theme}`)
      await page.mouse.up()
      await page.waitForTimeout(600)
      await page.getByRole('tab', { name: '連線', exact: true }).click()
      await page.getByRole('button', { name: '登出…', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toHaveAttribute('data-refracting', 'true')
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
