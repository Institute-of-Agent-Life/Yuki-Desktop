import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const svg = readFileSync('resources/icon.svg', 'utf8')
mkdirSync('resources/icons/app', { recursive: true })
const png = {}
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  png[size] = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng()
  writeFileSync(`resources/icons/app/${size}x${size}.png`, png[size])
}
// macOS reads PNG data in the 16/32 px @1x slots (icp4/icp5, ic04/ic05) as raw ARGB and draws
// noise in System Settings and other small icons. Write only the slots Apple's iconutil stores
// as PNG; 16 and 32 pt @1x scale down from the @2x images.
const entries = [
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
].map(([type, size]) => Buffer.concat([chunk(type, 8 + png[size].length), png[size]]))
writeFileSync(
  'resources/icons/app/icon.icns',
  Buffer.concat([chunk('icns', 8 + Buffer.concat(entries).length), ...entries]),
)
function chunk(type, length) {
  const header = Buffer.alloc(8)
  header.write(type, 'latin1')
  header.writeUInt32BE(length, 4)
  return header
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
