/*
 * Research prototype only (液态玻璃质感调研 v2, 2026-11-23). Not imported by the app.
 *
 * Glass as a slightly thick flat slab with rounded edges. Its face is a plateau: constant height,
 * upright normal, no bend, so content seen through the middle is unchanged. Only a narrow bevel
 * along the edge curves, as a quarter circle h(d) = sqrt(1 - (1 - d/b)^2) of the signed distance
 * d to the rounded rectangle's edge (never the distance to the centre). In that bevel:
 *   - light bends inward along the edge's normal, strongest at the outer rim, nothing at the face;
 *   - a thin specular line runs where the bevel faces a fixed light (upper left), with a weaker
 *     internal reflection on the far sides, a hairline on the rim and a faint inner reflection;
 *   - a very thin dark line marks the bevel's inner end, the slab's other face seen through it.
 * Three thicknesses: thin (8px bevel), standard (12px, a light dispersion), thick (16px).
 */
import { roundedDistance } from '../../src/renderer/materials/glass'

const NS = 'http://www.w3.org/2000/svg'
export type SlabVariant = 'slab-thin' | 'slab' | 'slab-thick' | 'v3'
// bevel: its width in px (capped by the corner and the pane); bend: displacement at the rim in px;
// spread: dispersion around the bend (0: none).
export const slabs: Record<SlabVariant, { bevel: number; bend: number; spread: number }> = {
  'slab-thin': { bevel: 8, bend: 5, spread: 0 },
  slab: { bevel: 12, bend: 8, spread: 0.12 },
  'slab-thick': { bevel: 16, bend: 12, spread: 0 },
  v3: { bevel: 10, bend: 6, spread: 0 },
}
/*
 * v3: the light measured off Apple's own glass (HIG Materials, see comparison.md): no broad
 * specular band, but a line about half a point wide right on the rim, brightest on the diagonals
 * (upper left and lower right alike), with a glow fading about a point inward. Overridable while
 * tuning through `globalThis.__v3`.
 */
export const v3Look = {
  // The bend across the bevel falls as (1 - t)^profile; it reaches bendRatio × the bevel's width.
  bevelRatio: 0.16,
  bendRatio: 1.25,
  profile: 1.5,
  // The rim line: where (px in from the edge), how wide, how strong; `axis` is its strength on
  // straight sides relative to the diagonals, `lobe` how fast it falls off between, `bottom` an
  // extra on the lower edge. A glow fades inward from the edge.
  lineAt: 0.45,
  lineWidth: 0.5,
  line: 0.5,
  axis: 0.1,
  lobe: 2,
  bottom: 0.9,
  glow: 0.04,
  glowWidth: 1,
}
// Tuned against HIG Materials (round 5 in comparison.md): light and dark differ in their light.
const v3Dark: Partial<typeof v3Look> = {
  line: 0.24,
  axis: 0.35,
  bottom: 0.3,
  glow: 0.16,
  glowWidth: 1.3,
}
const look = (): typeof v3Look & Record<string, number> => ({
  ...v3Look,
  ...(document.documentElement.dataset.theme === 'dark' ? v3Dark : {}),
  ...((globalThis as { __v3?: Partial<typeof v3Look> }).__v3 ?? {}),
})
/** The bevel a pane gets: never wider than 60% of its corner or a quarter of its short side. */
export const bevelOf = (variant: SlabVariant, width: number, height: number, radius: number) =>
  variant === 'v3'
    ? // Fitted to Apple's lens over a grid (WWDC25 219, 00:48): about 16% of the corner's radius.
      Math.max(3, look().bevelRatio * Math.min(radius, Math.min(width, height) / 2))
    : Math.max(4, Math.min(shapeOf(variant).bevel, radius * 0.6, Math.min(width, height) * 0.25))
// v3's bevel, bend and dispersion can be tuned like its light.
const shapeOf = (variant: SlabVariant) =>
  variant === 'v3' ? { ...slabs.v3, ...pick(look(), ['bevel', 'bend', 'spread']) } : slabs[variant]
const pick = (from: Record<string, number>, keys: string[]) =>
  Object.fromEntries(Object.entries(from).filter(([key]) => keys.includes(key)))

// Across the bevel, t = d / b from the rim (0) to the face (1). The quarter circle's tilt from
// upright has sine 1 - t; a ray entering there bends by Snell's law (n = 1.5).
export const bevelHeight = (t: number) => (t >= 1 ? 1 : Math.sqrt(1 - (1 - Math.max(0, t)) ** 2))
const deviation = (sine: number) => Math.asin(sine) - Math.asin(sine / 1.5)
const rimDeviation = Math.tan(deviation(1))
/** Displacement across the bevel, 1 at the rim, 0 on the face. */
export const bevelBend = (t: number) =>
  t >= 1 ? 0 : Math.tan(deviation(1 - Math.max(0, t))) / rimDeviation

