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
export type SlabVariant = 'slab-thin' | 'slab' | 'slab-thick' | 'v3' | 'v4' | 'v5'
// bevel: its width in px (capped by the corner and the pane); bend: displacement at the rim in px;
// spread: dispersion around the bend (0: none).
export const slabs: Record<SlabVariant, { bevel: number; bend: number; spread: number }> = {
  'slab-thin': { bevel: 8, bend: 5, spread: 0 },
  slab: { bevel: 12, bend: 8, spread: 0.12 },
  'slab-thick': { bevel: 16, bend: 12, spread: 0 },
  v3: { bevel: 10, bend: 6, spread: 0 },
  v4: { bevel: 10, bend: 6, spread: 0 },
  v5: { bevel: 10, bend: 6, spread: 0 },
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
/*
 * v4: the lens of WWDC25 219 (00:48) and its controls as the main reference. The bend starts
 * further in (about a fifth of the radius) and grows smoothly to a strong pull at the rim; the
 * rim has a Fresnel band as well as the line; a whisper of dispersion where the bend is strongest.
 */
export const v4Look = {
  // Regular glass on controls, after the iOS 26.2 home screen's folders and Dock: a wide band
  // (0.45 of the corner) pulling inward up to 1.2 times its width, over a backdrop blurred
  // first, so the blur's soft shapes are warped into the "melted" blobs of real uneven glass.
  // The clear lens over the WWDC grid fits 0.19 / 2.16 / 4 instead (`lens` below).
  bevelRatio: 0.45,
  bendRatio: 1.2,
  profile: 2,
  wobble: 0.3,
  wobbleFrequency: 1.6,
  line: 0.4,
  lineAt: 0.5,
  lineWidth: 0.6,
  axis: 0.25,
  lobe: 2,
  bottom: 0,
  // Lit most on the anti-diagonal (upper right, lower left) as the WWDC lens is at 00:48, and
  // about half as much on the diagonal; that lens's light moves during its animation.
  anti: 1,
  other: 0.45,
  fresnel: 0.3,
  fresnelRatio: 0.06,
  glow: 0.03,
  glowWidth: 1,
  // Dispersion costs two more displacements per frame; on controls it is barely visible.
  spread: 0,
  // Light gathered in the body: the backdrop brightened by up to this much in the middle,
  // falling off as a Gaussian of the normalised distance from the centre.
  bodyGain: 0.28,
  bodyWidth: 0.7,
  // Its centre sits a little below the middle, as measured on the lens (positive is down).
  bodyY: 0.15,
}
const v4Dark: Partial<typeof v4Look> = {
  line: 0.3,
  fresnel: 0.16,
  glow: 0.12,
  glowWidth: 1.3,
  bodyGain: 0.2,
}
/*
 * v4's "uneven glass": a weak, low-frequency wobble over the whole pane, as if the slab were not
 * quite even. Like the body's light it is a small map stretched over the pane, applied as its own
 * displacement before the bevel's, so the bevel's maps keep being put together from slices.
 */
const wobbleMaps = new Map<number, string>()
function wobbleMap(frequency: number) {
  const cached = wobbleMaps.get(frequency)
  if (cached) return cached
  const size = 64,
    canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!,
    image = context.createImageData(size, size)
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = (((i + 0.5) / size) * 2 - 1) * frequency,
        v = (((j + 0.5) / size) * 2 - 1) * frequency
      const dx =
          (Math.sin(2.3 * u + 1.1 * v + 0.7) + 0.6 * Math.sin(1.3 * u - 2.9 * v + 2.1)) / 1.6,
        dy = (Math.sin(1.7 * u - 2.1 * v + 1.9) + 0.6 * Math.sin(-2.6 * u + 1.4 * v + 0.4)) / 1.6
      const k = (j * size + i) * 4
      image.data[k] = Math.round(128 + dx * 127)
      image.data[k + 1] = Math.round(128 + dy * 127)
      image.data[k + 2] = 128
      image.data[k + 3] = 255
    }
  context.putImageData(image, 0, 0)
  const url = canvas.toDataURL()
  wobbleMaps.set(frequency, url)
  return url
}
// The body's light map: small and stretched over the pane, as it changes only slowly.
const bodyMaps = new Map<string, string>()
function bodyMap(width: number, below: number) {
  const cached = bodyMaps.get(`${width}/${below}`)
  if (cached) return cached
  const size = 64,
    canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!,
    image = context.createImageData(size, size)
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1,
        v = ((j + 0.5) / size) * 2 - 1 - below
      const value = Math.round(255 * Math.exp(-((u * u + v * v) / (width * width))))
      const k = (j * size + i) * 4
      image.data[k] = image.data[k + 1] = image.data[k + 2] = value
      image.data[k + 3] = 255
    }
  context.putImageData(image, 0, 0)
  const url = canvas.toDataURL()
  bodyMaps.set(`${width}/${below}`, url)
  return url
}
/** The clear lens fitted to the WWDC25 219 grid (trace overlay in comparison.md). */
export const lensFit = { bevelRatio: 0.19, bendRatio: 2.16, profile: 4, wobble: 0 }
/*
 * v5: v4 plus what still told it apart from Apple's glass: a thick, glowing bevel about 2.5pt wide
 * with a darker contour inside it, bright on dark glass too; a lower-frequency melt (more blur
 * before the bend, contrast restored after); a dithered bend map, so the far grid lines seen near
 * the rim do not step into dashed rings; and a tint that deepens where the backdrop is busy.
 */
