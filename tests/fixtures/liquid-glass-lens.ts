/*
 * Research prototype only (液态玻璃质感调研, 2026-11-23). Not imported by the app.
 *
 * Three ways to give the glass a shape, each built on the one before:
 *   curved  — the bend follows a convex squircle surface refracted by Snell's law, over a wider
 *             bezel, with dispersion on every floating pane and a slight magnification on buttons.
 *   volume  — curved, plus light computed from that surface's normals (a broad specular bevel lit
 *             from the upper left, a weaker reflection on the far edge, a Fresnel brightening all
 *             round), a shade on the bevel turned from the light, and layered inner/outer shadows.
 *   lit     — volume, with the specular bevel computed live by an SVG lighting filter
 *             (feSpecularLighting over the height map), its light following the pointer.
 * Maps are painted whole here; the production slicing of glass.ts would apply unchanged.
 */
import { roundedDistance } from '../../src/renderer/materials/glass'

const NS = 'http://www.w3.org/2000/svg'
export type Variant = 'curved' | 'volume' | 'lit'
export type LabKind = 'toolbar' | 'button' | 'composer' | 'card' | 'disc'
// [bezel width, bend (px of displacement at the steepest point), magnification, dispersion]
const shapes: Record<LabKind, [number, number, number, number]> = {
  toolbar: [15, 20, 0, 0.3],
  button: [20, 16, 0.16, 0.3],
  composer: [22, 26, 0, 0.3],
  card: [26, 22, 0, 0],
  disc: [26, 22, 0, 0],
}

// Convex squircle height across the bezel: 0 at the edge, 1 where the face turns flat.
const height = (t: number) => Math.pow(1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4), 0.25)
const slope = (t: number) => {
  const u = Math.min(1, Math.max(0.002, t))
  return Math.min(8, Math.pow(1 - u, 3) * Math.pow(1 - Math.pow(1 - u, 4), -0.75))
}
// Lateral shift of a ray entering a surface of this slope (n = 1.5) and crossing the glass below.
const shift = (t: number) => {
  const theta = Math.atan(slope(t)),
    refracted = Math.asin(Math.sin(theta) / 1.5)
  return Math.tan(theta - refracted) * (0.3 + height(t))
}
const peak = Math.max(...Array.from({ length: 200 }, (_, index) => shift(index / 200)))
// The profile sampled once: per-pixel trigonometry would dominate painting.
const steps = 1024
const table = (f: (t: number) => number) => {
  const values = Float32Array.from({ length: steps + 1 }, (_, index) => f(index / steps))
  return (t: number) => values[Math.round(Math.min(1, Math.max(0, t)) * steps)]!
}
const bendAt = table((t) => shift(t) / peak),
  tiltAt = table((t) => Math.sin(Math.atan(slope(t)))),
  heightAt = table(height),
  glint = table((x) => x ** 36)

export interface LabMaps {
  displacement: string
  height: string
  // Light and shade are slices laid round the edge by the browser, as glass.ts lays its rim.
  rim: string
  shade: string
  slice: string
  border: string
}
interface Tile {
  displacement: HTMLCanvasElement
  height?: HTMLCanvasElement
  rim: string
  shade: string
}
const tiles = new Map<string, Tile>()

/*
 * As glass.ts does: a rounded rectangle's maps depend only on the distance to the edge and its
 * direction, so one tile just larger than the corners is painted per kind and size class, and any
 * length is put together from its corners, edges and middle. Magnifying glass is painted whole.
 */
export function labMaps(
  width: number,
  height: number,
  radius: number,
  kind: LabKind,
  scale: number,
  variant: Variant,
): LabMaps {
  const [bezel, , zoom] = shapes[kind]
  const border = Math.ceil(Math.max(radius * 1.5, bezel + 2, 10)) + 1,
    tile = 2 * border + 1
  const across = !zoom && width > tile,
    down = !zoom && height > tile
  const painted = paintTile(
    across ? tile : width,
    down ? tile : height,
    radius,
    kind,
    scale,
    variant,
  )
  const resolution = Math.min(scale, 360 / Math.max(width, height))
  const compose = (source: HTMLCanvasElement) => {
    if (!across && !down) return source.toDataURL()
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * resolution))
    canvas.height = Math.max(1, Math.round(height * resolution))
    const context = canvas.getContext('2d')!
    const pieces = (sliced: boolean, from: number, to: number) => {
      if (!sliced) return [[0, from, 0, to]] as const
      const edge = border * scale,
        middle = from - 2 * edge,
        end = border * resolution
      return [
        [0, edge, 0, end],
        [edge, middle, end, to - 2 * end],
        [edge + middle, edge, to - end, end],
      ] as const
    }
    for (const [sx, sw, dx, dw] of pieces(across, source.width, canvas.width))
      for (const [sy, sh, dy, dh] of pieces(down, source.height, canvas.height))
        context.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh)
    return canvas.toDataURL()
  }
  return {
    displacement: compose(painted.displacement),
    height: painted.height ? compose(painted.height) : '',
    rim: painted.rim,
    shade: painted.shade,
    slice: `${down ? border * scale : 0} ${across ? border * scale : 0}`,
    border: `${down ? border : 0}px ${across ? border : 0}px`,
  }
}

