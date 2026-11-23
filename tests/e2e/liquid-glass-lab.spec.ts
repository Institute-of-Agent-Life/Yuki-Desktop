import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/*
 * 液态玻璃质感调研 (2026-11-23), research prototype only. Failure cases written before the lab:
 *   1. a proposal fails to refract (no filter on the pane, or its maps never painted);
 *   2. a proposal paints its maps for longer than the budget glass-slices.spec.ts gives a pane
 *      opening for the first time (30ms), or any frame is held by a long task over 100ms;
 *   3. a proposal drops frames while content scrolls beneath it and the pointer moves its light,
 *      where the page without glass does not (recorded per variant, compared in the report);
 *   4. the slider jumps on grab, leaves 0–100 when pulled past an end, or misses its stops: 0 is
 *      opaque and the preview turns solid at once; values change on every move, not on release;
 *   5. the stretched slider fails to spring back to its resting shape after release.
 * Everything measured and every picture is written under YUKI_LAB_OUTPUT.
 */
test.use({ deviceScaleFactor: 2 })
// A research lab, not a product check: it runs when asked for, with a place for its pictures.
test.skip(!process.env.YUKI_LAB_OUTPUT, 'set YUKI_LAB_OUTPUT to run the liquid glass lab')
const lab = 'http://127.0.0.1:4178/liquid-glass-lab.html'
const output = () => process.env.YUKI_LAB_OUTPUT!

