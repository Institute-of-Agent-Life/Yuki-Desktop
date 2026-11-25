import { paneBlur, sizedGlass } from '../fixtures/dock-glass'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { pairUI, systemOpaque, yukiFixture } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'

/*
 * 液態玻璃 final（docs/reports/2026-11-23-liquid-glass §15, phase 1: the material only).
 * Failure cases, written before the material was changed:
 *   1. a pane bends before it blurs (the old order), so the blur's soft shapes are not melted;
 *   2. (as revised by the iOS 26 measurement, glass.ts) the face is not lifted evenly by about 20
 *      levels after the bend, or the rim's light is not added on top of what the bend shows;
 *   3. a pane still disperses: colour matrices, or more than one bend drawn from the same map;
 *   4. a bend map is coarser than 2x, so a strong bend steps into dashed rings;
 *   5. text panes (composer, cards, sheets) take the clear glass's tint and lose their text;
 *   6. a plain pane keeps the old frosted tint or blur instead of the final one;
 *   7. without GPU compositing the glass still bends (costly), or loses its blur, tint or rim;
 *   8. with GPU compositing the glass does not bend;
 *   9. in software compositing the glass makes a frame several times dearer than the page alone
 *      (on a desktop machine: longer than 16.7ms at the 95th percentile), or paints maps while
 *      content scrolls beneath it;
 *  10. making the maps blocks the page for more than 100ms.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('glass-material.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

// The macOS Dock's glass (materials/dock.ts): a little blur on a control (a pane carrying text is
// blurred by its size: paneBlur), and no tint of its own.
const final = {
  light: { blur: '2px', tint: 0, text: 0 },
  dark: { blur: '2px', tint: 0, text: 0 },
} as const

const alpha = (colour: string) => Number(colour.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/)?.[1] ?? 1)

// The filter a pane refracts through, read back as plain data.
function readFilter(element: HTMLElement) {
  const backdrop = getComputedStyle(element).backdropFilter
  const id = backdrop.match(/url\("?#([^")]+)"?\)/)?.[1]
  const filter = id ? document.getElementById(id) : null
  const nodes = filter ? [...filter.children] : []
  return {
    backdrop,
    refract: element.style.getPropertyValue('--refract'),
    background: getComputedStyle(element).backgroundColor,
    primitives: nodes.map((node) => ({
      name: node.localName,
      result: node.getAttribute('result'),
      in: node.getAttribute('in'),
      in2: node.getAttribute('in2'),
      operator: node.getAttribute('operator'),
      k1: node.getAttribute('k1'),
      k3: Number(node.getAttribute('k3')),
      k4: Number(node.getAttribute('k4')),
      table: node.querySelector('feFuncR')?.getAttribute('tableValues') ?? null,
      scale: Number(node.getAttribute('scale')),
      inputs: [...node.querySelectorAll('feMergeNode')].map((merge) => merge.getAttribute('in')),
    })),
    images: nodes
      .filter((node) => node.localName === 'feImage')
      .map((node) => ({
        result: node.getAttribute('result'),
        href: node.getAttribute('href') ?? '',
        width: Number(node.getAttribute('width')),
        height: Number(node.getAttribute('height')),
      })),
  }
}
type Filter = ReturnType<typeof readFilter>

async function imageSizes(page: Page, hrefs: string[]) {
  return page.evaluate(
    (sources) =>
      Promise.all(
        sources.map(async (source) => {
          const image = new Image()
          image.src = source
          await image.decode()
          return [image.naturalWidth, image.naturalHeight] as const
        }),
      ),
    hrefs,
  )
}

async function expectFinalGlass(
  page: Page,
  pane: Locator,
  theme: 'light' | 'dark',
  text: boolean,
  // Panes that open over the page blur it, and tint themselves, until its text cannot be read
  // through theirs.
  sheet?: { blur: string; tint: number },
) {
  // A pane that carries text is blurred as Apple's clear glass of its size; a control, the Dock's.
  const [kind, width, height] = await pane.evaluate((node: HTMLElement) => [
    node.dataset.glass ?? '',
    node.offsetWidth,
    node.offsetHeight,
  ])
  const blur =
    sheet?.blur ??
    (sizedGlass.includes(kind as string)
      ? paneBlur(width as number, height as number)
      : final[theme].blur)
  const filter: Filter = await pane.evaluate(readFilter)
  const look = final[theme]
  // 1: blurred first, then bent, then given the Dock's colour, then lit.
  expect(filter.backdrop).toMatch(new RegExp(`^blur\\(${blur}\\) url\\(`))
  const primitives = filter.primitives
  // 3: no dispersion: one bend, reading the map put together from its across and down.
  const bends = primitives.filter((node) => node.name === 'feDisplacementMap')
  expect(bends.length).toBe(1)
  expect(bends[0]!.in2).toBe('bevel')
  // 2: the Dock's colour after the bend: each channel tone(Y) + g·(C − Y), the curve less g·Y in
  // a table on the luminance; over grey 128 the tone gives 112.4 in dark (11 + 0.919·Y −
  // 0.000992·Y²) and 137.4 in light (48.4 + 0.695·Y). Then the rim (dock.ts): mixed toward black
  // by the map's share kept, and its levels added.
  const toned = primitives.find((node) => node.result === 'toned')!,
    curve = primitives.find((node) => node.result === toned.in)!
  const lifted = Number(curve.table!.split(' ')[128]) * 255 + toned.k4 * 255
  expect(lifted + toned.k3 * 128).toBeCloseTo(theme === 'dark' ? 112.4 : 137.4, 0)
  expect(toned.k3).toBe(theme === 'dark' ? 1.08 : 1.2)
  const mixed = primitives.find(
    (node) => node.name === 'feComposite' && node.operator === 'arithmetic' && node.in === 'toned',
  )
  expect(mixed?.in2, 'the rim mixes the toned bend').toBe('kept')
  const rim = primitives.find(
    (node) => node.name === 'feComposite' && node.operator === 'arithmetic' && node.in2 === 'mixed',
  )
  expect(rim?.in, 'the rim laid on the mixed bend').toBe('rimGrey')
  // 4: the maps are assembled from pieces painted at no less than 2x: each piece is at least twice
  // its CSS size, except a strip one CSS pixel wide stretched along a straight edge.
  const pieces = filter.images
  expect(pieces.length).toBeGreaterThan(0)
  const sizes = await imageSizes(
    page,
    pieces.map((piece) => piece.href),
  )
  pieces.forEach((piece, index) => {
    const [width, height] = sizes[index]!
    for (const [natural, css] of [
      [width, piece.width],
      [height, piece.height],
    ] as const)
      if (natural !== 2) expect(natural, piece.result!).toBeGreaterThanOrEqual(2 * css - 0.5)
  })
  // 5, 6: the final tints.
  expect(alpha(filter.background)).toBeCloseTo(sheet?.tint ?? (text ? look.text : look.tint), 2)
  return filter
}

async function openConversation(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme)
}

test.describe('at 1x', () => {
  test.use({ deviceScaleFactor: 1 })
  for (const theme of ['light', 'dark'] as const)
    test(`every pane is the final glass in the ${theme} theme`, async ({ page }) => {
      await page.setViewportSize({ width: 1100, height: 760 })
      await openConversation(page, theme)
      const composer = page.locator('[data-region="composer"]'),
        toolbar = page.locator('[data-region="toolbar"] [data-glass="toolbar"]').first()
      await expect(composer).toHaveAttribute('data-refracting', 'true')
      await expect(toolbar).toHaveAttribute('data-refracting', 'true')
      evidence[`composer-${theme}`] = await expectFinalGlass(page, composer, theme, true)
      evidence[`toolbar-${theme}`] = await expectFinalGlass(page, toolbar, theme, false)
      await page.screenshot({ path: test.info().outputPath(`conversation-${theme}.png`) })

      await page.goto('http://127.0.0.1:4178/components.html')
      await page
        .getByRole('radio', { name: theme === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      await page.getByRole('button', { name: '開啟對話框', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toHaveAttribute('data-refracting', 'true')
      evidence[`sheet-${theme}`] = await expectFinalGlass(page, dialog, theme, true, {
        blur: '32px',
        tint: theme === 'light' ? 0.5 : 0.74,
      })
    })
})

// 9, 10: content scrolls under the composer and toolbar for three seconds. Headless Chromium
// composites in software, as a machine without GPU compositing would; the compositor's time per
// frame is Display::DrawAndSwap, where backdrop filters are drawn. Measured three ways in one run
// on the same machine: no glass (opaque), the glass without its bend (what a machine without GPU
// compositing is given) and the final glass, so a slow runner slows all three alike.
async function scrolling(page: Page, mode: 'none' | 'fallback' | 'final') {
  await page.addInitScript((mode) => {
    const state = window as unknown as { long: number[]; maps: number }
    state.long = []
    state.maps = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.long.push(entry.duration)
    }).observe({ type: 'longtask', buffered: true })
    const url = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof url>
    ) {
      state.maps++
      return url.apply(this, args)
    }
    // Before the page's own scripts run, once the parsed <html> exists (an init script runs
    // before it is parsed, on an element the parser then replaces).
    if (mode === 'fallback')
      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'interactive')
          document.documentElement.dataset.gpuCompositing = 'false'
      })
  }, mode)
  await page.setViewportSize({ width: 1200, height: 640 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate((mode) => {
    document.documentElement.dataset.backdrop = 'aurora'
    if (mode === 'none') document.documentElement.dataset.opaque = 'true'
  }, mode)
  const composer = page.locator('[data-region="composer"]')
  if (mode === 'none') await expect(composer).toHaveCSS('backdrop-filter', 'none')
  else await expect(composer).toHaveAttribute('data-refracting', 'true')
  await page.waitForTimeout(600)
  const log = page.locator('[role="log"]').first()
  // Enough to scroll: the conversation's own messages, repeated under the glass.
  await log.evaluate((element) => {
    const rows = [...element.children]
    for (let copy = 0; copy < 6; copy++) for (const row of rows) element.append(row.cloneNode(true))
  })
  await page.waitForTimeout(300)
  // Counted from here on: what scrolling costs, not opening the page.
  const [maps, long] = await page.evaluate(() => {
    const state = window as unknown as { long: number[]; maps: number }
    return [state.maps, state.long.length]
  })
  const browser = page.context().browser()!,
    output = test.info().outputPath()
  await mkdir(output, { recursive: true })
  const trace = join(output, `trace-${mode}.json`)
  await browser.startTracing(page, { path: trace, categories: ['viz', 'gpu', 'cc'] })
  await log.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const start = performance.now(),
          range = element.scrollHeight - element.clientHeight
        const step = (now: number) => {
          const t = (now - start) / 3000
          element.scrollTop = range * (0.5 - 0.5 * Math.cos(t * Math.PI * 4))
          if (t < 1) requestAnimationFrame(step)
          else resolve()
        }
        requestAnimationFrame(step)
      }),
  )
  await browser.stopTracing()
  const draws = (
    JSON.parse(await readFile(trace, 'utf8')) as {
      traceEvents: { name: string; ph: string; dur?: number }[]
    }
  ).traceEvents
    .filter((event) => event.name === 'Display::DrawAndSwap' && event.ph === 'X')
    .map((event) => event.dur! / 1000)
    .sort((a, b) => a - b)
  const at = (q: number) => draws[Math.min(draws.length - 1, Math.floor(q * draws.length))]!
  const state = await page.evaluate(() => {
    const state = window as unknown as { long: number[]; maps: number }
    return { long: state.long, maps: state.maps }
  })
  return {
    frames: draws.length,
    p50: at(0.5),
    p95: at(0.95),
    max: at(1),
    longTasks: state.long.slice(long),
    // Maps painted while the content scrolled: none should be.
    mapsWhileScrolling: state.maps - maps,
  }
}

test('in software the bend adds little to a frame, and glass without it stays within a few times the page alone', async ({
  browser,
}) => {
  test.setTimeout(180000)
  const budget = {} as Record<'none' | 'fallback' | 'final', Awaited<ReturnType<typeof scrolling>>>
  for (const mode of ['none', 'fallback', 'final'] as const) {
    const page = await browser.newPage({ deviceScaleFactor: 2 })
    budget[mode] = await scrolling(page, mode)
    await page.close()
  }
  evidence.frameBudget = { browser: browser.version(), ...budget }
  await writeFile(
    test.info().outputPath('frame-budget.json'),
    JSON.stringify(evidence.frameBudget, null, 2) + '\n',
  )
  for (const [mode, result] of Object.entries(budget)) {
    expect(result.frames, mode).toBeGreaterThan(60)
    expect(
      result.longTasks.filter((duration) => duration > 100),
      mode,
    ).toEqual([])
    expect(result.mapsWhileScrolling, mode).toBe(0)
  }
  // The bend (and the smoothing after it) is what the final glass adds to the glass a machine
  // without GPU compositing is given, blurred, in the Dock's colour and rimmed (glass.ts); locally
  // it costs about a quarter more (10.4 against 8.3ms at the median on an M-series Mac, the page
  // alone 3.8ms). Dispersion or live lighting would double a frame.
  for (const q of ['p50', 'p95'] as const) {
    expect(budget.final[q], `final ${q}`).toBeLessThanOrEqual(1.5 * budget.fallback[q])
    // What a machine without GPU compositing is given stays within a few times the page alone.
    expect(budget.fallback[q], `fallback ${q}`).toBeLessThanOrEqual(4 * budget.none[q])
  }
})

// The research's absolute budget, for a desktop machine: not run by default, as CI's virtual
// machines composite several times slower than any desktop. YUKI_GLASS_FRAME_BUDGET=1 runs it.
test('the final glass composites within 16.7ms at the 95th percentile on this machine', async ({
  page,
}) => {
  test.skip(!process.env.YUKI_GLASS_FRAME_BUDGET, 'Set YUKI_GLASS_FRAME_BUDGET=1 on a desktop.')
  test.setTimeout(60000)
  await page.setViewportSize({ width: 1200, height: 640 })
  const result = await scrolling(page, 'final')
  evidence.absoluteBudget = result
  expect(result.p95).toBeLessThanOrEqual(16.7)
})

// 7, 8: the real app, told by the main process whether it composites on the GPU.
for (const compositing of ['gpu', 'software'] as const)
  test(`the toolbar's glass follows the main process's ${compositing} compositing`, async () => {
    test.setTimeout(90000)
    const root = await mkdtemp(join(tmpdir(), 'yuki-glass-material-'))
    const app = await (
      await isolatedDesktop(root)
    ).launch('profile', compositing === 'software' ? ['--disable-gpu-compositing'] : [])
    try {
      const page = await app.firstWindow()
      // Pages lie on the window (no card of their own): the toolbar's capsule is the glass.
      const toolbar = page.locator('[data-region="toolbar"] [data-glass="toolbar"]').first()
      await expect(toolbar).toBeVisible()
      const status = await app.evaluate(({ app }) => app.getGPUFeatureStatus().gpu_compositing)
      const boot = await page.evaluate(() => window.yuki.boot())
      const bends = status.startsWith('enabled')
      expect(boot.gpuCompositing).toBe(bends)
      await expect(page.locator('html')).toHaveAttribute('data-gpu-compositing', String(bends))
      if (compositing === 'software') expect(bends).toBe(false)
      if (await systemOpaque(page)) {
        // The system reduces transparency (as CI's macOS does): no glass at all, bent or not.
        evidence[`welcome-${compositing}`] = { status, opaque: true }
        await expect(page.locator('html')).toHaveAttribute('data-opaque', 'true')
        await expect(toolbar).not.toHaveAttribute('data-refracting')
        await expect(toolbar).toHaveCSS('backdrop-filter', 'none')
        return
      }
      await expect(toolbar).toHaveAttribute('data-refracting', 'true', { timeout: 30000 })
      const theme = (await page.evaluate(() => document.documentElement.dataset.theme)) as
        'light' | 'dark'
      const filter: Filter = await toolbar.evaluate(readFilter)
      evidence[`welcome-${compositing}`] = { status, filter }
      await page.screenshot({ path: test.info().outputPath(`welcome-${compositing}.png`) })
      // Blur, the Dock's colour and its rim always, no tint; the bend only on the GPU.
      expect(filter.backdrop).toContain(`blur(${final[theme].blur})`)
      expect(alpha(filter.background)).toBeCloseTo(final[theme].tint, 2)
      // (The window's frost, where it is on, still ends every filter in its seal.)
      expect(filter.backdrop).toMatch(/url\("?#yuki-glass-\d/)
      const names = filter.primitives.map((node) => node.name)
      expect(names.includes('feDisplacementMap'), 'it bends').toBe(bends)
      expect(
        filter.primitives.some((node) => node.result === 'added'),
        'its rim',
      ).toBe(true)
    } finally {
      await app.close()
    }
  })

// macOS's Liquid Glass slider (Clear ↔ Tinted, System Settings › Appearance) reaches the page, as
// the system reads it; and is read again when the window comes forward, as it can be moved while
// Yuki is open. Elsewhere, and where it was never moved, its middle (0.49). Fails when the page is
// never told, or told only once at start.
test("the glass is told macOS's Liquid Glass slider, and told again as the window comes forward", async () => {
  test.setTimeout(60000)
  const root = await mkdtemp(join(tmpdir(), 'yuki-glass-tint-'))
  const app = await (await isolatedDesktop(root)).launch('profile')
  try {
    const page = await app.firstWindow()
    const html = page.locator('html')
    let system = '0.49'
    if (process.platform === 'darwin')
      try {
        system = String(Number(execFileSync('defaults', ['read', '-g', 'NSGlassTintAmount'])))
      } catch {
        // Never moved: the key is absent.
      }
    await expect(html).toHaveAttribute('data-glass-tint', system, { timeout: 30000 })
    // Moved while Yuki was in the background: what the system answers now is read on focus.
    await app.evaluate(({ app, systemPreferences, BrowserWindow }) => {
      systemPreferences.getUserDefault = (() => '0.8') as never
      app.emit('browser-window-focus', {}, BrowserWindow.getAllWindows()[0])
    })
    await expect(html).toHaveAttribute(
      'data-glass-tint',
      process.platform === 'darwin' ? '0.8' : '0.49',
    )
  } finally {
    await app.close()
  }
})

// The settings, chat and connection pages in both themes, from an isolated profile paired with
// the real backend fixture: the screenshots compared against the final in the research.
test('the settings, chat and connection pages in final glass', async () => {
  test.setTimeout(180000)
  const rig = await yukiFixture(),
    app = await rig.launch('glass-material')
  let success = false
  try {
    const page = await app.firstWindow()
    await contentSize(app, page, 1100, 760)
    // The system's frost is drawn outside the page and cannot be screenshot; a solid window colour
    // stands in for it, the same before and after.
    await page.addStyleTag({ content: ':root { background: var(--bg-window) !important }' })
    const shoot = async (name: string) => {
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((theme) => window.yuki.preferences({ theme }), theme)
        await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
        await page.waitForTimeout(700)
        await page.screenshot({ path: test.info().outputPath(`${name}-${theme}.png`) })
      }
    }
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    await expect(
      page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    await shoot('connection')
    await pairUI(page, rig.base, await rig.code())
    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
    })
    // Enough conversation that some of it lies under the floating composer.
    for (const text of [
      '幫我整理一下這週的訪談筆記，重點放在使用者對新版工作流程的回饋。',
      'Liquid Glass bends light at its edges, so the content beneath stays legible.',
      '玻璃的邊緣應該像有厚度一樣把後面的文字彎過去。',
    ]) {
      await composer.fill(text)
      await page.getByRole('button', { name: '送出', exact: true }).click()
      await expect(page.getByText(text, { exact: true })).toBeVisible()
    }
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    await contentSize(app, page, 1100, 760)
    await composer.fill('邊緣應該把後面的內容彎過去。')
    await page.waitForTimeout(1500)
    await page
      .locator('[role="log"]')
      .first()
      .evaluate((log) => (log.scrollTop -= 90))
    await shoot('chat')
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await shoot('settings')
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
