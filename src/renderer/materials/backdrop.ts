import type { BackdropTable, CustomBackdrop } from '../../shared/desktop'
import { unwrap } from '../queries/client'
import { setBackdropSample } from './appearance'
import { dockColour } from './dock'

/*
 * A picture of the person's own behind the conversation (docs/reports/2026-11-23-liquid-glass
 * §12). Chromium decodes it here, as it does avatars: a copy no longer than twice the screen's
 * long side is made in WebP, and a brightness table from it; the main process keeps all three
 * under the picture's SHA-256 and serves them back under app://desktop/__backgrounds/.
 */
export const backdropUrl = (name: string) => `app://desktop/__backgrounds/${name}`

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const weights = [0.2126, 0.7152, 0.0722] as const
const luminance = (r: number, g: number, b: number) =>
  weights[0] * linear(r / 255) + weights[1] * linear(g / 255) + weights[2] * linear(b / 255)

// The table: 32 × 32 cells, each measured on an 8 × 8 patch of a 256 × 256 scaling of the picture.
function measure(image: ImageBitmap): BackdropTable {
  const grid = 32,
    patch = 8,
    side = grid * patch
  const context = new OffscreenCanvas(side, side).getContext('2d')!
  context.drawImage(image, 0, 0, side, side)
  const data = context.getImageData(0, 0, side, side).data
  const cells: [number, number, number][] = []
  let red = 0,
    green = 0,
    blue = 0
  for (let row = 0; row < grid; row++)
    for (let column = 0; column < grid; column++) {
      const values: number[] = []
      for (let y = 0; y < patch; y++)
        for (let x = 0; x < patch; x++) {
          const k = ((row * patch + y) * side + column * patch + x) * 4
          values.push(luminance(data[k]!, data[k + 1]!, data[k + 2]!))
          red += data[k]!
          green += data[k + 1]!
          blue += data[k + 2]!
        }
      values.sort((a, b) => a - b)
      const round = (value: number) => Math.round(value * 1000) / 1000
      cells.push([
        round(values.reduce((sum, value) => sum + value, 0) / values.length),
        round(values[Math.floor(values.length * 0.05)]!),
        round(values[Math.ceil(values.length * 0.95) - 1]!),
      ])
    }
  const count = side * side,
    hex = (value: number) =>
      Math.round(value / count)
        .toString(16)
        .padStart(2, '0')
  return { grid, cells, average: `#${hex(red)}${hex(green)}${hex(blue)}` }
}

async function webp(canvas: OffscreenCanvas) {
  return new Uint8Array(
    await (await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })).arrayBuffer(),
  )
}

/** Keeps a picture of one's own; gives back its id. Animated pictures keep their first frame. */
export async function importBackdrop(bytes: Uint8Array) {
  const image = await createImageBitmap(new Blob([bytes as BlobPart]))
  const limit = 2 * Math.max(screen.width, screen.height),
    scale = Math.min(1, limit / Math.max(image.width, image.height))
  const canvas = new OffscreenCanvas(
    Math.round(image.width * scale),
    Math.round(image.height * scale),
  )
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
  return unwrap(await window.yuki.backgrounds.store(bytes, await webp(canvas), measure(image)))
}

/** Keeps a copy of a kept picture blurred by `radius` px, drawn once rather than every frame. */
export async function blurBackdrop(id: string, radius: number) {
  const image = await createImageBitmap(await (await fetch(backdropUrl(`${id}.webp`))).blob())
  const canvas = new OffscreenCanvas(image.width, image.height),
    context = canvas.getContext('2d')!
  // The blur would fade the edges into nothing; drawn past them, they keep the picture's colour.
  context.filter = `blur(${radius}px)`
  const margin = 2 * radius
  context.drawImage(image, -margin, -margin, image.width + 2 * margin, image.height + 2 * margin)
  unwrap(await window.yuki.backgrounds.blur(id, radius, await webp(canvas)))
}

