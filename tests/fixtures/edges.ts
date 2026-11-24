import { test, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/*
 * Close-ups of glass edges: a part of the window cut out at its device pixels and enlarged without
 * smoothing, so each pixel of the rim can be seen, and the same pixels read back for measuring.
 */
export interface Pixels {
  width: number
  height: number
  /** Device pixels per CSS pixel. */
  scale: number
  rgba: Uint8Array
}

/** The window's pixels under `clip` (CSS pixels), read back from a screenshot. */
export async function pixels(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<Pixels> {
  const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  const decoded = await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(image.width, image.height),
      context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const rgba = context.getImageData(0, 0, image.width, image.height).data
    let binary = ''
    for (let i = 0; i < rgba.length; i += 0x8000)
      binary += String.fromCharCode(...rgba.subarray(i, i + 0x8000))
    return { width: image.width, height: image.height, scale: devicePixelRatio, rgba: btoa(binary) }
  }, png.toString('base64'))
  return { ...decoded, rgba: new Uint8Array(Buffer.from(decoded.rgba, 'base64')) }
}

/** Writes `image` enlarged `factor` times per CSS pixel, every device pixel a sharp square. */
export async function enlarge(page: Page, image: Pixels, factor: number, path: string) {
  const data = await page.evaluate(
    async ({ image, factor }) => {
      const source = new OffscreenCanvas(image.width, image.height)
      const rgba = Uint8ClampedArray.from(atob(image.rgba), (c) => c.charCodeAt(0))
      source.getContext('2d')!.putImageData(new ImageData(rgba, image.width, image.height), 0, 0)
      const zoom = factor / image.scale,
        canvas = new OffscreenCanvas(
          Math.round(image.width * zoom),
          Math.round(image.height * zoom),
        ),
        context = canvas.getContext('2d')!
      context.imageSmoothingEnabled = false
      context.drawImage(source, 0, 0, canvas.width, canvas.height)
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary)
    },
    { image: { ...image, rgba: Buffer.from(image.rgba).toString('base64') }, factor },
  )
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from(data, 'base64'))
}

export interface Geometry {
  x: number
  y: number
  width: number
  height: number
  radius: number
}
export const geometry = (element: Locator): Promise<Geometry> =>
  element.evaluate((node) => {
    const { x, y, width, height } = node.getBoundingClientRect()
    return {
      x,
      y,
      width,
      height,
      radius: Math.min(
        parseFloat(getComputedStyle(node).borderTopLeftRadius),
        width / 2,
        height / 2,
      ),
    }
  })

/** Close-ups of a glass: its four corners, and its top edge where it runs straight. */
export async function closeUps(page: Page, element: Locator, name: string, factor = 6) {
  const shape = await geometry(element),
    margin = 4,
    side = Math.ceil(Math.min(Math.max(shape.radius + 14, 36), shape.width / 2 + margin)),
    tall = Math.ceil(Math.min(Math.max(shape.radius + 14, 36), shape.height / 2 + margin))
  const left = shape.x - margin,
    right = shape.x + shape.width + margin - side,
    top = shape.y - margin,
    bottom = shape.y + shape.height + margin - tall
  const regions = {
    'upper-left': { x: left, y: top, width: side, height: tall },
    'upper-right': { x: right, y: top, width: side, height: tall },
    'lower-left': { x: left, y: bottom, width: side, height: tall },
    'lower-right': { x: right, y: bottom, width: side, height: tall },
    'top-edge': {
      x: shape.x + shape.width / 2 - side / 2,
      y: top,
      width: side,
      height: Math.min(tall, 16),
    },
  }
  const images: Record<string, Pixels> = {}
  for (const [where, clip] of Object.entries(regions)) {
    images[where] = await pixels(page, clip)
    await enlarge(page, images[where]!, factor, test.info().outputPath(`${name}-${where}-6x.png`))
  }
  return { shape, margin, side, images }
}