const steps = 1024
const table = (f: (t: number) => number) => {
  const values = Float32Array.from({ length: steps + 1 }, (_, index) => f(index / steps))
  return (t: number) => values[Math.round(Math.min(1, Math.max(0, t)) * steps)]!
}
const bendAt = table(bevelBend)
const normalize = (x: number, y: number, z: number) => {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length] as const
}
// A light from the upper left, 35° above the screen, and its internal reflection opposite.
const light = normalize(-0.5, -0.86, 0.7),
  half = (l: readonly number[]) => normalize(l[0]!, l[1]!, l[2]! + 1)
const front = half(light)

interface Tile {
  displacement: HTMLCanvasElement
  rim: string
  shade: string
}
const tiles = new Map<string, Tile>()

function paintTile(
  width: number,
  height: number,
  radius: number,
  bevel: number,
  scale: number,
  measured: boolean,
) {
  const key = `${width}/${height}/${radius}/${bevel}/${scale}/${measured ? JSON.stringify(look()) : ''}`
  const cached = tiles.get(key)
  if (cached) return cached
  const hx = width / 2,
    hy = height / 2
  // The signed distance field's own gradient: off a side, or radially off a corner's centre.
  const normal = (x: number, y: number) => {
    const qx = Math.abs(x) - hx + radius,
      qy = Math.abs(y) - hy + radius
    if (qx > 0 && qy > 0) {
      const length = Math.hypot(qx, qy)
      return [(Math.sign(x) * qx) / length, (Math.sign(y) * qy) / length] as const
    }
    return qx > qy ? ([Math.sign(x), 0] as const) : ([0, Math.sign(y)] as const)
  }
  const paint = (
    draw: (data: Uint8ClampedArray, k: number, x: number, y: number, d: number) => void,
    start: number,
  ) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')!,
      image = context.createImageData(canvas.width, canvas.height)
    new Uint32Array(image.data.buffer).fill(start)
    for (let j = 0; j < canvas.height; j++) {
      const y = (j + 0.5) / scale - hy
      for (let i = 0; i < canvas.width; i++) {
        const x = (i + 0.5) / scale - hx,
          d = roundedDistance(x, y, hx, hy, radius)
        if (d > 1 / scale) continue
        // The face: nothing to draw; jump across it to the far bevel.
        if (-d > bevel + 2) {
          const far = Math.ceil((2 * hx - bevel - 2) * scale) - 1
          if (far > i && Math.abs(y) < hy - bevel - 2 - radius) i = far
          continue
        }
        draw(image.data, (j * canvas.width + i) * 4, x, y, d)
      }
    }
    context.putImageData(image, 0, 0)
    return canvas
  }
  const neutral = new Uint32Array(new Uint8ClampedArray([128, 128, 128, 255]).buffer)[0]!
  const v3 = look()
  const displacement = paint((data, k, x, y, d) => {
    const t = -d / bevel,
      amount = measured ? (t >= 1 ? 0 : (1 - Math.max(0, t)) ** v3.profile) : bendAt(t),
      [nx, ny] = normal(x, y)
    data[k] = Math.round(128 - amount * nx * 127)
    data[k + 1] = Math.round(128 - amount * ny * 127)
  }, neutral)
  // Where the specular line sits: the bevel's tilt there halves the angle between the light and
  // the eye. Its brightness follows how squarely each edge faces the light, as under a broad source.
  const peak = 1 - Math.sqrt(1 - front[2]! ** 2),
    width_ = 0.6 + 0.04 * bevel
  const rim = paint((data, k, x, y, d) => {
    const coverage = Math.max(0, Math.min(1, 0.5 - d * scale))
    if (measured) {
      const inset = Math.max(0, -d),
        [nx, ny] = normal(x, y)
      const weight =
        v3.axis + (1 - v3.axis) * Math.abs(2 * nx * ny) ** v3.lobe + v3.bottom * Math.max(0, ny)
      const line = Math.exp(-(((inset - v3.lineAt) / v3.lineWidth) ** 2)) * v3.line * weight
      const glow = v3.glow * Math.exp(-inset / v3.glowWidth)
      data[k] = data[k + 1] = data[k + 2] = 255
      data[k + 3] = Math.round(Math.min(1, line + glow) * coverage * 255)
      return
    }
    const inset = Math.max(0, -d),
      t = inset / bevel,
      [nx, ny] = normal(x, y)
    const facing = (nx * light[0]! + ny * light[1]!) / Math.hypot(light[0]!, light[1]!)
    const specular =
      Math.exp(-((((t - peak) * bevel) / width_) ** 2)) *
      (0.15 + 0.85 * Math.max(0, facing) ** 1.5 + 0.35 * Math.max(0, -facing) ** 1.5)
    // The rim's hairline, brighter toward the light; and a faint reflection inside the bevel.
    const hairline =
      Math.max(0, Math.min(1, 1 - inset)) *
      (0.28 + 0.42 * Math.max(0, facing) + 0.12 * Math.max(0, -facing))
    const inner = t < 1 ? 0.07 * (1 - t) ** 2 : 0
    data[k] = data[k + 1] = data[k + 2] = 255
    data[k + 3] = Math.round(Math.min(1, specular * 0.85 + hairline + inner) * coverage * 255)
  }, 0)
  const shade = paint((data, k, x, y, d) => {
    // v3 has no line at the bevel's end: Apple's glass shows none.
    if (measured) return
    const inset = -d,
      [nx, ny] = normal(x, y)
    const facing = (nx * light[0]! + ny * light[1]!) / Math.hypot(light[0]!, light[1]!)
    // The slab's far face, seen through the bevel: a line a fraction of a pixel wide at its end.
    const line = Math.exp(-(((inset - bevel) / 0.55) ** 2)) * (0.55 + 0.45 * Math.max(0, -facing))
    data[k + 3] = Math.round(Math.min(1, line) * 255)
  }, 0)
  const result = { displacement, rim: rim.toDataURL(), shade: shade.toDataURL() }
  tiles.set(key, result)
  return result
}

