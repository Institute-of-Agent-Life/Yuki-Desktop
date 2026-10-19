import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const svg = readFileSync('resources/icon.svg', 'utf8')
mkdirSync('resources/icons/app', { recursive: true })
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  writeFileSync(
    `resources/icons/app/${size}x${size}.png`,
    new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } })
      .render()
      .asPng(),
  )
}
const tray = svg.replace(/<rect[^>]*\/>/, '').replace('stroke="#fff"', 'stroke="#1D1D1F"')
for (const [suffix, size] of [
  ['', 16],
  ['@2x', 32],
]) {
  writeFileSync(
    `resources/icons/trayTemplate${suffix}.png`,
    new Resvg(tray, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } })
      .render()
      .asPng(),
  )
}
