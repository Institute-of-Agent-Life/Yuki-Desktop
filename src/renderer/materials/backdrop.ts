import type { BackdropTable, CustomBackdrop } from '../../shared/desktop'
import { unwrap } from '../queries/client'

/*
 * A picture of the person's own behind the conversation (docs/reports/2026-11-23-liquid-glass
 * §12). Chromium decodes it here, as it does avatars: a copy no longer than twice the screen's
 * long side is made in WebP, and a brightness table from it; the main process keeps all three
 * under the picture's SHA-256 and serves them back under app://desktop/__backgrounds/.
 */
export const backdropUrl = (name: string) => `app://desktop/__backgrounds/${name}`

const luminance = (r: number, g: number, b: number) => {
  const linear = (value: number) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

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
export function backdropVariables(backdrop: CustomBackdrop, theme: 'light' | 'dark') {
  const shown = shownBackdrop(backdrop, theme)
  const file = backdrop.blur ? `${shown.id}-blur${backdrop.blur}.webp` : `${shown.id}.webp`
  return {
    '--backdrop-image': `url("${backdropUrl(file)}")`,
    '--backdrop-size': { fill: 'cover', fit: 'contain', tile: 'auto' }[backdrop.fit],
    '--backdrop-repeat': backdrop.fit === 'tile' ? 'repeat' : 'no-repeat',
    '--backdrop-dim': `${shown.dim}%`,
  }
}

/*
 * Glass that follows what lies under it, as Apple's darkens over bright content and lightens over
 * dark: the picture's table is read under each pane over the conversation, and the pane's tint is
 * raised from its own until text of the theme's colour keeps 4.5:1 over the darkest (light) or
 * brightest (dark) of it. Where the picture is busy the pane blurs more.
 */
const tints = {
  // White over the picture, under text of luminance 0.0116 (#1b1c20): the result must reach
  // luminance 0.227, sRGB 0.515.
  light: { colour: [255, 255, 255], needed: 0.515, ceiling: 0.62, blur: 2 },
  // rgb(30 32 50) over it, under text of luminance 0.88 (#f1f2f5): at most luminance 0.157, sRGB
  // 0.43. The body's light brightens the middle by up to a fifth (glass.ts).
  dark: { colour: [30, 32, 50], needed: 0.43, ceiling: 0.9, blur: 3 },
} as const
const srgb = (linear: number) =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055

/** Follows `chat`'s custom backdrop with its glass, in whichever theme is shown, until called. */
export function followBackdrop(chat: HTMLElement, backdrop: CustomBackdrop) {
  const root = document.documentElement
  const theme = (): 'light' | 'dark' => (root.dataset.theme === 'dark' ? 'dark' : 'light')
  let shownTheme = theme(),
    stop = followIn(chat, backdrop, shownTheme)
  const themes = new MutationObserver(() => {
    if (theme() === shownTheme) return
    stop()
    shownTheme = theme()
    stop = followIn(chat, backdrop, shownTheme)
  })
  themes.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  return () => {
    themes.disconnect()
    stop()
  }
}

function followIn(chat: HTMLElement, backdrop: CustomBackdrop, theme: 'light' | 'dark') {
  const shown = shownBackdrop(backdrop, theme),
    tint = tints[theme]
  let table: BackdropTable | undefined,
    size: { width: number; height: number } | undefined,
    frame = 0,
    live = true
  const panes = new Set<HTMLElement>()
  const clear = (pane: HTMLElement) => {
    for (const name of ['--mat-pane', '--mat-glass', '--glass-blur'])
      pane.style.removeProperty(name)
  }
  // The page's colour laid over the picture, as luminance.
  const page = () => {
    const [r, g, b] = getComputedStyle(chat)
      .getPropertyValue('--bg-content')
      .trim()
      .match(/[0-9a-f]{2}/gi)!
      .map((value) => parseInt(value, 16))
    return luminance(r!, g!, b!)
  }
  const update = () => {
    frame = 0
    if (!table || !size || !live) return
    const box = chat.getBoundingClientRect(),
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
    const current = new Set(
      chat.querySelectorAll<HTMLElement>(
        '[data-glass="composer"][data-refracting], [data-glass="toolbar"][data-refracting]',
      ),
    )
    for (const pane of panes) if (!current.has(pane)) clear(pane)
    panes.clear()
    for (const pane of current) {
      panes.add(pane)
      const rect = pane.getBoundingClientRect()
      let low = 1,
        high = 0
      // Every cell the pane covers, in the picture as it is drawn behind the chat.
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
      for (let y = rect.top; y <= rect.bottom; y += step)
        for (let x = rect.left; x <= rect.right; x += step) {
          const [, cellLow, cellHigh] = cell(x, y)
          low = Math.min(low, cellLow!)
          high = Math.max(high, cellHigh!)
        }
      low = srgb(dim * under + (1 - dim) * low)
      high = srgb(dim * under + (1 - dim) * high)
      clear(pane)
      const base = Number(getComputedStyle(pane).backgroundColor.match(/[\d.]+(?=\)$)/)![0])
      const needed =
        theme === 'light'
          ? (tint.needed - low) / (1 - low)
          : (Math.min(1, high * 1.2) - tint.needed) / (Math.min(1, high * 1.2) - 0.13)
      const alpha = Math.min(tint.ceiling, Math.max(base, needed + 0.05))
      const colour = `rgb(${tint.colour.join(' ')} / ${alpha.toFixed(3)})`
      pane.style.setProperty('--mat-pane', colour)
      pane.style.setProperty('--mat-glass', colour)
      pane.style.setProperty('--glass-blur', `${tint.blur + 4 * Math.max(0, high - low)}px`)
    }
  }
  const schedule = () => {
    frame ||= requestAnimationFrame(update)
  }
  const resize = new ResizeObserver(schedule),
    changes = new MutationObserver(schedule)
  resize.observe(chat)
  changes.observe(chat, { childList: true, subtree: true, attributeFilter: ['data-refracting'] })
  void backdropTable(shown.id).then((value) => {
    table = value
    chat.style.setProperty('--backdrop-fill', value.average)
    schedule()
  })
  const image = new Image()
  image.src = backdropUrl(`${shown.id}.webp`)
  void image.decode().then(() => {
    size = { width: image.naturalWidth, height: image.naturalHeight }
    schedule()
  })
  return () => {
    live = false
    cancelAnimationFrame(frame)
    resize.disconnect()
    changes.disconnect()
    chat.style.removeProperty('--backdrop-fill')
    for (const pane of panes) clear(pane)
  }
}
