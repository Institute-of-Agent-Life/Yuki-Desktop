import { expect, type Page } from '@playwright/test'

/*
 * The conversation's frosted bubbles against what frost means: the tint laid over the backdrop as
 * blurred (a Gaussian of `radius` CSS pixels). The backdrop is read back from the window with
 * everything in the chat hidden, blurred here on a canvas, and the tint laid over it; the window
 * with the bubbles' text hidden is then compared with that, pixel by pixel, wherever a bubble is.
 *
 * `tint: 'fitted'` (a picture of one's own) takes each bubble's tint from what it shows (the best
 * straight line from the blurred backdrop, given the Dock's colour of the appearance the bubble
 * has taken, to it, per channel: materials/dock.ts), for a window where something else also fades
 * a bubble (the conversation's edges): what is left is then only whether the bubble shows the
 * backdrop blurred by `radius`, and in its place.
 */
export interface Frost {
  /** Bubbles measured: wholly in the open conversation, clear of the composer, toolbar and fades. */
  bubbles: number
  /** Mean and 99th percentile of |shown − expected| over the bubbles' channels, in levels. */
  mean: number
  p99: number
  /** Each bubble's place, and how much of the blurred backdrop it shows: known (1 − the tint's
   *  alpha) and as fitted (mean over the channels). */
  shows: { x: number; y: number; known: number; fitted: number }[]
}

const hide = (css: string) => {
  const style = document.createElement('style')
  style.dataset.frostProbe = ''
  style.textContent = css
  document.head.append(style)
}

async function shot(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  return (await page.screenshot({ animations: 'disabled', caret: 'hide' })).toString('base64')
}

