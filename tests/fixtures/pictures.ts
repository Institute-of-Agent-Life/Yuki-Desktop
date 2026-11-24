import type { Page } from '@playwright/test'

// Pictures drawn for the test, so nothing of anyone else's is used: black and white line art
// (strokes, hatching and solid shapes), and a soft colour gradient.
export async function picture(page: Page, kind: 'lineart' | 'gradient') {
  const data = await page.evaluate(async (kind) => {
    const canvas = new OffscreenCanvas(1600, 1000),
      context = canvas.getContext('2d')!
    if (kind === 'gradient') {
      const gradient = context.createLinearGradient(0, 0, 1600, 1000)
      gradient.addColorStop(0, '#ff9a62')
      gradient.addColorStop(0.5, '#7c6cff')
      gradient.addColorStop(1, '#1fc8b4')
      context.fillStyle = gradient
      context.fillRect(0, 0, 1600, 1000)
    } else {
      let seed = 7
      const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
      context.fillStyle = '#f4f4f4'
      context.fillRect(0, 0, 1600, 1000)
      context.fillStyle = '#111'
      for (let shape = 0; shape < 14; shape++) {
        context.beginPath()
        const x = random() * 1600,
          y = random() * 1000
        context.moveTo(x, y)
        for (let point = 0; point < 5; point++)
          context.lineTo(x + (random() - 0.5) * 420, y + (random() - 0.5) * 420)
        context.fill()
      }
      context.strokeStyle = '#111'
      for (let band = 0; band < 6; band++) {
        const y = random() * 1000
        context.lineWidth = 2
        for (let x = -200; x < 1600; x += 9) {
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x + 120, y - 120)
          context.stroke()
        }
      }
      for (let stroke = 0; stroke < 90; stroke++) {
        context.lineWidth = 3 + random() * 6
        context.strokeStyle = random() < 0.8 ? '#111' : '#fff'
        context.beginPath()
        let x = random() * 1600,
          y = random() * 1000
        context.moveTo(x, y)
        for (let step = 0; step < 6; step++)
          context.lineTo((x += (random() - 0.5) * 90), (y += (random() - 0.5) * 90))
        context.stroke()
      }
    }
    const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, kind)
  return Buffer.from(data, 'base64')
}
