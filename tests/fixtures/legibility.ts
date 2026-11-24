import type { Locator, Page } from '@playwright/test'

/** WCAG contrast between two sRGB colours. */
export const contrast = (a: number[], b: number[]) => {
  const luminance = (rgb: number[]) => {
    const [r, g, bl] = rgb.map((value) => {
      const c = value / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

/**
 * A text's colour against everything shown behind its glyphs, the text hidden: the worst 1% of
 * the pixels in the box of its glyphs (a text field's text is its own box). A translucent text's
 * colour is what it gives over each of those pixels (its alpha laid over the pixel), not its
 * colour alone.
 */
export async function legible(page: Page, text: Locator) {
  await text.scrollIntoViewIfNeeded()
  const colour = await text.evaluate((element) => getComputedStyle(element).color)
  await text.evaluate((element) => {
    element.setAttribute('data-measured', '')
    const style = document.createElement('style')
    style.id = 'measured-style'
    style.textContent =
      '[data-measured], [data-measured] * { color: transparent !important; caret-color: transparent !important }'
    document.head.append(style)
  })
  await page.waitForTimeout(100)
  const clip = await text.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const { x, y, width, height } = (
      element instanceof HTMLTextAreaElement ? element : range
    ).getBoundingClientRect()
    return { x, y, width, height }
  })
  const shot = await page.screenshot({ clip })
  await text.evaluate((element) => {
    element.removeAttribute('data-measured')
    document.getElementById('measured-style')!.remove()
  })
  const pixels = await page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = new OffscreenCanvas(image.width, image.height),
      context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const all = context.getImageData(0, 0, image.width, image.height).data,
      list: number[][] = []
    for (let k = 0; k < all.length; k += 4) list.push([all[k]!, all[k + 1]!, all[k + 2]!])
    return list
  }, shot.toString('base64'))
  // rgb(…) in levels, or color(srgb …) (a mixed colour) in 0–1.
  const scale = colour.startsWith('color(') ? 255 : 1
  const [r, g, b, alpha = 1] = colour
    .match(/\d+(\.\d+)?(e-?\d+)?/g)!
    .map(Number)
    .map((value, i) => (i < 3 ? value * scale : value))
  const ratios = pixels
    .map((pixel) =>
      contrast(
        [r!, g!, b!].map((value, i) => alpha * value + (1 - alpha) * pixel[i]!),
        pixel,
      ),
    )
    .sort((p, q) => p - q)
  return Math.round(ratios[Math.floor(ratios.length * 0.01)]! * 100) / 100
}

/**
 * The appearance the glass of `element` is to take over a picture of one's own (shown filling the
 * window, the page's colour laid over it by `dim`, 0–1), by what lies under it as the bubbles'
 * copy blurs it (10px; materials/appearance.ts): dark where the mean luma is below 0.41 and its
 * 90th percentile below 0.65, light where the mean is above 0.51 or the 90th percentile above 0.70
 * (bright spots under white ink), either between (it holds what it had).
 */
export async function appearanceFor(
  page: Page,
  element: Locator,
  picture: Buffer,
  dim: { colour: number[]; amount: number },
) {
  const box = (await element.boundingBox())!
  const { mean, high } = await page.evaluate(
    async ({ data, box, dim }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const width = innerWidth,
        height = innerHeight,
        scale = Math.max(width / image.width, height / image.height)
      const canvas = new OffscreenCanvas(width, height),
        context = canvas.getContext('2d')!
      context.filter = 'blur(10px)'
      // Drawn past the window's edges, so the blur keeps the picture's colour at them.
      const w = image.width * scale,
        h = image.height * scale
      context.drawImage(image, (width - w) / 2 - 40, (height - h) / 2 - 40, w + 80, h + 80)
      context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
      const pixels = context.getImageData(
        Math.max(0, Math.floor(box.x)),
        Math.max(0, Math.floor(box.y)),
        Math.max(1, Math.floor(box.width)),
        Math.max(1, Math.floor(box.height)),
      ).data
      const values: number[] = []
      for (let k = 0; k < pixels.length; k += 4) {
        const [r, g, b] = [0, 1, 2].map(
          (c) => dim.amount * dim.colour[c]! + (1 - dim.amount) * pixels[k + c]!,
        )
        values.push((0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255)
      }
      values.sort((p, q) => p - q)
      return {
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        high: values[Math.floor(values.length * 0.9)]!,
      }
    },
    { data: picture.toString('base64'), box, dim },
  )
  const expected = mean > 0.51 || high > 0.7 ? 'light' : mean < 0.41 && high < 0.65 ? 'dark' : null
  return { mean, high, expected }
}