function paintTile(
  width: number,
  height_: number,
  radius: number,
  kind: LabKind,
  scale: number,
  variant: Variant,
): Tile {
  // Each variant paints only the maps it shows: curved has no shade, only lit a height map.
  const key = `${width}/${height_}/${radius}/${kind}/${scale}/${variant}`
  const cached = tiles.get(key)
  if (cached) return cached
  const [bezel, , zoom] = shapes[kind]
  const hx = width / 2,
    hy = height_ / 2,
    normalRadius = Math.min(radius * 1.5, hx, hy)
  const normal = (x: number, y: number) => {
    const qx = Math.abs(x) - hx + normalRadius,
      qy = Math.abs(y) - hy + normalRadius
    if (qx > 0 && qy > 0) {
      const length = Math.hypot(qx, qy)
      return [(Math.sign(x) * qx) / length, (Math.sign(y) * qy) / length] as const
    }
    return qx > qy ? ([Math.sign(x), 0] as const) : ([0, Math.sign(y)] as const)
  }
  const paint = (
    resolution: number,
    draw: (data: Uint8ClampedArray, k: number, x: number, y: number, d: number) => void,
    start: number,
  ) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * resolution))
    canvas.height = Math.max(1, Math.round(height_ * resolution))
    const context = canvas.getContext('2d')!,
      image = context.createImageData(canvas.width, canvas.height)
    new Uint32Array(image.data.buffer).fill(start)
    for (let j = 0; j < canvas.height; j++) {
      const y = ((j + 0.5) * height_) / canvas.height - hy
      for (let i = 0; i < canvas.width; i++) {
        const x = ((i + 0.5) * width) / canvas.width - hx,
          d = roundedDistance(x, y, hx, hy, radius)
        if (d > 1 / resolution) continue
        if (!zoom && -d > bezel + 2) {
          // Rows clear of the bezel keep the starting value; jump to the far bezel.
          const far = Math.ceil(((hx - bezel - 2 + hx) * canvas.width) / width) - 1
          if (far > i && Math.abs(y) < hy - bezel - 2 - radius) i = far
          continue
        }
        draw(image.data, (j * canvas.width + i) * 4, x, y, d)
      }
    }
    context.putImageData(image, 0, 0)
    return canvas
  }
  const neutral = new Uint32Array(new Uint8ClampedArray([128, 128, 128, 255]).buffer)[0]!
  const displacement = paint(
    scale,
    (data, k, x, y, d) => {
      const t = -d / bezel,
        [nx, ny] = normal(x, y),
        amount = t < 1 ? bendAt(t) : 0
      let dx = -amount * nx,
        dy = -amount * ny
      if (zoom) {
        dx -= (zoom * x) / hx
        dy -= (zoom * y) / hy
      }
      data[k] = Math.round(128 + Math.max(-1, Math.min(1, dx)) * 127)
      data[k + 1] = Math.round(128 + Math.max(-1, Math.min(1, dy)) * 127)
    },
    neutral,
  )
  // Light from the upper left, a little above the screen; its reflection off the far inner wall.
  const light = normalize(-0.48, -0.72, 0.5),
    back = normalize(0.48, 0.72, 0.5),
    half = (l: readonly number[]) => normalize(l[0]!, l[1]!, l[2]! + 1)
  const h1 = half(light),
    h2 = half(back)
  const surface = (x: number, y: number, d: number) => {
    const t = -d / bezel,
      [nx, ny] = normal(x, y),
      sine = t < 1 ? tiltAt(t) : 0
    return [nx * sine, ny * sine, Math.sqrt(1 - sine * sine)] as const
  }
  const dot = (a: readonly number[], b: readonly number[]) =>
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  const rim = paint(
    scale,
    (data, k, x, y, d) => {
      const n = surface(x, y, d),
        inset = -d
      const spec = glint(dot(n, h1)) * 0.95 + glint(dot(n, h2)) * 0.5 + (1 - n[2]) ** 3 * 0.35
      const [nx, ny] = normal(x, y),
        toward = nx * light[0]! + ny * light[1]!
      // The crisp line on the very edge that current glass draws, kept for its sharpness.
      const line =
        Math.max(0, Math.min(1, 1 - inset / 1.25)) ** 0.6 *
        (Math.max(0, toward) ** 1.2 + 0.45 * Math.max(0, -toward) ** 1.2) *
        0.9
      const coverage = Math.max(0, Math.min(1, 0.5 - d * scale))
      data[k] = data[k + 1] = data[k + 2] = 255
      data[k + 3] = Math.round(Math.min(1, spec + line) * coverage * 255)
    },
    0,
  )
  const shade =
    variant === 'curved'
      ? undefined
      : paint(
          scale,
          (data, k, x, y, d) => {
            const t = -d / bezel
            if (t >= 1) return
            const [nx, ny] = normal(x, y),
              away = Math.max(0, nx * -light[0]! + ny * -light[1]!),
              tilt = tiltAt(t)
            const coverage = Math.max(0, Math.min(1, 0.5 - d * scale))
            data[k + 3] = Math.round(Math.min(1, away * tilt * 0.9 + tilt * 0.25) * coverage * 255)
          },
          0,
        )
  const heightMap =
    variant !== 'lit'
      ? undefined
      : paint(
          scale,
          (data, k, _x, _y, d) => {
            const coverage = Math.max(0, Math.min(1, 0.5 - d))
            data[k] = data[k + 1] = data[k + 2] = 0
            data[k + 3] = Math.round(heightAt(-d / bezel) * coverage * 255)
          },
          0,
        )
  const result = {
    displacement,
    height: heightMap,
    rim: rim.toDataURL(),
    shade: shade?.toDataURL() ?? '',
  }
  tiles.set(key, result)
  return result
}
function normalize(x: number, y: number, z: number) {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length] as const
}

