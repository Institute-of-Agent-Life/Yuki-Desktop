import type { Locator } from '@playwright/test'

export async function colorBoundary(crop: Locator) {
  return crop.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, canvas.height / 4, canvas.width, 1)
    let previous = pixels.data[0]! - pixels.data[2]!
    for (let x = 1; x < canvas.width; x++) {
      const current = pixels.data[x * 4]! - pixels.data[x * 4 + 2]!
      if (previous <= 0 && current > 0) {
        // Interpolate the painted edge; one canvas pixel spans 220/280 CSS px in the short view.
        const fraction = -previous / (current - previous)
        return ((x - 1 + fraction + 0.5) / canvas.width) * canvas.getBoundingClientRect().width
      }
      previous = current
    }
    throw Error('Decoded EXIF image has no blue/red boundary')
  })
}