async function ready(page: Page, url: string) {
  // The background picker is for people; pictures are taken without it.
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}picker=0`)
  await expect(page.locator('html[data-lab-ready]')).toBeAttached({ timeout: 10000 })
  await page.mouse.move(2, 2)
  await page.waitForTimeout(1200)
}

// The same instrument as glass-slices.spec.ts: time from a canvas's first context to its last write.
async function watchMaps(page: Page) {
  await page.addInitScript(() => {
    const started = new WeakMap<HTMLCanvasElement, number>(),
      spent = new Map<HTMLCanvasElement, number>()
    Object.assign(window, { maps: () => [...spent.values()].reduce((a, b) => a + b, 0) })
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      if (!started.has(this)) started.set(this, performance.now())
      return getContext.apply(this, args)
    } as typeof getContext
    const written = (canvas: HTMLCanvasElement) =>
      spent.set(canvas, performance.now() - (started.get(canvas) ?? performance.now()))
    const put = CanvasRenderingContext2D.prototype.putImageData
    CanvasRenderingContext2D.prototype.putImageData = function (
      this: CanvasRenderingContext2D,
      ...args: Parameters<typeof put>
    ) {
      put.apply(this, args)
      written(this.canvas)
    } as typeof put
    const url = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof url>
    ) {
      const result = url.apply(this, args)
      written(this)
      return result
    }
    const state = window as unknown as { long: number[]; loaf: number[] }
    state.long = []
    state.loaf = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.long.push(entry.duration)
    }).observe({ type: 'longtask', buffered: true })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.loaf.push(entry.duration)
    }).observe({ type: 'long-animation-frame', buffered: true })
  })
}

// Pictures stacked into one, top to bottom, in the order given.
async function stack(page: Page, shots: Buffer[]) {
  const stacked = await page.evaluate(
    async (images) => {
      const decoded = await Promise.all(
        images.map(async (data) => {
          const image = new Image()
          image.src = `data:image/png;base64,${data}`
          await image.decode()
          return image
        }),
      )
      const gap = 12,
        width = Math.max(...decoded.map((image) => image.width)),
        height = decoded.reduce((sum, image) => sum + image.height + gap, 0)
      const canvas = new OffscreenCanvas(width, height),
        context = canvas.getContext('2d')!
      context.fillStyle = '#fff'
      context.fillRect(0, 0, width, height)
      let y = 0
      for (const image of decoded) {
        context.drawImage(image, 0, y)
        y += image.height + gap
      }
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary)
    },
    shots.map((shot) => shot.toString('base64')),
  )
  return Buffer.from(stacked, 'base64')
}
// The same pane of every variant shown, stacked in the page's order.
async function crops(page: Page, shown: readonly string[], kind: string) {
  const shots: Buffer[] = []
  for (const variant of shown) {
    const box = (await page
      .locator(`[data-variant="${variant}"] [data-lab-kind="${kind}"]`)
      .boundingBox())!
    const pad = 14
    shots.push(
      await page.screenshot({
        clip: {
          x: box.x - pad,
          y: box.y - pad,
          width: kind === 'composer' ? box.width * 0.62 : box.width + 2 * pad,
          height: box.height + 2 * pad,
        },
      }),
    )
  }
  return stack(page, shots)
}

const v1 = ['current', 'curved', 'volume', 'lit'] as const,
  v2 = ['current', 'slab-thin', 'slab', 'slab-thick'] as const,
  v3 = ['current', 'slab', 'v3'] as const,
  v4 = ['current', 'v3', 'v4'] as const

test('v1: the current glass and the three rejected proposals, side by side', async ({ page }) => {
  test.setTimeout(120000)
  const directory = join(output(), 'v1')
  await mkdir(directory, { recursive: true })
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1320, height: 1000 })
    await ready(page, `${lab}?v=all&set=v1&theme=${theme}`)
    // 1
    for (const variant of v1.slice(1))
      for (const kind of ['toolbar', 'button', 'card', 'composer'])
        await expect(
          page.locator(`[data-variant="${variant}"] [data-lab-kind="${kind}"]`),
        ).toHaveAttribute('data-ready', 'true')
    await page.screenshot({ path: join(directory, `overview-${theme}.png`) })
    for (const kind of ['composer', 'button', 'card'])
      await writeFile(join(directory, `${theme}-${kind}-A-B-C-D.png`), await crops(page, v1, kind))
  }
})

/*
 * v2 (the owner's direction, 2026-11-23): a slightly thick flat slab whose bend and light live
 * only in a narrow rounded bevel. Failure cases written first:
 *   6. a slab pane's face moves what is seen through it (any displacement beyond the bevel);
 *   7. a bevel wider than its corner allows, or than a quarter of the pane's short side;
 *   8. a slab variant fails to refract over any of the three backgrounds, in either theme.
 */
test('v2: the slab proposals over text, a picture and chat, light and dark', async ({ page }) => {
  test.setTimeout(300000)
  const directory = join(output(), 'v2')
  for (const variant of v2) await mkdir(join(directory, variant), { recursive: true })
  for (const background of ['text', 'photo', 'chat'])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1320, height: 1000 })
      await ready(page, `${lab}?v=all&bg=${background}&theme=${theme}`)
      // 8
      for (const variant of v2.slice(1))
        for (const kind of ['toolbar', 'button', 'card', 'composer'])
          await expect(
            page.locator(`[data-variant="${variant}"] [data-lab-kind="${kind}"]`),
          ).toHaveAttribute('data-ready', 'true')
      await page.screenshot({ path: join(directory, `overview-${background}-${theme}.png`) })
      for (const kind of ['composer', 'button', 'card'])
        await writeFile(
          join(directory, `${background}-${theme}-${kind}-A-S1-S2-S3.png`),
          await crops(page, v2, kind),
        )
      // Each variant on its own, the whole window.
      await page.setViewportSize({ width: 900, height: 600 })
      for (const variant of v2) {
        await ready(page, `${lab}?v=${variant}&solo=1&bg=${background}&theme=${theme}`)
        await page.screenshot({ path: join(directory, variant, `${background}-${theme}.png`) })
      }
    }
  // 6, 7: the face of every slab pane is neutral in its map, and its bevel fits its corner.
  await page.setViewportSize({ width: 1320, height: 1000 })
  await ready(page, `${lab}?v=all`)
  for (const variant of v2.slice(1))
    for (const kind of ['toolbar', 'button', 'card', 'composer']) {
      const pane = page.locator(`[data-variant="${variant}"] [data-lab-kind="${kind}"]`)
      const facts = await pane.evaluate(async (element: HTMLElement) => {
        const id = /url\("?#([^")]+)/.exec(element.style.backdropFilter)![1]!
        const href = document.getElementById(id)!.querySelector('feImage')!.getAttribute('href')!
        const image = new Image()
        image.src = href
        await image.decode()
        const canvas = new OffscreenCanvas(image.width, image.height),
          context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const data = context.getImageData(0, 0, image.width, image.height).data
        const bevel = Number(element.dataset.bevel),
          scale = image.width / element.offsetWidth,
          radius = parseFloat(getComputedStyle(element).borderTopLeftRadius)
        // The largest displacement found deeper than the bevel (plus a pixel of smoothing).
        const hx = element.offsetWidth / 2,
          hy = element.offsetHeight / 2
        let face = 0
        for (let j = 0; j < image.height; j++)
          for (let i = 0; i < image.width; i++) {
            const x = (i + 0.5) / scale - hx,
              y = (j + 0.5) / scale - hy
            const qx = Math.abs(x) - hx + radius,
              qy = Math.abs(y) - hy + radius
            const d =
              Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
            if (-d <= bevel + 1) continue
            const k = (j * image.width + i) * 4
            face = Math.max(face, Math.abs(data[k]! - 128), Math.abs(data[k + 1]! - 128))
          }
        return {
          face,
          bevel,
          radius,
          short: Math.min(element.offsetWidth, element.offsetHeight),
        }
      })
      expect(facts.face, `${variant} ${kind}`).toBeLessThanOrEqual(1)
      expect(facts.bevel, `${variant} ${kind}`).toBeLessThanOrEqual(facts.radius * 0.6 + 0.01)
      expect(facts.bevel, `${variant} ${kind}`).toBeLessThanOrEqual(facts.short / 4 + 0.01)
    }
  // The profiles and maps themselves.
  await page.setViewportSize({ width: 1180, height: 900 })
  await ready(page, `${lab}?page=profile`)
  await expect(page.getByTestId('maps').locator('canvas')).toHaveCount(6)
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(directory, 'profiles-and-maps.png'), fullPage: true })
})

/*
 * v3 (owner, 2026-11-23): aligned item by item with Apple's own glass (HIG Materials, WWDC25
 * frames; numbers in the research doc). Failure case written first:
 *   9. a v3 pane fails to refract over any background or theme, or its bevel leaves the size
 *      ratio it was fitted to (16% of the corner's radius, never below 3px).
 */
test('v3: the measured material in app panes, over text, a picture and chat', async ({ page }) => {
  test.setTimeout(300000)
  const directory = join(output(), 'v3', 'app')
  await mkdir(directory, { recursive: true })
  for (const background of ['text', 'photo', 'chat'])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1320, height: 1000 })
      await ready(page, `${lab}?v=all&set=v3&bg=${background}&theme=${theme}`)
      for (const kind of ['toolbar', 'button', 'card', 'composer']) {
        const pane = page.locator(`[data-variant="v3"] [data-lab-kind="${kind}"]`)
        // 9
        await expect(pane).toHaveAttribute('data-ready', 'true')
        const { bevel, radius, short } = await pane.evaluate((element: HTMLElement) => ({
          bevel: Number(element.dataset.bevel),
          radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
          short: Math.min(element.offsetWidth, element.offsetHeight),
        }))
        expect(bevel, kind).toBeCloseTo(Math.max(3, 0.16 * Math.min(radius, short / 2)), 2)
      }
      await page.screenshot({ path: join(directory, `overview-${background}-${theme}.png`) })
      for (const kind of ['composer', 'button', 'card'])
        await writeFile(
          join(directory, `${background}-${theme}-${kind}-A-S2-V3.png`),
          await crops(page, v3, kind),
        )
    }
})

/*
 * v4 (owner and coordinator, 2026-11-23): clear and shaped rather than frosted; light inside the
 * body; uneven, blur-first refraction after the iOS 26.2 home screen. Failure cases written first:
 *  10. a v4 pane fails to refract over any background or theme;
 *  11. the background picker cannot switch to a built-in background or load a chosen picture.
 */
test('v4: app panes over text, a picture, line art and chat; the background picker', async ({
  page,
}) => {
  test.setTimeout(300000)
  const directory = join(output(), 'v4', 'app')
  await mkdir(directory, { recursive: true })
  for (const background of ['text', 'photo', 'lineart', 'chat'])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1320, height: 1000 })
      await ready(page, `${lab}?v=all&set=v4&bg=${background}&theme=${theme}`)
      for (const kind of ['toolbar', 'button', 'card', 'composer'])
        // 10
        await expect(page.locator(`[data-variant="v4"] [data-lab-kind="${kind}"]`)).toHaveAttribute(
          'data-ready',
          'true',
        )
      await page.screenshot({ path: join(directory, `overview-${background}-${theme}.png`) })
      for (const kind of ['composer', 'button', 'card'])
        await writeFile(
          join(directory, `${background}-${theme}-${kind}-A-V3-V4.png`),
          await crops(page, v4, kind),
        )
    }
  // 11
  await page.goto(`${lab}?v=all&set=v4`)
  const picker = page.getByRole('combobox', { name: '背景' })
  await picker.selectOption('gradient')
  await expect(page.locator('.scene.gradient')).toHaveCount(3)
  await page
    .locator('.backdropPicker input[type=file]')
    .setInputFiles('tests/fixtures/liquid-glass-lineart.png')
  await expect(picker).toHaveValue('image')
  await expect(page.locator('.scene.photo img[src^="blob:"]').first()).toBeVisible()
  await page.screenshot({ path: join(directory, 'picker-own-picture.png') })
})

/*
 * v5 (coordinator, 2026-11-23): a thick glowing bevel, a lower-frequency melt, maps at 2x with
 * dithering, and a tint pulled into the theme's range where the backdrop is bright or dark.
 * Failure case written first:
 *  12. a v5 pane fails to refract over any background or theme.
 */
test('v5: app panes over line art, a picture, text and chat', async ({ page }) => {
  test.setTimeout(300000)
  const directory = join(output(), 'v5', 'app')
  await mkdir(directory, { recursive: true })
  for (const background of ['lineart', 'photo', 'text', 'chat'])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1320, height: 1000 })
      await ready(page, `${lab}?v=all&set=v5&bg=${background}&theme=${theme}`)
      for (const kind of ['toolbar', 'button', 'card', 'composer'])
        // 12
        await expect(page.locator(`[data-variant="v5"] [data-lab-kind="${kind}"]`)).toHaveAttribute(
          'data-ready',
          'true',
        )
      await page.screenshot({ path: join(directory, `overview-${background}-${theme}.png`) })
    }
})

test('each variant within the glass budget while content moves beneath it', async ({ page }) => {
  test.setTimeout(240000)
  await watchMaps(page)
  await page.setViewportSize({ width: 1200, height: 760 })
  const report: Record<string, unknown> = {
    browser: page.context().browser()?.version(),
    note: 'deviceScaleFactor 2, 1200x760, content scrolling under the glass, pointer sweeping',
  }
  for (const variant of ['none', ...v2, 'v3', 'v4', 'v5', ...v1.slice(1)]) {
    await page.goto(`${lab}?v=${variant}&solo=1&animate=1&picker=0`)
    await expect(page.locator('html[data-lab-ready]')).toBeAttached({ timeout: 10000 })
    await page.waitForTimeout(600)
    const maps = await page.evaluate(() => (window as unknown as { maps(): number }).maps())
    await page.evaluate(() => {
      const state = window as unknown as { long: number[]; loaf: number[]; frames: number[] }
      state.long = []
      state.loaf = []
      state.frames = []
      let last = performance.now()
      const tick = (now: number) => {
        state.frames.push(now - last)
        last = now
        if (state.frames.length < 400) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // The compositor's own time per frame (Display::DrawAndSwap): where backdrop filters are drawn.
    // Headless Chromium composites in software, the case of a machine without GPU compositing.
    const trace = join(output(), `trace-${variant}.json`),
      browser = page.context().browser()!
    await mkdir(output(), { recursive: true })
    await browser.startTracing(page, { path: trace, categories: ['viz', 'gpu', 'cc'] })
    // Sweep the pointer across the window: the lit rims (current) and the live light (lit) follow.
    for (let step = 0; step < 60; step++) {
      await page.mouse.move(100 + ((step * 37) % 1000), 120 + ((step * 53) % 560))
      await page.waitForTimeout(50)
    }
    await browser.stopTracing()
    const draws = (
      JSON.parse(await readFile(trace, 'utf8')) as {
        traceEvents: { name: string; ph: string; dur?: number }[]
      }
    ).traceEvents
      .filter((event) => event.name === 'Display::DrawAndSwap' && event.ph === 'X')
      .map((event) => event.dur! / 1000)
      .sort((a, b) => a - b)
    const drawAt = (q: number) =>
      Math.round(draws[Math.min(draws.length - 1, Math.floor(q * draws.length))]! * 100) / 100
    await page.waitForFunction(
      () => (window as unknown as { frames: number[] }).frames.length >= 400,
      undefined,
      { timeout: 30000 },
    )
    const sampled = await page.evaluate(() => {
      const state = window as unknown as { long: number[]; loaf: number[]; frames: number[] }
      return { frames: state.frames.slice(5), long: state.long, loaf: state.loaf }
    })
    const sorted = [...sampled.frames].sort((a, b) => a - b),
      at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
    const result = {
      mapsMs: Math.round(maps * 10) / 10,
      frameMs: {
        mean: Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 100) / 100,
        p50: Math.round(at(0.5) * 100) / 100,
        p95: Math.round(at(0.95) * 100) / 100,
        max: Math.round(sorted.at(-1)! * 100) / 100,
      },
      compositorMs: { frames: draws.length, p50: drawAt(0.5), p95: drawAt(0.95), max: drawAt(1) },
      framesOver20ms: sorted.filter((value) => value > 20).length,
      framesOver34ms: sorted.filter((value) => value > 34).length,
      frames: sorted.length,
      longTasks: sampled.long.map(Math.round),
      longAnimationFrames: sampled.loaf.map(Math.round),
    }
    report[variant] = result
  }
  await mkdir(output(), { recursive: true })
  await writeFile(join(output(), 'frame-budget.json'), JSON.stringify(report, null, 2) + '\n')
  // 2
  for (const variant of ['none', ...v2, 'v3', 'v4', 'v5', ...v1.slice(1)]) {
    const result = report[variant] as { mapsMs: number; longTasks: number[] }
    expect(
      result.longTasks.filter((duration) => duration > 100),
      variant,
    ).toEqual([])
    // D's live lighting is measured, not held to the budget: it is the costly upper bound.
    if (variant !== 'lit') expect(result.mapsMs, variant).toBeLessThanOrEqual(30)
  }
})

test('the iOS-style slider changes the preview live and springs back', async ({ page }) => {
  test.setTimeout(120000)
  const directory = join(output(), 'slider-frames')
  await mkdir(directory, { recursive: true })
  await page.setViewportSize({ width: 900, height: 520 })
  await ready(page, `${lab}?page=slider`)
  const slider = page.getByRole('slider', { name: '透明度', exact: true }),
    row = page.getByTestId('slider-demo'),
    value = page.getByTestId('transparency-value')
  const box = (await slider.boundingBox())!,
    clip = (await row.boundingBox())!
  let frame = 0
  const shoot = async () =>
    page.screenshot({
      path: join(directory, `frame-${String(frame++).padStart(3, '0')}.png`),
      clip,
    })
  const y = box.y + box.height / 2
  // 4: grabbing anywhere does not jump; the value follows each move.
  const grab = box.x + box.width * 0.5
  await shoot()
  await page.mouse.move(grab, y)
  await page.mouse.down()
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(30)
    await shoot()
  }
  await expect(value).toHaveText('80%')
  const seen: string[] = []
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(grab - step * box.width * 0.045, y)
    seen.push((await value.textContent())!)
    await shoot()
  }
  expect(new Set(seen).size).toBeGreaterThan(10)
  // Pulled past the opaque end: it stays at 0, the preview is solid, the slider stretches.
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(grab - box.width * 0.9 - step * 10, y)
    await shoot()
  }
  await expect(value).toHaveText('不透明')
  await expect(page.locator('.window')).toHaveClass(/opaque/)
  const stretched = await slider.evaluate((element) => element.style.transform)
  await page.mouse.up()
  for (let i = 0; i < 18; i++) {
    await page.waitForTimeout(25)
    await shoot()
  }
  // 5
  await expect(slider).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
  // And across to the clearest end, past it, and back.
  const from = box.x + 20
  await page.mouse.move(from, y)
  await page.mouse.down()
  for (let step = 1; step <= 26; step++) {
    await page.mouse.move(from + step * box.width * 0.045, y)
    await shoot()
  }
  await expect(value).toHaveText('100%')
  await page.mouse.up()
  for (let i = 0; i < 18; i++) {
    await page.waitForTimeout(25)
    await shoot()
  }
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(from + box.width * 1.17 - step * box.width * 0.03, y)
    if (step === 1) await page.mouse.down()
    await shoot()
  }
  await page.mouse.up()
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(25)
    await shoot()
  }
  await writeFile(
    join(output(), 'slider.json'),
    JSON.stringify({ frames: frame, stretched, values: seen, final: await value.textContent() }) +
      '\n',
  )
})
