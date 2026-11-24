import { useLayoutEffect, useRef } from 'react'
import { reducedMotion } from '../motion/hooks'
import { sampleSpring, springs } from '../motion/spring'

const NS = 'http://www.w3.org/2000/svg'

/*
 * A backdrop filter draws its result over what lies beneath rather than in its place. Over a
 * solid page the two cannot be told apart; over the window's frost the blurred backdrop is itself
 * half clear, and the sharp content shows through it. Every backdrop filter therefore ends in this
 * seal (`--seal`, set only while the frost is on): whatever has any cover becomes opaque, and
 * what is wholly clear stays clear, so the system's own frost still shows where nothing is drawn.
 */
{
  const svg = document.createElementNS(NS, 'svg'),
    filter = document.createElementNS(NS, 'filter'),
    transfer = document.createElementNS(NS, 'feComponentTransfer'),
    alpha = document.createElementNS(NS, 'feFuncA')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  filter.id = 'yuki-backdrop-seal'
  alpha.setAttribute('type', 'linear')
  alpha.setAttribute('slope', '8')
  transfer.append(alpha)
  filter.append(transfer)
  svg.append(filter)
  document.body.append(svg)
}

/*
 * Liquid Glass as measured on iOS 26 (the owner's screenshots registered against their own
 * wallpapers): the backdrop is blurred (materials.css), then bent inward over a band along the
 * edge, lifted a little and lit at the rim.
 *
 * The bend always samples from further inside, along the inward normal: a pixel at depth d shows
 * what lies D(d) deeper, D(d) = A·(e^(−d/λ) − e^(−w/λ)) up to the band's width w. D falls faster
 * than d grows near the rim, so the band shows the strip just inside it mirrored and pressed
 * together, as the rounded rim of real glass reflects it. The lens is a part's own, not its
 * radius's or height's:
 *   pane: toolbars, the composer, cards and sheets, after the Lock Screen's platters and buttons
 *     (A 21.1, λ 2.62, w 7.5pt: 19.9pt at the rim, the fold at 5.5pt);
 *   lens: a control held under the finger, the clear lens of WWDC25 219;
 *   slider: its held thumb (slider-v2.md §3.2): a rim a tenth of the radius wide showing what lies
 *     0.6 of the radius in.
 * Near a corner the bend follows a rounder shape (the normal of a corner `turn` times as large):
 * iOS's corners bend so, not along the visible circle's own normal.
 */
interface Shape {
  /** How far a pixel at depth `d` (CSS px) from the edge samples deeper, for a corner `radius`. */
  bend(d: number, radius: number): number
  /** Where the band ends. */
  reach(radius: number): number
  turn: number
}
const exponential = (amplitude: number, decay: number, width: number): Shape => ({
  bend: (d) =>
    d >= width ? 0 : amplitude * (Math.exp(-Math.max(0, d) / decay) - Math.exp(-width / decay)),
  reach: () => width,
  turn: 1.4,
})
const power = (band: number, pull: number, profile: number, least: number): Shape => ({
  bend: (d, radius) => {
    const width = Math.max(least, band * radius),
      t = Math.max(0, d) / width
    return t >= 1 ? 0 : pull * width * (1 - t) ** profile
  },
  reach: (radius) => Math.max(least, band * radius),
  turn: 1,
})
const shapes = {
  pane: exponential(21.1, 2.62, 7.5),
  lens: power(0.19, 2.16, 4, 3),
  slider: power(0.1, 6, 0.5, 1),
} satisfies Record<string, Shape>
/*
 * The light, measured on the same glass. The face is lifted evenly by `lift` (about 20 levels,
 * neutral: no tint and no extra saturation). The rim adds the same to red, green and blue on top of
 * what the bend shows, so it keeps the colour of what lies just inside: E·f(θ)·r(d), with θ the
 * outward normal's angle (0° right, 90° up), the light fixed at the upper left:
 *   f(θ) = clamp(0.5 + cos 2(θ − 135°), 0, 1)·(0.8 + 0.4·sin²θ): brightest on the upper-left and
 *     lower-right corners, about 0.7 along the top and bottom, 0.5 along the sides, nothing on the
 *     upper-right and lower-left;
 *   r(d) = clamp(1.15 − 0.88·d, 0, 1): about 1.2pt wide, brightest at the outermost pixel.
 * It is laid on as white of that strength (X + a·(1 − X)), which iOS's grey rows prefer and which
 * never clips a pale page to white; E is iOS's 72 on dark glass and 60 on light, whose white tint
 * already lies close to white over a pale page. No colours are parted, no shade lies within and no ring
 * around it.
 */