const tables = new Map<string, Promise<BackdropTable>>()
export const backdropTable = (id: string) => {
  let table = tables.get(id)
  if (!table) {
    table = fetch(backdropUrl(`${id}.json`)).then(
      (response) => response.json() as Promise<BackdropTable>,
    )
    tables.set(id, table)
  }
  return table
}

/** The picture shown in a theme, and how much the page's colour is laid over it (0–100). */
export function shownBackdrop(backdrop: CustomBackdrop, theme: 'light' | 'dark') {
  const own = theme === 'dark' ? backdrop.dark : backdrop.light
  // Dark without a picture of its own dims the light one by a further 30%.
  const dim = own ? backdrop.dim : 100 - (100 - backdrop.dim) * 0.7
  return { id: (own ?? backdrop.light)!, dim: Math.round(dim) }
}

/** The page's variables for a custom backdrop (Conversation.module.css draws them). */
const shownFile = (backdrop: CustomBackdrop, id: string) =>
  backdrop.blur ? `${id}-blur${backdrop.blur}.webp` : `${id}.webp`

export function backdropVariables(backdrop: CustomBackdrop, theme: 'light' | 'dark') {
  const shown = shownBackdrop(backdrop, theme)
  const file = shownFile(backdrop, shown.id)
  return {
    '--backdrop-image': `url("${backdropUrl(file)}")`,
    '--backdrop-size': { fill: 'cover', fit: 'contain', tile: 'auto' }[backdrop.fit],
    '--backdrop-repeat': backdrop.fit === 'tile' ? 'repeat' : 'no-repeat',
    '--backdrop-dim': `${shown.dim}%`,
  }
}

/*
 * The conversation's text laid straight on the picture (the toolbar's title, the date, the opening
 * line) takes one tint for the whole picture (`--content-tint`, Conversation.module.css) over a
 * light blur (`--content-blur`): the picture's table is read under the conversation, and the tint
 * raised until secondary text of the theme's colour keeps 3:1 over the darkest (light) or
 * brightest (dark) of it, which leaves main text above 4.5:1. The bubbles' frost is the picture
 * blurred once as the Dock's glass blurs it, in the colour of either appearance
 * (`--backdrop-frost-light`, `--backdrop-frost-dark`).
 */
const tints = {
  // White over the picture, under secondary text of luminance 0.112 (#5b5e66): the result must
  // reach luminance 0.436, sRGB 0.69.
  light: { colour: [255, 255, 255], needed: 0.69, ceiling: 0.92 },
  // rgb(30 32 50), sRGB 0.13, over it, under secondary text of luminance 0.387 (#a4a7af): at most
  // luminance 0.096, sRGB 0.34.
  dark: { colour: [30, 32, 50], needed: 0.34, ceiling: 0.92 },
} as const
const srgb = (linear: number) =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
// The colours (sRGB, 0–1) a picture can show at luminance `y`, as saturated as they come: each
// primary and secondary scaled to it (or filled with white where it cannot reach it), and grey. A
// tint must hold over the worst of them: a saturated blue lets far more through a white tint than
// a grey of its brightness.
const hues = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [0, 1, 1],
  [1, 0, 1],
  [1, 1, 1],
]
const coloursOf = (y: number) =>
  hues.map((hue) => {
    const reach = hue.reduce((sum, value, i) => sum + value * weights[i]!, 0)
    return hue
      .map((value) =>
        reach >= y ? (value * y) / reach : value + ((1 - value) * (y - reach)) / (1 - reach),
      )
      .map(srgb)
  })
// The luminance of `tint` laid at `alpha` over `colour` (both sRGB, 0–1), as the page composites.
const laid = (tint: number[], colour: number[], alpha: number) =>
  colour.reduce(
    (sum, value, i) => sum + weights[i]! * linear(alpha * tint[i]! + (1 - alpha) * value),
    0,
  )

/**
 * Follows the window's custom backdrop with its glass, in whichever theme is shown, until called:
 * once for the whole window (App.tsx), whatever page is shown.
 */