export interface SlabMaps {
  displacement: string
  rim: string
  shade: string
  slice: string
  border: string
  bevel: number
}
/*
 * As glass.ts does: the maps depend only on the distance to the edge and its direction, so one
 * tile just larger than the corners is painted, and any length is put together from its corners,
 * edges and middle (the middle is the face: neutral).
 */
export function slabMaps(
  width: number,
  height: number,
  radius: number,
  variant: SlabVariant,
  scale: number,
): SlabMaps {
  const bevel = bevelOf(variant, width, height, radius)
  const border = Math.ceil(Math.max(radius, bevel) + 2),
    tile = 2 * border + 1
  const across = width > tile,
    down = height > tile
  const painted = paintTile(
    across ? tile : width,
    down ? tile : height,
    radius,
    bevel,
    scale,
    variant === 'v3',
  )
  let displacement: string
  if (!across && !down) displacement = painted.displacement.toDataURL()
  else {
    const source = painted.displacement,
      canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const context = canvas.getContext('2d')!
    const edge = border * scale
    const pieces = (sliced: boolean, from: number, to: number) =>
      sliced
        ? ([
            [0, edge, 0, edge],
            [edge, from - 2 * edge, edge, to - 2 * edge],
            [from - edge, edge, to - edge, edge],
          ] as const)
        : ([[0, from, 0, to]] as const)
    for (const [sx, sw, dx, dw] of pieces(across, source.width, canvas.width))
      for (const [sy, sh, dy, dh] of pieces(down, source.height, canvas.height))
        context.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)
    displacement = canvas.toDataURL()
  }
  return {
    displacement,
    rim: painted.rim,
    shade: painted.shade,
    slice: `${down ? border * scale : 0} ${across ? border * scale : 0}`,
    border: `${down ? border : 0}px ${across ? border : 0}px`,
    bevel,
  }
}

/** The pane's refraction: the bevel's bend, split into three colours where it disperses. */
export function slabFilter(variant: SlabVariant, maps: SlabMaps, width: number, height: number) {
  const { spread } = shapeOf(variant),
    bend = variant === 'v3' ? maps.bevel * look().bendRatio : shapeOf(variant).bend
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  const filter = document.createElementNS(NS, 'filter'),
    id = `slab-${Math.random().toString(36).slice(2)}`
  filter.id = id
  const add = (name: string, attributes: Record<string, string>, parent: Element = filter) => {
    const node = document.createElementNS(NS, name)
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
    parent.append(node)
    return node
  }
  for (const [name, value] of Object.entries({
    x: '0',
    y: '0',
    width: String(width),
    height: String(height),
    filterUnits: 'userSpaceOnUse',
    primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  }))
    filter.setAttribute(name, value)
  add('feImage', {
    href: maps.displacement,
    width: String(width),
    height: String(height),
    preserveAspectRatio: 'none',
    result: 'map',
  })
  const bent = (scale: number, result?: string) =>
    add('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'map',
      scale: String(2 * scale),
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      ...(result ? { result } : {}),
    })
  if (!spread) bent(bend)
  else {
    bent(bend * (1 - spread), 'red-bend')
    bent(bend, 'green-bend')
    bent(bend * (1 + spread), 'blue-bend')
    const only = (input: string, row: number, result: string) => {
      const rows = ['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0', '0 0 0 1 0']
      rows[row] = ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'][row]!
      add('feColorMatrix', { in: input, values: rows.join('  '), result })
    }
    only('red-bend', 0, 'red')
    only('green-bend', 1, 'green')
    only('blue-bend', 2, 'blue')
    add('feComposite', {
      in: 'red',
      in2: 'green',
      operator: 'arithmetic',
      k2: String(1 / 3),
      k3: String(1 / 3),
      result: 'rg',
    })
    add('feComposite', {
      in: 'rg',
      in2: 'blue',
      operator: 'arithmetic',
      k2: '1',
      k3: String(1 / 3),
      result: 'thirds',
    })
    const restore = add('feComponentTransfer', { in: 'thirds' })
    for (const channel of ['feFuncR', 'feFuncG', 'feFuncB'])
      add(channel, { type: 'linear', slope: '3' }, restore)
  }
  svg.append(filter)
  document.body.append(svg)
  return { id, dispose: () => svg.remove() }
}