const lights = {
  pane: { light: { lift: 20, rim: 60 }, dark: { lift: 20, rim: 72 } },
  lens: { light: { lift: 20, rim: 60 }, dark: { lift: 20, rim: 72 } },
  // The slider's thumb draws its own rim (InteractiveControls.module.css).
  slider: { light: { lift: 0, rim: 0 }, dark: { lift: 0, rim: 0 } },
} as const
/** The rim's strength by the outward normal's angle (radians, 0 right, π/2 up). */
export const rimAngle = (theta: number) =>
  Math.min(1, Math.max(0, 0.5 + Math.cos(2 * (theta - (3 * Math.PI) / 4)))) *
  (0.8 + 0.4 * Math.sin(theta) ** 2)
/** The rim's strength by depth (CSS px). */
export const rimDepth = (d: number) => Math.min(1, Math.max(0, 1.15 - 0.88 * d))
const kinds = {
  toolbar: 'pane',
  composer: 'pane',
  card: 'pane',
  sheet: 'pane',
  slider: 'slider',
  toggle: 'lens',
  segment: 'lens',
} as const
export type GlassKind = keyof typeof kinds
const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

export function roundedDistance(x: number, y: number, hx: number, hy: number, radius: number) {
  const qx = Math.abs(x) - hx + radius,
    qy = Math.abs(y) - hy + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

// Where a piece of the bend map lies along one side of the glass, in CSS pixels: `offset` from
// the start (or from the end), `length` long, or all that lies between two offsets when null.
interface Span {
  offset: number
  length: number | null
  end: boolean
}
const place = (span: Span, size: number) =>
  [
    span.end ? size - span.offset : span.offset,
    Math.max(0, span.length ?? size - 2 * span.offset),
  ] as const
interface Lens {
  pieces: { href: string; x: Span; y: Span }[]
  /** The rim's light map cut the same way, laid over a clear face for the filter. */
  rimPieces: { href: string; x: Span; y: Span }[]
  rim: string
  slice: [number, number]
  border: [number, number]
  /** The bend map's full scale: the largest bend, twice over (a map value runs ±0.5 of it). */
  span: number
}
const lenses = new Map<string, Lens>()
let sequence = 0

/*
 * A rounded rectangle's bend and light depend only on the edge's direction and the distance to
 * it, the same all along a straight edge. So a glass is painted once as a tile just larger than
 * its corners along each side it is longer than that, and put together in the filter from the
 * tile's corners and edges over a neutral (or clear) face. A new size only moves the pieces;
 * nothing is painted again. The light is cut the same way; where nothing bends (no GPU
 * compositing) the browser lays it around the edge itself, as a mask border.
 *
 * The bend is painted at no less than 2x and dithered: a strong bend from a coarse 8-bit map steps
 * a pixel at a time into dashed rings near the rim.
 */
function lens(width: number, height: number, radius: number, kind: GlassKind): Lens {
  const scale = Math.min(3, Math.max(2, Math.ceil(devicePixelRatio))),
    shape: Shape = shapes[kinds[kind]],
    reach = shape.reach(radius)
  // The rounder shape whose normal the bend follows near a corner.
  const turned = Math.min(radius * shape.turn, width / 2, height / 2),
    border = Math.ceil(Math.max(turned, reach) + 2),
    tile = 2 * border + 1
  const across = width > tile,
    down = height > tile
  const w = across ? tile : width,
    h = down ? tile : height,
    look = theme()
  const key = `${w}/${h}/${radius}/${kind}/${scale}/${look}`
  const cached = lenses.get(key)
  if (cached) return cached
  const light = lights[kinds[kind]][look],
    hx = w / 2,
    hy = h / 2
  // The outward normal of a rounded rectangle with corners `corner`: straight off a side, or off
  // a corner's centre.
  const normal = (x: number, y: number, corner: number) => {
    const qx = Math.abs(x) - hx + corner,
      qy = Math.abs(y) - hy + corner
    if (qx > 0 && qy > 0) {
      const length = Math.hypot(qx, qy)
      return [(Math.sign(x) * qx) / length, (Math.sign(y) * qy) / length] as const
    }
    return qx > qy ? ([Math.sign(x), 0] as const) : ([0, Math.sign(y)] as const)
  }
  const span = 2 * Math.max(1, shape.bend(0, radius))
  // Paints a map over the tile, visiting only pixels from just outside the edge to just past the
  // band: the face keeps the map's starting value.
  const paint = (
    start: number,
    draw: (data: Uint8ClampedArray, k: number, x: number, y: number, distance: number) => void,
  ) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const context = canvas.getContext('2d')!,
      image = context.createImageData(canvas.width, canvas.height)
    new Uint32Array(image.data.buffer).fill(start)
    for (let j = 0; j < canvas.height; j++)
      for (let i = 0; i < canvas.width; i++) {
        const x = (i + 0.5) / scale - hx,
          y = (j + 0.5) / scale - hy,
          distance = roundedDistance(x, y, hx, hy, radius)
        if (distance > 1 / scale || -distance > reach + 2) continue
        draw(image.data, (j * canvas.width + i) * 4, x, y, distance)
      }
    context.putImageData(image, 0, 0)
    return canvas
  }
  const bend = paint(
    new Uint32Array(new Uint8ClampedArray([128, 128, 128, 255]).buffer)[0]!,
    (data, k, x, y, distance) => {
      // Inward, as far as the lens says for this depth, along the rounder shape's normal.
      const amount = shape.bend(-distance, radius) / span,
        [nx, ny] = normal(x, y, turned)
      const noise = ((k * 2654435761) >>> 0) / 4294967296 - 0.5
      data[k] = Math.round(128 - amount * nx * 255 + noise)
      data[k + 1] = Math.round(128 - amount * ny * 255 - noise)
    },
  )
  // The rim's light: white whose alpha is its strength (premultiplied, it adds evenly to red,
  // green and blue).
  const rim = paint(0, (data, k, x, y, distance) => {
    const [nx, ny] = normal(x, y, radius),
      strength = (light.rim / 255) * rimAngle(Math.atan2(-ny, nx)) * rimDepth(-distance)
    // The outermost pixel is covered only partly, which smooths the curve.
    const coverage = Math.max(0, Math.min(1, 0.5 - distance * scale))
    data[k] = data[k + 1] = data[k + 2] = 255
    data[k + 3] = Math.round(strength * coverage * 255)
  })
  // Each axis cut into its start, a middle one CSS pixel long that stretches along a straight
  // side, and its end; or kept whole where the glass is no longer than its tile.
  const cuts = (sliced: boolean, size: number) =>
    sliced
      ? ([
          [0, border * scale, { offset: 0, length: border, end: false }],
          [border * scale, scale, { offset: border, length: null, end: false }],
          [(border + 1) * scale, border * scale, { offset: border, length: border, end: true }],
        ] as const)
      : ([[0, size, { offset: 0, length: null, end: false }]] as const)
  // The face, the middle of both sliced axes, bends nothing and has no rim.
  const cut = (map: HTMLCanvasElement) => {
    const pieces: Lens['pieces'] = []
    for (const [sx, sw, x] of cuts(across, map.width))
      for (const [sy, sh, y] of cuts(down, map.height)) {
        if (across && down && x.length === null && y.length === null) continue
        const canvas = document.createElement('canvas')
        canvas.width = sw
        canvas.height = sh
        canvas.getContext('2d')!.drawImage(map, sx, sy, sw, sh, 0, 0, sw, sh)
        pieces.push({ href: canvas.toDataURL(), x, y })
      }
    return pieces
  }
  const result: Lens = {
    pieces: cut(bend),
    rimPieces: cut(rim),
    rim: rim.toDataURL(),
    slice: [down ? border * scale : 0, across ? border * scale : 0],
    border: [down ? border : 0, across ? border : 0],
    span,
  }
  // A handful of kinds, radii and short sides: kept.
  lenses.set(key, result)
  return result
}