export function followBackdrop(backdrop: CustomBackdrop) {
  const root = document.documentElement
  const theme = (): 'light' | 'dark' => (root.dataset.theme === 'dark' ? 'dark' : 'light')
  let shownTheme = theme(),
    stop = followIn(backdrop, shownTheme)
  // In the other theme the glass keeps the appearance it has until the picture shown there has
  // been read (appearance.ts).
  const themes = new MutationObserver(() => {
    if (theme() === shownTheme) return
    stop()
    shownTheme = theme()
    stop = followIn(backdrop, shownTheme)
  })
  themes.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  return () => {
    themes.disconnect()
    stop()
    setBackdropSample(undefined)
  }
}

function followIn(backdrop: CustomBackdrop, theme: 'light' | 'dark') {
  const shown = shownBackdrop(backdrop, theme),
    tint = tints[theme],
    // What the backdrop's variables are given on: the window.
    root = document.documentElement
  let table: BackdropTable | undefined,
    size: { width: number; height: number } | undefined,
    frame = 0,
    live = true,
    frosted = 0,
    frostUrls: string[] = [],
    // Where the picture is drawn in the window, and its luma (sRGB, 0–1) as the bubbles' blurred
    // copy has it: what lies under a piece of glass, for its appearance (appearance.ts).
    placement:
      | {
          fit: CustomBackdrop['fit']
          drawn: { width: number; height: number }
          origin: { x: number; y: number }
          outside: number
        }
      | undefined,
    lumas: { data: Float32Array; width: number; height: number } | undefined,
    published = false
  // The page's colour laid over the picture, as luminance.
  const page = () => {
    const [r, g, b] = getComputedStyle(root)
      .getPropertyValue('--bg-content')
      .trim()
      .match(/[0-9a-f]{2}/gi)!
      .map((value) => parseInt(value, 16))
    return luminance(r!, g!, b!)
  }
  // The mean and 90th percentile of the blurred picture's luma under a box of the window.
  const publish = () => {
    const at = placement,
      map = lumas
    if (!at || !map) return
    // Read afresh the first time for this picture in this theme (appearance.ts).
    const fresh = !published
    published = true
    setBackdropSample((rect) => {
      const values: number[] = [],
        step = Math.max(2, Math.min(rect.width, rect.height) / 16)
      for (let y = rect.top + step / 2; y < rect.bottom; y += step)
        for (let x = rect.left + step / 2; x < rect.right; x += step) {
          let u = (x - at.origin.x) / at.drawn.width,
            v = (y - at.origin.y) / at.drawn.height
          if (at.fit === 'tile') {
            u = ((u % 1) + 1) % 1
            v = ((v % 1) + 1) % 1
          }
          values.push(
            u < 0 || u >= 1 || v < 0 || v >= 1
              ? at.outside
              : map.data[Math.floor(v * map.height) * map.width + Math.floor(u * map.width)]!,
          )
        }
      if (!values.length) values.push(at.outside)
      values.sort((a, b) => a - b)
      return {
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        high: values[Math.floor(values.length * 0.9)]!,
      }
    }, fresh)
  }
  const update = () => {
    frame = 0
    if (!table || !size || !live) return
    // The picture lies under the whole window (App.module.css).
    const box = new DOMRect(0, 0, innerWidth, innerHeight),
      grid = table.grid
    const fit = backdrop.fit,
      cover = Math.max(box.width / size.width, box.height / size.height),
      contain = Math.min(box.width / size.width, box.height / size.height)
    const scale = fit === 'fill' ? cover : fit === 'fit' ? contain : 1
    const drawn = { width: size.width * scale, height: size.height * scale }
    const origin = {
      x: (box.width - drawn.width) / 2,
      y: (box.height - drawn.height) / 2,
    }
    const dim = shown.dim / 100,
      under = page()
    const average = table.average.match(/[0-9a-f]{2}/gi)!.map((value) => parseInt(value, 16))
    const outside = luminance(average[0]!, average[1]!, average[2]!)
    // Every cell an area covers, in the picture as it is drawn behind the chat: its darkest and
    // brightest, under the page's colour as dimmed, in sRGB.
    const cell = (x: number, y: number) => {
      let u = (x - box.left - origin.x) / drawn.width,
        v = (y - box.top - origin.y) / drawn.height
      if (fit === 'tile') {
        u = ((((x - box.left) / drawn.width) % 1) + 1) % 1
        v = ((((y - box.top) / drawn.height) % 1) + 1) % 1
      }
      if (u < 0 || u >= 1 || v < 0 || v >= 1) return [outside, outside, outside]
      return table!.cells[Math.floor(v * grid) * grid + Math.floor(u * grid)]!
    }
    const step = Math.max(4, Math.min(drawn.width, drawn.height) / grid / 2)
    const range = (rect: DOMRect) => {
      let low = 1,
        high = 0
      for (let y = Math.max(rect.top, box.top); y <= Math.min(rect.bottom, box.bottom); y += step)
        for (
          let x = Math.max(rect.left, box.left);
          x <= Math.min(rect.right, box.right);
          x += step
        ) {
          const [, cellLow, cellHigh] = cell(x, y)
          low = Math.min(low, cellLow!)
          high = Math.max(high, cellHigh!)
        }
      return { low: dim * under + (1 - dim) * low, high: dim * under + (1 - dim) * high }
    }
    // How much of the theme's tint keeps what lies in `rect` at or beyond `target` luminance
    // (light: at least; dark: at most), over any colour of its darkest (light) or brightest
    // (dark), at least `base`.
    const shade = tint.colour.map((value) => value / 255)
    const alphaOver = (rect: DOMRect) => {
      const { low, high } = range(rect),
        target = linear(tint.needed)
      const worst = theme === 'light' ? low : high
      const colours = coloursOf(worst)
      const holds = (alpha: number) =>
        colours.every((colour) =>
          theme === 'light'
            ? laid(shade, colour, alpha) >= target
            : laid(shade, colour, alpha) <= target,
        )
      let needed = 0
      if (!holds(0)) {
        let short = 0
        needed = 1
        for (let step = 0; step < 16; step++) {
          const middle = (short + needed) / 2
          if (holds(middle)) needed = middle
          else short = middle
        }
      }
      return {
        alpha: Math.min(tint.ceiling, needed + 0.05),
        spread: Math.max(0, srgb(high) - srgb(low)),
      }
    }
    placement = { fit, drawn, origin, outside: srgb(dim * under + (1 - dim) * outside) }
    publish()
    const colour = (alpha: number) => `rgb(${tint.colour.join(' ')} / ${alpha.toFixed(3)})`
    const content = alphaOver(
      document.querySelector('[data-region="main"]')?.getBoundingClientRect() ?? box,
    )
    root.style.setProperty('--content-tint', colour(content.alpha))
    root.style.setProperty('--content-blur', `${8 + 8 * content.spread}px`)
    // The bubbles' frost: the picture blurred once as a bubble's glass blurs it (--bubble-blur, in
    // CSS pixels), in its own pixels as it is drawn.
    root.style.setProperty('--backdrop-frost-size', `${drawn.width}px ${drawn.height}px`)
    const radius =
      Math.round(
        (parseFloat(getComputedStyle(root).getPropertyValue('--bubble-blur')) / scale) * 4,
      ) / 4
    if (radius !== frosted) {
      frosted = radius
      void frost(radius)
    }
  }
  // The picture blurred by `radius` of its own pixels and its colour raised as the glass raises it,
  // made smaller first as far as the blur allows (what it removes is finer than any pixel it drops).
  const frost = async (radius: number) => {
    const reduce = Math.max(1, Math.floor(radius / 4)),
      width = Math.max(1, Math.round(image.naturalWidth / reduce)),
      height = Math.max(1, Math.round(image.naturalHeight / reduce))
    // What lies past its edges, for the blur to reach: itself again when tiled, else its edges'
    // colour (a stretched copy under it).
    const margin = Math.ceil((3 * radius) / reduce),
      around = new OffscreenCanvas(width + 2 * margin, height + 2 * margin),
      drawing = around.getContext('2d')!
    drawing.imageSmoothingQuality = 'high'
    if (backdrop.fit === 'tile')
      for (const dx of [-width, 0, width])
        for (const dy of [-height, 0, height])
          drawing.drawImage(image, margin + dx, margin + dy, width, height)
    else {
      drawing.drawImage(image, 0, 0, around.width, around.height)
      drawing.drawImage(image, margin, margin, width, height)
    }
    // The page's colour laid over it as much as it is dimmed (Conversation.module.css), before the
    // glass takes its colour.
    const [r, g, b] = getComputedStyle(root)
      .getPropertyValue('--bg-content')
      .trim()
      .match(/[0-9a-f]{2}/gi)!
      .map((value) => parseInt(value, 16))
    drawing.fillStyle = `rgb(${r} ${g} ${b} / ${shown.dim / 100})`
    drawing.fillRect(0, 0, around.width, around.height)
    const canvas = new OffscreenCanvas(width, height),
      context = canvas.getContext('2d')!
    context.filter = `blur(${radius / reduce}px)`
    context.drawImage(around, -margin, -margin)
    // The Dock's colour (dock.ts), as the glass's filter gives it, in either appearance: a bubble
    // shows the one it has taken (appearance.ts).
    const blurred = context.getImageData(0, 0, width, height),
      tint = Number(document.documentElement.dataset.glassTint ?? 0.49)
    // Its luma (Rec. 709 on the encoded values, as the Dock's tone weighs it), for appearance.
    const luma = new Float32Array(width * height)
    for (let k = 0; k < luma.length; k++)
      luma[k] =
        (0.2126 * blurred.data[4 * k]! +
          0.7152 * blurred.data[4 * k + 1]! +
          0.0722 * blurred.data[4 * k + 2]!) /
        255
    const urls: string[] = []
    for (const look of ['light', 'dark'] as const) {
      const colour = dockColour(look, tint),
        pixels = new ImageData(new Uint8ClampedArray(blurred.data), width, height),
        data = pixels.data
      for (let k = 0; k < data.length; k += 4) {
        const [red, green, blue] = colour(data[k]!, data[k + 1]!, data[k + 2]!)
        data[k] = red!
        data[k + 1] = green!
        data[k + 2] = blue!
      }
      context.putImageData(pixels, 0, 0)
      urls.push(URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' })))
    }
    if (!live || radius !== frosted) return urls.forEach((url) => URL.revokeObjectURL(url))
    frostUrls.forEach((url) => URL.revokeObjectURL(url))
    frostUrls = urls
    lumas = { data: luma, width, height }
    publish()
    root.style.setProperty('--backdrop-frost-light', `url("${urls[0]}")`)
    root.style.setProperty('--backdrop-frost-dark', `url("${urls[1]}")`)
  }
  const schedule = () => {
    frame ||= requestAnimationFrame(update)
  }
  const resize = new ResizeObserver(schedule)
  resize.observe(root)
  addEventListener('resize', schedule)
  void backdropTable(shown.id).then((value) => {
    table = value
    root.style.setProperty('--backdrop-fill', value.average)
    schedule()
  })
  const image = new Image()
  image.src = backdropUrl(shownFile(backdrop, shown.id))
  void image.decode().then(() => {
    size = { width: image.naturalWidth, height: image.naturalHeight }
    schedule()
  })
  return () => {
    live = false
    cancelAnimationFrame(frame)
    resize.disconnect()
    removeEventListener('resize', schedule)
    root.style.removeProperty('--backdrop-fill')
    root.style.removeProperty('--content-tint')
    root.style.removeProperty('--content-blur')
    root.style.removeProperty('--backdrop-frost-size')
    root.style.removeProperty('--backdrop-frost-light')
    root.style.removeProperty('--backdrop-frost-dark')
    frostUrls.forEach((url) => URL.revokeObjectURL(url))
  }
}
