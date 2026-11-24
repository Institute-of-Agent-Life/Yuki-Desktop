import type { Page } from '@playwright/test'

// Pictures drawn for the test, so nothing of anyone else's is used: black and white line art
// (strokes, hatching and solid shapes), and a soft colour gradient. The wallpapers stand in for
// the kinds of photographs and drawings people choose: busy manga-like line art with screen
// tone, a saturated deep blue with an orange creature trailing red lines, a bright valley under a
// pale sky, saturated red fruit on green leaves, and a dark forest with shafts of light.
export type Picture = 'lineart' | 'gradient' | Wallpaper
export const wallpapers = ['manga', 'jellyfish', 'valley', 'berries', 'forest'] as const
export type Wallpaper = (typeof wallpapers)[number]

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
    const wander = (width: number, colour: string, steps: number, reach: number) => {
      context.lineWidth = width
      context.strokeStyle = colour
      context.beginPath()
      let x = random() * 1600,
        y = random() * 1000
      context.moveTo(x, y)
      for (let step = 0; step < steps; step++)
        context.lineTo((x += (random() - 0.5) * reach), (y += (random() - 0.5) * reach))
      context.stroke()
    }
    if (kind === 'manga') {
      context.fillStyle = '#fbfbf8'
      context.fillRect(0, 0, 1600, 1000)
      // Screen tone: dots on a grid over half the page.
      context.fillStyle = '#222'
      for (let y = 0; y < 1000; y += 6)
        for (let x = 0; x < 1600; x += 6)
          if (Math.sin(x / 260) + Math.cos(y / 180) > 0.4) context.fillRect(x, y, 2, 2)
      // Speed lines from a point.
      context.strokeStyle = '#111'
      for (let ray = 0; ray < 220; ray++) {
        const angle = random() * Math.PI * 2
        context.lineWidth = 0.5 + random() * 2
        context.beginPath()
        context.moveTo(1100 + Math.cos(angle) * 160, 420 + Math.sin(angle) * 160)
        context.lineTo(1100 + Math.cos(angle) * 1400, 420 + Math.sin(angle) * 1400)
        context.stroke()
      }
      for (let stroke = 0; stroke < 260; stroke++)
        wander(1 + random() * 5, random() < 0.85 ? '#111' : '#fff', 8, 70)
    } else if (kind === 'jellyfish') {
      const sea = context.createLinearGradient(0, 0, 0, 1000)
      sea.addColorStop(0, '#0b3fae')
      sea.addColorStop(1, '#0a2a8f')
      context.fillStyle = sea
      context.fillRect(0, 0, 1600, 1000)
      blob(820, 330, 300, '#ff7a1a', 'rgba(255, 122, 26, 0)')
      blob(420, 640, 260, '#ffb02e', 'rgba(255, 176, 46, 0)')
      blob(180, 860, 220, '#f59a23', 'rgba(245, 154, 35, 0)')
      for (let line = 0; line < 70; line++) wander(1 + random() * 2, '#b4122c', 10, 160)
    } else if (kind === 'valley') {
      const sky = context.createLinearGradient(0, 0, 0, 520)
      sky.addColorStop(0, '#9cc8f2')
      sky.addColorStop(1, '#eef5fb')
      context.fillStyle = sky
      context.fillRect(0, 0, 1600, 1000)
      for (const [top, colour] of [
        [420, '#7e9a6a'],
        [520, '#4f7a3c'],
        [640, '#2f5a26'],
      ] as const) {
        context.fillStyle = colour
        context.beginPath()
        context.moveTo(0, 1000)
        for (let x = 0; x <= 1600; x += 40)
          context.lineTo(x, top + Math.sin(x / 170 + top) * 60 + random() * 20)
        context.lineTo(1600, 1000)
        context.fill()
      }
      context.strokeStyle = '#d9ecf7'
      context.lineWidth = 46
      context.beginPath()
      context.moveTo(620, 1000)
      context.bezierCurveTo(760, 820, 640, 720, 860, 600)
      context.stroke()
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