// One listener moves the light source for the lit rims of buttons: a fixed-position gradient
// centred on the pointer. The position is written only on the elements that show it (registered,
// not inherited), so moving the pointer restyles those few rather than every node of a long
// conversation.
const lit = new Set<HTMLElement>()
let pointer: { x: number; y: number } | undefined
const light = (element: HTMLElement) => {
  if (pointer) {
    element.style.setProperty('--pointer-x', `${pointer.x}px`)
    element.style.setProperty('--pointer-y', `${pointer.y}px`)
  } else {
    element.style.removeProperty('--pointer-x')
    element.style.removeProperty('--pointer-y')
  }
}
let frame = 0
addEventListener(
  'pointermove',
  (event) => {
    pointer = { x: event.clientX, y: event.clientY }
    frame ||= requestAnimationFrame(() => {
      frame = 0
      for (const element of lit) light(element)
    })
  },
  { passive: true },
)
document.documentElement.addEventListener('pointerleave', () => {
  pointer = undefined
  for (const element of lit) light(element)
})
/** Lets `element`'s rim follow the pointer's light until the returned call. */
export function followPointer(element: HTMLElement) {
  lit.add(element)
  light(element)
  return () => {
    lit.delete(element)
  }
}

const primitive = (name: string, attributes: Record<string, string>) => {
  const node = document.createElementNS(NS, name)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
  return node
}

