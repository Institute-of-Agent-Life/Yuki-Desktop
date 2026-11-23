import { roundedDistance } from '../../src/renderer/materials/glass'

const NS = 'http://www.w3.org/2000/svg'
let sequence = 0

/*
 * The held thumb's glass, as measured on WWDC25 219's front-on slider (04m31s): the face is flat,
 * so the track seen through its middle keeps its size (1.00x); only a thin rim bends. At the very
 * edge a point shows what lies 0.6 of the radius further in, a tenth of the radius inside the edge
 * almost nothing, so the fill curls along the rim in a fine line, as in Apple's frames. The fall
 * across the rim is fitted to where the curled fill ends: (1 - inset / rim) ^ 0.5.
 *
 * `magnify` adds a centre magnification for comparison only (Apple's thumb measures 1.00).
 */
export function lensFilter(width: number, height: number, magnify = 1) {
  const radius = height / 2,
    bezel = 0.1 * radius,
    bend = 0.6 * radius,
    hx = width / 2,
    hy = height / 2,
    scale = Math.min(3, Math.max(1, Math.ceil(devicePixelRatio)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const context = canvas.getContext('2d')!,
    image = context.createImageData(canvas.width, canvas.height)
  // The largest offset the map can hold: the rim's bend, or the magnified edge's.
  const reach = Math.max(bend, (1 - 1 / magnify) * hx) + 1
  for (let j = 0; j < canvas.height; j++) {
    const y = (j + 0.5) / scale - hy
    for (let i = 0; i < canvas.width; i++) {
      const x = (i + 0.5) / scale - hx,
        inset = -roundedDistance(x, y, hx, hy, radius)
      // A capsule's outward normal: straight up or down along its sides, radial on its caps.
      const cx = Math.max(-(hx - radius), Math.min(hx - radius, x)),
        length = Math.hypot(x - cx, y) || 1,
        nx = (x - cx) / length,
        ny = y / length
      let dx = 0,
        dy = 0
      if (inset < bezel) {
        const arc = Math.sqrt(Math.min(1, 1 - inset / bezel))
        dx = -arc * nx * bend
        dy = -arc * ny * bend
      }
      if (magnify !== 1) {
        dx -= (1 - 1 / magnify) * x
        dy -= (1 - 1 / magnify) * y
      }
      const k = (j * canvas.width + i) * 4
      image.data[k] = Math.round(128 + Math.max(-1, Math.min(1, dx / reach)) * 127)
      image.data[k + 1] = Math.round(128 + Math.max(-1, Math.min(1, dy / reach)) * 127)
      image.data[k + 2] = 128
      image.data[k + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const svg = document.createElementNS(NS, 'svg'),
    filter = document.createElementNS(NS, 'filter'),
    map = document.createElementNS(NS, 'feImage'),
    warp = document.createElementNS(NS, 'feDisplacementMap'),
    id = `glass-slider-lens-${++sequence}`
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  filter.id = id
  for (const [key, value] of Object.entries({
    x: '0',
    y: '0',
    width: String(width),
    height: String(height),
    filterUnits: 'userSpaceOnUse',
    primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  }))
    filter.setAttribute(key, value)
  for (const [key, value] of Object.entries({
    x: '0',
    y: '0',
    width: String(width),
    height: String(height),
    preserveAspectRatio: 'none',
    result: 'map',
    href: canvas.toDataURL(),
  }))
    map.setAttribute(key, value)
  for (const [key, value] of Object.entries({
    in: 'SourceGraphic',
    in2: 'map',
    xChannelSelector: 'R',
    yChannelSelector: 'G',
    scale: '0',
  }))
    warp.setAttribute(key, value)
  filter.append(map, warp)
  svg.append(filter)
  document.body.append(svg)
  return {
    id,
    // The bend grows as the thumb clears: 0 when solid, the full measured bend when held.
    strength(value: number) {
      warp.setAttribute('scale', String(2 * reach * value))
    },
    // A held thumb stretches as it moves; its map stretches with it rather than being repainted.
    resize(w: number, h: number) {
      for (const node of [filter, map]) {
        node.setAttribute('width', String(w))
        node.setAttribute('height', String(h))
      }
    },
    dispose() {
      svg.remove()
    },
  }
}