export const v5Look = {
  band: 0.62,
  bandAt: 1.1,
  bandWidth: 1.15,
  bandAxis: 0.7,
  contour: 0.28,
  contourAt: 2.9,
  contourWidth: 0.9,
  dither: 1,
  // How far the backdrop's brightness is pulled into the theme's range (0: not at all).
  adaptMax: 0.35,
}
const v5Dark: Partial<typeof v5Look> = { band: 0.5, contour: 0.4, adaptMax: 0.6 }
type Measured = 'v3' | 'v4' | 'v5'
export const isMeasured = (variant: SlabVariant): variant is Measured =>
  variant === 'v3' || variant === 'v4' || variant === 'v5'
const look = (variant: Measured = 'v3'): typeof v3Look & Record<string, number> => ({
  ...v3Look,
  ...(variant !== 'v3' ? v4Look : {}),
  ...(variant === 'v5' ? v5Look : {}),
  ...(document.documentElement.dataset.theme === 'dark'
    ? variant === 'v3'
      ? v3Dark
      : { ...v4Dark, ...(variant === 'v5' ? v5Dark : {}) }
    : {}),
  ...((globalThis as { __v3?: Partial<typeof v3Look> }).__v3 ?? {}),
})
/** The bevel a pane gets: never wider than 60% of its corner or a quarter of its short side. */
export const bevelOf = (variant: SlabVariant, width: number, height: number, radius: number) =>
  isMeasured(variant)
    ? // Fitted to Apple's lens over a grid (WWDC25 219, 00:48): a fraction of the corner's radius.
      Math.max(3, look(variant).bevelRatio * Math.min(radius, Math.min(width, height) / 2))
    : Math.max(4, Math.min(shapeOf(variant).bevel, radius * 0.6, Math.min(width, height) * 0.25))