/**
 * Samples only the backdrop; foreground text remains on the original surface. A glass whose size
 * changes all the time (a held slider's thumb) can be given the size its maps are made for, once;
 * they stretch with it.
 */
export function useGlass<T extends HTMLElement>(
  kind: GlassKind,
  dynamic = false,
  enabled = true,
  made?: { width: number; height: number; radius: number },
) {
  const ref = useRef<T>(null),
    strength = useRef(dynamic ? 0 : 1)
  const bends = useRef<{ bevel: SVGElement; span: number } | null>(null)
  const bend = (value: number) => {
    const current = bends.current
    if (!current) return
    current.bevel.setAttribute('scale', String(current.span * value))
  }
  const setStrength = (value: number) => {
    const rising = !strength.current !== !value
    strength.current = Math.max(0, value)
    bend(strength.current)
    ref.current?.style.setProperty('--glass-pressure', String(Math.min(1, strength.current)))
    // A control turns to glass as it is pressed and back to its quiet self as it settles.
    if (dynamic && rising) attachment.current?.sync()
  }
  const attachment = useRef<
    { element: T; kind: GlassKind; sync(): void; dispose(): void } | undefined
  >(undefined)
  useLayoutEffect(() => {
    const element = enabled ? ref.current : null
    if (attachment.current?.element === element && attachment.current?.kind === kind) return
    attachment.current?.dispose()
    attachment.current = undefined
    if (!element || !CSS.supports('backdrop-filter', 'url(#glass)')) return
    const root = document.documentElement
    // Without GPU compositing (as the main process found at boot) every frame of a bend is drawn
    // on the CPU: the glass keeps its blur, tint and lit rim, and does not bend.
    const bending = root.dataset.gpuCompositing !== 'false'
    const svg = document.createElementNS(NS, 'svg'),
      id = `yuki-glass-${++sequence}`
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
    const filter = primitive('filter', {
      id,
      x: '0',
      y: '0',
      filterUnits: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB',
    })
    // The bevel's map: its pieces merged over a neutral face; the rim's light, over a clear one.
    // The blurred backdrop (materials.css) is bent by the map, lifted evenly, and the rim's light
    // added to it: the same on red, green and blue, so the rim keeps the colour of what the bend
    // brought to it.
    // A displacement map moves whole pixels: a fine line bent across the bevel steps and breaks
    // up, where Apple's stays a smooth curve. Half a pixel of blur after the bend joins it again.
    const merge = primitive('feMerge', { result: 'bevel' }),
      rimMerge = primitive('feMerge', { result: 'rim' })
    const bevelBend = primitive('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'bevel',
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: 'stepped',
    })
    const smooth = primitive('feGaussianBlur', {
      in: 'stepped',
      stdDeviation: '0.5',
      result: 'bent',
    })
    const lift = primitive('feComponentTransfer', { in: 'bent', result: 'lifted' })
    for (const name of ['feFuncR', 'feFuncG', 'feFuncB'])
      lift.append(primitive(name, { type: 'linear', slope: '1' }))
    // White of the rim's strength a over what was lifted: X + a·(1 − X), as k1·a·X + k2·a + k3·X.
    // The pane's tint (its background) lies over all this: the rim is strengthened by as much as
    // the tint takes away (`1 / (1 − tint)`), so the same light reaches the eye.
    const rimLight = primitive('feComposite', {
      in: 'rim',
      in2: 'lifted',
      operator: 'arithmetic',
      k3: '1',
    })
    filter.append(
      primitive('feFlood', { 'flood-color': '#808080', result: 'flat' }),
      merge,
      primitive('feFlood', { 'flood-opacity': '0', result: 'clear' }),
      rimMerge,
      bevelBend,
      smooth,
      lift,
      rimLight,
    )
    svg.append(filter)
    if (bending) document.body.append(svg)
    bends.current = { bevel: bevelBend, span: 0 }
    let size = '',
      shown = false,
      first = made,
      current: Lens | undefined,
      pieces: SVGElement[] = [],
      rimPieces: SVGElement[] = []
    // Gives the filter the pieces of a new lens.
    const assemble = (next: Lens) => {
      for (const piece of [...pieces, ...rimPieces]) piece.remove()
      const images = (list: Lens['pieces'], name: string) =>
        list.map((piece, index) =>
          primitive('feImage', {
            href: piece.href,
            preserveAspectRatio: 'none',
            result: `${name}-${index}`,
          }),
        )
      pieces = images(next.pieces, 'bevel')
      rimPieces = images(next.rimPieces, 'rim')
      merge.before(...pieces)
      merge.replaceChildren(
        ...['flat', ...pieces.map((_, index) => `bevel-${index}`)].map((input) =>
          primitive('feMergeNode', { in: input }),
        ),
      )
      rimMerge.before(...rimPieces)
      rimMerge.replaceChildren(
        ...['clear', ...rimPieces.map((_, index) => `rim-${index}`)].map((input) =>
          primitive('feMergeNode', { in: input }),
        ),
      )
    }
    // Lays the current pieces over a glass `w` by `h`.
    const layout = (w: number, h: number) => {
      filter.setAttribute('width', String(w))
      filter.setAttribute('height', String(h))
      for (const [list, nodes] of [
        [current!.pieces, pieces],
        [current!.rimPieces, rimPieces],
      ] as const)
        list.forEach((piece, index) => {
          const [x, width] = place(piece.x, w),
            [y, height] = place(piece.y, h)
          for (const [key, value] of Object.entries({ x, y, width, height }))
            nodes[index]!.setAttribute(key, String(value))
        })
    }
    // A pane appears by bending in, as Apple's glass materialises: its bend rises on the emerging
    // spring from nothing to its full strength, rather than being there at once.
    let rising = 0
    const materialise = () => {
      if (reducedMotion()) return
      const samples = sampleSpring(springs.emerge),
        start = performance.now()
      const step = (now: number) => {
        // A frame's time is when it began, which can be just before the spring started.
        const index = Math.min(
          samples.length - 1,
          Math.max(0, Math.round(((now - start) * 60) / 1000)),
        )
        bend(strength.current * Math.min(1, Math.max(0, samples[index]!.value)))
        rising = index < samples.length - 1 ? requestAnimationFrame(step) : 0
      }
      bend(0)
      rising = requestAnimationFrame(step)
    }
    const quiet = () => {
      element.style.removeProperty('--refract')
      element.style.removeProperty('--rim')
      element.style.removeProperty('--rim-slice')
      element.style.removeProperty('--rim-border')
      delete element.dataset.refracting
    }
    const sync = () => {
      // Without transparency nothing bends; a control at rest is quiet, as in Apple's glass.
      if (root.dataset.opaque === 'true' || (dynamic && !strength.current)) return quiet()
      const w = element.offsetWidth,
        h = element.offsetHeight
      if (!w || !h) return
      // A pane growing out of a button has a far larger corner mid-flight; its maps take the
      // corner it grows into, so it bends from its first frame and nothing changes once it lands.
      const landing = element
        .getAnimations()
        .map((animation) =>
          animation.effect instanceof KeyframeEffect
            ? animation.effect.getKeyframes().at(-1)
            : undefined,
        )
        .find((frame) => frame && 'borderRadius' in frame)?.borderRadius
      const style = getComputedStyle(element)
      const r = Math.min(
        parseFloat(String(landing ?? style.borderTopLeftRadius)) || 0,
        w / 2,
        h / 2,
      )
      const next = `${w}/${h}/${r}`
      // A held control stretches as it is pressed and dragged: the maps it was first given
      // stretch with it, and none are made while it moves. Made again for another theme, they
      // are made for that first size too, whatever size the control is caught at then.
      if (next !== size && !(dynamic && size)) {
        if (!shown && !dynamic && bending) materialise()
        shown = true
        if (dynamic) first ??= { width: w, height: h, radius: r }
        const fresh = first
          ? lens(first.width, first.height, first.radius, kind)
          : lens(w, h, r, kind)
        if (fresh !== current) {
          current = fresh
          assemble(fresh)
          element.style.setProperty('--rim', `url("${fresh.rim}")`)
          element.style.setProperty('--rim-slice', fresh.slice.join(' '))
          element.style.setProperty(
            '--rim-border',
            fresh.border.map((value) => `${value}px`).join(' '),
          )
          bends.current!.span = fresh.span
        }
      }
      if (next !== size) layout(w, h)
      size = next
      const look = lights[kinds[kind]][theme()]
      for (const func of lift.children) func.setAttribute('intercept', String(look.lift / 255))
      if (bending) element.style.setProperty('--refract', `url(#${id})`)
      const tint = Number(
        getComputedStyle(element).backgroundColor.match(/[\d.]+(?=\)$)/)?.[0] ?? 0,
      )
      const through = 1 / Math.max(0.1, 1 - Math.min(1, tint))
      rimLight.setAttribute('k1', String(-through))
      rimLight.setAttribute('k2', String(through))
      element.dataset.refracting = 'true'
      // While it bends in, the rising spring alone sets its strength.
      if (!rising) bend(strength.current)
    }
    // Transparency and the theme's light change the maps; a page writing the same value again
    // changes nothing.
    const appearanceOf = () => `${root.dataset.opaque}/${theme()}/${root.dataset.material}`
    let shownAs = appearanceOf()
    const resize = new ResizeObserver(sync),
      appearance = new MutationObserver(() => {
        if (appearanceOf() === shownAs) return
        shownAs = appearanceOf()
        size = ''
        sync()
      })
    // The border box: a drop entering adds padding around the same content, and its map must follow.
    resize.observe(element, { box: 'border-box' })
    appearance.observe(root, {
      attributes: true,
      attributeFilter: ['data-opaque', 'data-theme', 'data-material'],
    })
    sync()
    const dispose = () => {
      cancelAnimationFrame(rising)
      resize.disconnect()
      appearance.disconnect()
      svg.remove()
      bends.current = null
      quiet()
    }
    attachment.current = { element, kind, sync, dispose }
  })
  useLayoutEffect(
    () => () => {
      attachment.current?.dispose()
      attachment.current = undefined
    },
    [],
  )
  return { ref, setStrength }
}
