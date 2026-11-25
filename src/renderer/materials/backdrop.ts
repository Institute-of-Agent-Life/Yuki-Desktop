import type { BackdropTable, CustomBackdrop } from '../../shared/desktop'
import { unwrap } from '../queries/client'
import { dockColour } from './dock'

/*
 * A picture of the person's own behind the conversation (docs/reports/2026-11-23-liquid-glass
 * §12). Chromium decodes it here, as it does avatars: a copy no longer than twice the screen's
 * long side is made in WebP, and its average colour; the main process keeps all three under the
 * picture's SHA-256 and serves them back under app://desktop/__backgrounds/.
 */
export const backdropUrl = (name: string) => `app://desktop/__backgrounds/${name}`

// The picture's average colour, which fills where it is not drawn: the mean of a 256 × 256
// scaling of it.
function measure(image: ImageBitmap): BackdropTable {
  const side = 256,
    context = new OffscreenCanvas(side, side).getContext('2d')!
  context.drawImage(image, 0, 0, side, side)
  const data = context.getImageData(0, 0, side, side).data,
    sums = [0, 0, 0]
  for (let k = 0; k < data.length; k += 4) for (let c = 0; c < 3; c++) sums[c]! += data[k + c]!
  const hex = sums
    .map((sum) =>
      Math.round(sum / (side * side))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
  return { average: `#${hex}` }
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
 * The bubbles' and content's frost is the picture blurred once as the Dock's glass blurs it, in the
 * Dock's colour of the theme shown (`--backdrop-picture-frost`).
 */
/**
 * Follows the window's custom backdrop with its glass, in whichever theme is shown, until called:
 * once for the whole window (App.tsx), whatever page is shown.
 */
export function followBackdrop(backdrop: CustomBackdrop) {
  const root = document.documentElement
  const theme = (): 'light' | 'dark' => (root.dataset.theme === 'dark' ? 'dark' : 'light')
  let shownTheme = theme(),
    stop = followIn(backdrop, shownTheme)
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
  }
}

function followIn(backdrop: CustomBackdrop, theme: 'light' | 'dark') {
  const shown = shownBackdrop(backdrop, theme),
    // What the backdrop's variables are given on: the window.
    root = document.documentElement
  let size: { width: number; height: number } | undefined,
    frame = 0,
    live = true,
    frosted = 0,
    frostUrl: string | undefined
  const update = () => {
    frame = 0
    if (!size || !live) return
    // The picture lies under the whole window (App.module.css).
    const fit = backdrop.fit,
      cover = Math.max(innerWidth / size.width, innerHeight / size.height),
      contain = Math.min(innerWidth / size.width, innerHeight / size.height)
    const scale = fit === 'fill' ? cover : fit === 'fit' ? contain : 1
    // The bubbles' frost: the picture blurred once as a bubble's glass blurs it (--bubble-blur, in
    // CSS pixels), in its own pixels as it is drawn.
    root.style.setProperty(
      '--backdrop-frost-size',
      `${size.width * scale}px ${size.height * scale}px`,
    )
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
    // The Dock's colour of the theme (dock.ts), as the glass's filter gives it.
    const pixels = context.getImageData(0, 0, width, height),
      data = pixels.data,
      colour = dockColour(theme, Number(root.dataset.glassTint ?? 0.49))
    for (let k = 0; k < data.length; k += 4) {
      const [red, green, blue] = colour(data[k]!, data[k + 1]!, data[k + 2]!)
      data[k] = red!
      data[k + 1] = green!
      data[k + 2] = blue!
    }
    context.putImageData(pixels, 0, 0)
    const url = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
    if (!live || radius !== frosted) return URL.revokeObjectURL(url)
    if (frostUrl) URL.revokeObjectURL(frostUrl)
    frostUrl = url
    root.style.setProperty('--backdrop-picture-frost', `url("${url}")`)
  }
  const schedule = () => {
    frame ||= requestAnimationFrame(update)
  }
  const resize = new ResizeObserver(schedule)
  resize.observe(root)
  addEventListener('resize', schedule)
  void backdropTable(shown.id).then((value) => {
    if (live) root.style.setProperty('--backdrop-fill', value.average)
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
    root.style.removeProperty('--backdrop-frost-size')
    root.style.removeProperty('--backdrop-picture-frost')
    if (frostUrl) URL.revokeObjectURL(frostUrl)
  }
}
