import type { Page } from '@playwright/test'

// Pictures drawn for the test, so nothing of anyone else's is used: black and white line art
// (strokes, hatching and solid shapes), a soft colour gradient, a flat grey `level-<n>` (sRGB
// level), and two that stand in for photographs people choose: saturated red fruit on green
// leaves, and a dark forest with shafts of light.
export type Picture = 'lineart' | 'gradient' | 'berries' | 'forest' | `level-${number}`

export async function picture(page: Page, kind: Picture) {
  const data = await page.evaluate(async (kind) => {
    const canvas = new OffscreenCanvas(1600, 1000),
      context = canvas.getContext('2d')!
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const blob = (x: number, y: number, r: number, colour: string, edge = 'transparent') => {
      const fill = context.createRadialGradient(x, y, 0, x, y, r)
      fill.addColorStop(0, colour)
      fill.addColorStop(1, edge)
      context.fillStyle = fill
      context.beginPath()
      context.arc(x, y, r, 0, Math.PI * 2)
      context.fill()
    }
    const grey = kind.match(/^level-(\d+)$/)
    if (grey) {
      context.fillStyle = `rgb(${grey[1]} ${grey[1]} ${grey[1]})`
      context.fillRect(0, 0, 1600, 1000)
    } else if (kind === 'berries') {
      context.fillStyle = '#2e7d32'
      context.fillRect(0, 0, 1600, 1000)
      for (let leaf = 0; leaf < 60; leaf++)
        blob(random() * 1600, random() * 1000, 60 + random() * 120, '#7cc242', 'rgba(46,125,50,0)')
      for (let berry = 0; berry < 40; berry++) {
        const x = random() * 1600,
          y = random() * 1000,
          r = 50 + random() * 70
        blob(x, y, r, '#e8172c', '#a50d1d')
        context.fillStyle = '#ffe14d'
        for (let seedDot = 0; seedDot < 14; seedDot++)
          context.fillRect(x + (random() - 0.5) * r, y + (random() - 0.5) * r, 4, 6)
      }
    } else if (kind === 'forest') {
      context.fillStyle = '#10261a'
      context.fillRect(0, 0, 1600, 1000)
      for (let shaft = 0; shaft < 6; shaft++) {
        const x = random() * 1600
        const light = context.createLinearGradient(x, 0, x + 300, 1000)
        light.addColorStop(0, 'rgba(255, 244, 200, 0.55)')
        light.addColorStop(1, 'rgba(255, 244, 200, 0)')
        context.fillStyle = light
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x + 90, 0)
        context.lineTo(x + 420, 1000)
        context.lineTo(x + 200, 1000)
        context.fill()
      }
      for (let trunk = 0; trunk < 26; trunk++) {
        context.fillStyle = random() < 0.5 ? '#2b1d12' : '#4a3422'
        context.fillRect(random() * 1600, 0, 14 + random() * 40, 1000)
      }
      for (let leaf = 0; leaf < 120; leaf++)
        blob(random() * 1600, random() * 1000, 20 + random() * 50, '#3f8f3a', 'rgba(16,38,26,0)')
    } else if (kind === 'gradient') {
      const gradient = context.createLinearGradient(0, 0, 1600, 1000)
      gradient.addColorStop(0, '#ff9a62')
      gradient.addColorStop(0.5, '#7c6cff')
      gradient.addColorStop(1, '#1fc8b4')
      context.fillStyle = gradient
      context.fillRect(0, 0, 1600, 1000)
    } else {
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