/** `radius`: the frost's blur in CSS pixels (a pattern's 2; a picture of one's own's `--bubble-blur`). */
export async function frost(
  page: Page,
  radius: number,
  tint: 'known' | 'fitted' = 'known',
): Promise<Frost> {
  // Measured where the conversation has come to rest (a wheel's or a restored scroll eases out).
  const log = page.locator('[role="log"]').first(),
    top = () => log.evaluate((log) => log.scrollTop)
  await expect
    .poll(async () => {
      const before = await top()
      await page.waitForTimeout(150)
      return before === (await top())
    })
    .toBe(true)
  const measure = () =>
    page.evaluate(() => {
      const log = document.querySelector('[role="log"]')!.getBoundingClientRect()
      const over = [
        ...document.querySelectorAll(
          '[data-region="composer"], [data-region="toolbar"], [data-edge-fade]',
        ),
      ]
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
      return [...document.querySelectorAll<HTMLElement>('[data-surface="bubble"]')]
        .map((surface) => {
          const rect = surface.getBoundingClientRect()
          const probe = document.createElement('i')
          probe.style.cssText =
            'position:absolute;inset:0;background:var(--glass-tint, var(--glass-neutral-tint))'
          surface.append(probe)
          const tint = getComputedStyle(probe).backgroundColor
          probe.remove()
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            radius: parseFloat(getComputedStyle(surface).borderTopLeftRadius),
            tint,
            appearance:
              surface.parentElement!.dataset.appearance ??
              document.documentElement.dataset.theme ??
              'light',
          }
        })
        .filter(
          (bubble) =>
            bubble.y >= log.top + 2 &&
            bubble.y + bubble.height <= log.bottom - 2 &&
            bubble.x >= 0 &&
            bubble.x + bubble.width <= innerWidth &&
            over.every(
              (rect) =>
                bubble.y + bubble.height + 2 < rect.top ||
                bubble.y > rect.bottom + 2 ||
                bubble.x + bubble.width + 2 < rect.left ||
                bubble.x > rect.right + 2,
            ),
        )
    })
  // The bubbles with their text hidden, where they were found (read again after, until they held
  // still while the window was read: a row sliding into place moves them).
  await page.evaluate(hide, '[data-bubble-copy] { visibility: hidden !important }')
  let bubbles = await measure(),
    shown = ''
  for (;;) {
    shown = await shot(page)
    const after = await measure()
    if (JSON.stringify(after) === JSON.stringify(bubbles)) break
    bubbles = after
  }
  // The backdrop alone: everything hidden but what holds the conversation, whose backgrounds
  // (and a picture's layer under them) are the backdrop.
  await page.evaluate(() => {
    for (
      let holder = document.querySelector('[role="log"]')!.parentElement;
      holder && holder !== document.body;
      holder = holder.parentElement
    )
      holder.dataset.frostKeep = ''
  })
  await page.evaluate(
    hide,
    'body * { visibility: hidden !important } [data-frost-keep] { visibility: visible !important }',
  )
  const backdrop = await shot(page)
  await page.evaluate(() => {
    for (const style of document.querySelectorAll('style[data-frost-probe]')) style.remove()
    for (const holder of document.querySelectorAll<HTMLElement>('[data-frost-keep]'))
      delete holder.dataset.frostKeep
  })
  const glassTint = await page.evaluate(() =>
    Number(document.documentElement.dataset.glassTint ?? 0.49),
  )
  return page.evaluate(
    async ({ shown, backdrop, bubbles, radius, tint, glassTint }) => {
      // The Dock's colour of an appearance (materials/dock.ts), for one sRGB colour in levels.
      const toward = Math.min(1, Math.max(0, (glassTint - 0.49) / 0.51))
      const dock = (appearance: string, r: number, g: number, b: number) => {
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const [shade, gain] =
          appearance === 'dark'
            ? [(1 - toward) * (11 + 0.919 * y - 0.000992 * y * y) + toward * (34 + 0.32 * y), 1.08]
            : [48.4 + 0.695 * y, 1.2]
        return [r, g, b].map((c) => shade! + gain! * (c - y))
      }
      const decode = (data: string) =>
        createImageBitmap(
          new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/png' }),
        )
      const read = (image: ImageBitmap, blur = 0) => {
        const canvas = new OffscreenCanvas(image.width, image.height),
          context = canvas.getContext('2d')!
        if (blur) {
          context.filter = `blur(${blur}px)`
          // Past the window's edge the blur takes the edge's colour: a stretched copy lies under
          // the exact one (the bubbles lie well inside the window).
          context.drawImage(image, -64, -64, image.width + 128, image.height + 128)
        }
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height).data
      }
      const shownImage = await decode(shown),
        backdropImage = await decode(backdrop)
      const scale = shownImage.width / innerWidth
      const seen = read(shownImage),
        blurred = read(backdropImage, radius * scale)
      const width = shownImage.width
      const tintOf = (colour: string) => {
        const values = colour.match(/[\d.]+/g)!.map(Number),
          unit = colour.startsWith('color(') ? 255 : 1
        return { rgb: values.slice(0, 3).map((value) => value * unit), a: values[3] ?? 1 }
      }
      const differences: number[] = [],
        shows: Frost['shows'] = []
      for (const bubble of bubbles) {
        // Inside the bubble's rounded rectangle, two pixels in from its edge.
        const inset = 2,
          r = Math.max(0, bubble.radius - inset)
        const left = bubble.x + inset,
          top = bubble.y + inset,
          right = bubble.x + bubble.width - inset,
          bottom = bubble.y + bubble.height - inset
        const inside: number[] = []
        for (let y = Math.ceil(top * scale); y < Math.floor(bottom * scale); y++)
          for (let x = Math.ceil(left * scale); x < Math.floor(right * scale); x++) {
            const cx = (x + 0.5) / scale,
              cy = (y + 0.5) / scale
            const dx = Math.max(left + r - cx, 0, cx - (right - r)),
              dy = Math.max(top + r - cy, 0, cy - (bottom - r))
            if (dx * dx + dy * dy <= r * r) inside.push((y * width + x) * 4)
          }
        const known = tintOf(bubble.tint),
          fittedSlopes: number[] = []
        // What the bubble's copy of the backdrop is made of: the blurred backdrop, given the
        // Dock's colour where the picture is one's own.
        const source = new Map<number, number[]>()
        for (const k of inside)
          source.set(
            k,
            tint === 'fitted'
              ? dock(bubble.appearance, blurred[k]!, blurred[k + 1]!, blurred[k + 2]!)
              : [blurred[k]!, blurred[k + 1]!, blurred[k + 2]!],
          )
        for (let c = 0; c < 3; c++) {
          // shown = (1 − a)·blurred + a·tint: the line known, or the one that fits best.
          let slope = 1 - known.a,
            offset = known.a * known.rgb[c]!
          {
            let sx = 0,
              sy = 0,
              sxx = 0,
              sxy = 0
            for (const k of inside) {
              const x = source.get(k)![c]!,
                y = seen[k + c]!
              sx += x
              sy += y
              sxx += x * x
              sxy += x * y
            }
            const n = inside.length,
              variance = sxx / n - (sx / n) ** 2
            const fitted = variance > 1e-6 ? (sxy / n - (sx / n) * (sy / n)) / variance : 0
            fittedSlopes.push(fitted)
            if (tint === 'fitted') {
              slope = fitted
              offset = sy / n - slope * (sx / n)
            }
          }
          for (const k of inside)
            differences.push(Math.abs(seen[k + c]! - (offset + slope * source.get(k)![c]!)))
        }
        shows.push({
          x: Math.round(bubble.x),
          y: Math.round(bubble.y),
          known: Math.round((1 - known.a) * 1000) / 1000,
          fitted:
            Math.round((fittedSlopes.reduce((sum, value) => sum + value, 0) / 3) * 1000) / 1000,
        })
      }
      differences.sort((a, b) => a - b)
      const round = (value: number) => Math.round(value * 100) / 100
      return {
        bubbles: bubbles.length,
        mean: round(differences.reduce((sum, value) => sum + value, 0) / differences.length),
        p99: round(differences[Math.floor(differences.length * 0.99)] ?? 0),
        shows,
      }
    },
    { shown, backdrop, bubbles, radius, tint, glassTint },
  )
}
