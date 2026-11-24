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
 * the pixels in the box of its glyphs (a text field's text is its own box).
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
  const rgb = colour
    .match(/\d+(\.\d+)?/g)!
    .slice(0, 3)
    .map(Number)
  const ratios = pixels.map((pixel) => contrast(rgb, pixel)).sort((a, b) => a - b)
  return Math.round(ratios[Math.floor(ratios.length * 0.01)]! * 100) / 100
}