// v3's bevel, bend and dispersion can be tuned like its light.
const shapeOf = (variant: SlabVariant) =>
  isMeasured(variant)
    ? { ...slabs[variant], ...pick(look(variant), ['bevel', 'bend', 'spread']) }
    : slabs[variant]
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
  measured: Measured | undefined,
) {
  const key = `${width}/${height}/${radius}/${bevel}/${scale}/${measured ? measured + JSON.stringify(look(measured)) : ''}`
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
  const v3 = look(measured)
  const displacement = paint((data, k, x, y, d) => {
    const t = -d / bevel,
      amount = measured ? (t >= 1 ? 0 : (1 - Math.max(0, t)) ** v3.profile) : bendAt(t),
      [nx, ny] = normal(x, y)
    // v5 dithers the 8-bit map: a strong bend otherwise steps 1px at a time into dashed curves.
    const noise = v3.dither ? (((k * 2654435761) >>> 0) / 4294967296 - 0.5) * v3.dither : 0
    data[k] = Math.round(128 - amount * nx * 127 + noise)
    data[k + 1] = Math.round(128 - amount * ny * 127 - noise)
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
      const diagonal = 2 * nx * ny,
        lobes = v3.anti
          ? Math.max(0, -diagonal) ** v3.lobe + (v3.other ?? 0) * Math.max(0, diagonal) ** v3.lobe
          : Math.abs(diagonal) ** v3.lobe
      const weight = v3.axis + (1 - v3.axis) * lobes + v3.bottom * Math.max(0, ny)
      // v4's Fresnel band: the rim brightening over a few percent of the radius.
      const fresnel = v3.fresnel
        ? v3.fresnel *
          weight *
          Math.exp(-inset / Math.max(0.8, (bevel / v3.bevelRatio) * (v3.fresnelRatio ?? 0.03)))
        : 0
      const line = Math.exp(-(((inset - v3.lineAt) / v3.lineWidth) ** 2)) * v3.line * weight
      const glow = v3.glow * Math.exp(-inset / v3.glowWidth)
      // v5's thick bevel: a glowing band about 2.5pt wide, almost even all round.
      const band = v3.band
        ? v3.band *
          ((v3.bandAxis ?? 0.7) + (1 - (v3.bandAxis ?? 0.7)) * lobes) *
          Math.exp(-(((inset - (v3.bandAt ?? 1)) / (v3.bandWidth ?? 1)) ** 2))
        : 0
      data[k] = data[k + 1] = data[k + 2] = 255
      data[k + 3] = Math.round(Math.min(1, line + glow + fresnel + band) * coverage * 255)
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
    // v3 and v4 have no line at the bevel's end; v5 has the thick bevel's inner contour.
    if (measured) {
      if (v3.contour)
        data[k + 3] = Math.round(
          Math.min(
            1,
            v3.contour * Math.exp(-(((-d - (v3.contourAt ?? 3)) / (v3.contourWidth ?? 1)) ** 2)),
          ) * 255,
        )
      return
    }
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
  // v5 paints its maps at no less than 2x: a strong bend from a 1x map steps a pixel at a time
  // into the dashed curves seen near a lens's rim.
  if (variant === 'v5') scale = Math.max(2, scale)
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
    isMeasured(variant) ? variant : undefined,
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
    bend = isMeasured(variant) ? maps.bevel * look(variant).bendRatio : shapeOf(variant).bend
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
  // v4: the whole pane wobbles a little first; the bevel then bends what the wobble left.
  let source = 'SourceGraphic'
  const wobble = variant === 'v4' || variant === 'v5' ? (look(variant).wobble ?? 0) : 0
  if (wobble) {
    add('feImage', {
      href: wobbleMap(look(variant as Measured).wobbleFrequency ?? 1.6),
      width: String(width),
      height: String(height),
      preserveAspectRatio: 'none',
      result: 'wobble-map',
    })
    add('feDisplacementMap', {
      in: source,
      in2: 'wobble-map',
      scale: String(2 * wobble * maps.bevel * look(variant as Measured).bendRatio),
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: 'wobbled',
    })
    source = 'wobbled'
  }
  const bent = (scale: number, result?: string) =>
    add('feDisplacementMap', {
      in: source,
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
  if (variant === 'v4' || variant === 'v5') {
    // Every bend above ends in the filter's last result; brighten it by the body's light.
    const last = filter.lastElementChild!
    last.setAttribute('result', 'bent')
    const v4 = look(variant)
    add('feImage', {
      href: bodyMap(v4.bodyWidth ?? 0.6, v4.bodyY ?? 0),
      width: String(width),
      height: String(height),
      preserveAspectRatio: 'none',
      result: 'body',
    })
    add('feComposite', {
      in: 'bent',
      in2: 'body',
      operator: 'arithmetic',
      k1: String(v4.bodyGain ?? 0),
      k2: '1',
      result: 'lit',
    })
  }
  if (variant === 'v5' && (look('v5').adaptMax ?? 0) > 0) {
    // A tint that follows what is behind, as Apple's glass darkens over bright content and lightens
    // over dark: the backdrop's brightness is compressed toward the theme's own range, so text of
    // the theme's colour stays legible over line art or photos. Per pixel and cheap; the local
    // contrast through blurred variance was tried and lost to 8-bit rounding and blocky blurs.
    const v5 = look('v5'),
      dark = document.documentElement.dataset.theme === 'dark'
    const compress = add('feComponentTransfer', { in: 'lit', result: 'compressed' })
    for (const channel of ['feFuncR', 'feFuncG', 'feFuncB'])
      add(
        channel,
        {
          type: 'table',
          tableValues: dark ? '0.04 0.1 0.16 0.21 0.25' : '0.66 0.76 0.85 0.92 0.97',
        },
        compress,
      )
    const strength = v5.adaptMax ?? 0.6
    add('feComposite', {
      in: 'lit',
      in2: 'compressed',
      operator: 'arithmetic',
      k2: String(1 - strength),
      k3: String(strength),
    })
  }
  svg.append(filter)
  document.body.append(svg)
  return { id, dispose: () => svg.remove() }
}