/**
 * Builds the refraction filter of a pane: displacement (with dispersion where its kind has it)
 * and, for the `lit` variant, a live specular bevel. Returns the filter id and an updater for
 * the pointer's light.
 */
export function buildLabFilter(
  element: HTMLElement,
  kind: LabKind,
  variant: Variant,
  maps: LabMaps,
  width: number,
  height_: number,
) {
  const [, bend, , spread] = shapes[kind]
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  const filter = document.createElementNS(NS, 'filter'),
    id = `lab-glass-${Math.random().toString(36).slice(2)}`
  filter.id = id
  for (const [name, value] of Object.entries({
    x: '0',
    y: '0',
    width: String(width),
    height: String(height_),
    filterUnits: 'userSpaceOnUse',
    primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  }))
    filter.setAttribute(name, value)
  const add = (name: string, attributes: Record<string, string>, parent: Element = filter) => {
    const node = document.createElementNS(NS, name)
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
    parent.append(node)
    return node
  }
  add('feImage', {
    href: maps.displacement,
    width: String(width),
    height: String(height_),
    preserveAspectRatio: 'none',
    result: 'map',
  })
  const bent = (scale: number, result: string) =>
    add('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'map',
      scale: String(2 * scale),
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result,
    })
  if (spread) {
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
    const restore = add('feComponentTransfer', { in: 'thirds', result: 'bent' })
    for (const channel of ['feFuncR', 'feFuncG', 'feFuncB'])
      add(channel, { type: 'linear', slope: '3' }, restore)
  } else bent(bend, 'bent')
  let light: Element | undefined
  if (variant === 'lit') {
    add('feImage', {
      href: maps.height,
      width: String(width),
      height: String(height_),
      preserveAspectRatio: 'none',
      result: 'height',
    })
    const lighting = add('feSpecularLighting', {
      in: 'height',
      surfaceScale: String(shapes[kind][0] * 0.35),
      specularConstant: '0.9',
      specularExponent: '28',
      'lighting-color': '#ffffff',
      result: 'spec',
    })
    light = add(
      'fePointLight',
      { x: String(-width * 0.4), y: String(-height_ * 1.2), z: String(Math.max(width, 120)) },
      lighting,
    )
    add('feComposite', { in: 'spec', in2: 'height', operator: 'in', result: 'specIn' })
    add('feComposite', {
      in: 'bent',
      in2: 'specIn',
      operator: 'arithmetic',
      k2: '1',
      k3: '0.75',
    })
  }
  svg.append(filter)
  document.body.append(svg)
  const rect = () => element.getBoundingClientRect()
  return {
    id,
    // The light hangs above the pointer, so the bevel nearest it catches the highlight.
    point(x: number, y: number) {
      if (!light) return
      const box = rect()
      light.setAttribute('x', String(x - box.left))
      light.setAttribute('y', String(y - box.top))
    },
    dispose: () => svg.remove(),
  }
}
