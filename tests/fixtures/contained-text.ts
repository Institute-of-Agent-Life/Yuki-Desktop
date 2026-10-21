import { expect, type Locator } from '@playwright/test'

export async function expectContainedText(locator: Locator) {
  const geometry = await locator.evaluate((element) => {
    const rect = (box: DOMRect) => ({
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
    })
    const range = document.createRange()
    range.selectNodeContents(element)
    return {
      bounds: rect(element.getBoundingClientRect()),
      lines: [...range.getClientRects()].map(rect),
    }
  })
  expect(geometry.lines.length).toBeGreaterThan(0)
  for (const line of geometry.lines) {
    expect(line.top).toBeGreaterThanOrEqual(geometry.bounds.top)
    expect(line.bottom).toBeLessThanOrEqual(geometry.bounds.bottom)
    expect(line.left).toBeGreaterThanOrEqual(geometry.bounds.left)
    expect(line.right).toBeLessThanOrEqual(geometry.bounds.right)
  }
  return geometry
}
