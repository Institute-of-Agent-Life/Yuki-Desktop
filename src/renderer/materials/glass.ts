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
 * The final glass (docs/reports/2026-11-23-liquid-glass, §11 and §15). The backdrop is blurred
 * first (materials.css), then bent inward over a wide band along the edge: the blur's soft shapes
 * are pressed together there into the melted, uneven look of thick glass. A faint low-frequency
 * wobble keeps the face from looking perfectly flat, and the body gathers light toward its middle.
 *
 * Shapes, fitted to Apple's glass: `band` is the bending band's width as a part of the corner's
 * radius, `bend` the pull at the rim in band widths, falling as (1 − t)^profile across the band.
 *   pane: toolbars, the composer, cards and sheets, after the iOS 26 folders and Dock;
 *   lens: a control held under the finger, the clear lens of WWDC25 219.
 */
const shapes = {
  pane: { band: 0.45, bend: 1.2, profile: 2, wobble: 0.3, least: 3 },
  lens: { band: 0.19, bend: 2.16, profile: 4, wobble: 0, least: 3 },
  // The slider's held thumb, measured on WWDC25 219's front-on slider (slider-v2.md §3.2): a flat
  // face and a rim a tenth of the radius wide, whose edge shows what lies 0.6 of the radius in.
  slider: { band: 0.1, bend: 6, profile: 0.5, wobble: 0, least: 1 },
} as const
/*
 * The rim's light, measured on the same glass: a line half a point in from the edge, brightest on
 * the upper-right and lower-left arcs (`lobe` sharpens them, `other` lights the opposite pair; the
 * straight sides keep a quarter), a Fresnel band over a few percent of the radius and a glow fading
 * inward. `body` is how much the middle is brightened.
 */
const lights = {
  pane: {
    light: { line: 0.4, other: 0.45, lobe: 2, fresnel: 0.3, glow: 0.03, glowWidth: 1, body: 0.28 },
    dark: { line: 0.3, other: 0.45, lobe: 2, fresnel: 0.16, glow: 0.12, glowWidth: 1.3, body: 0.2 },
  },
  lens: {
    light: {
      line: 0.6,
      other: 0.25,
      lobe: 1.2,
      fresnel: 0.3,
      glow: 0.03,
      glowWidth: 1,
      body: 0.28,
    },
    dark: {
      line: 0.6,
      other: 0.25,
      lobe: 1.2,
      fresnel: 0.16,
      glow: 0.12,
      glowWidth: 1.3,
      body: 0.2,
    },
  },
  // The slider's thumb draws its own rim (InteractiveControls.module.css) and gathers no light.
  slider: {
    light: { line: 0, other: 0, lobe: 1, fresnel: 0, glow: 0, glowWidth: 1, body: 0 },
    dark: { line: 0, other: 0, lobe: 1, fresnel: 0, glow: 0, glowWidth: 1, body: 0 },
  },
} as const
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
  rim: string
  slice: [number, number]
  border: [number, number]
  band: number
}
const lenses = new Map<string, Lens>()
let sequence = 0

/*
 * A rounded rectangle's bend and light depend only on the edge's direction and the distance to
 * it, the same all along a straight edge. So a glass is painted once as a tile just larger than
 * its corners along each side it is longer than that: its light is laid around the edge by the
 * browser (a mask border), and its bend is put together in the filter from the tile's corners and
 * edges over a neutral face. A new size only moves the pieces; nothing is painted again.
 *
 * The bend is painted at no less than 2x and dithered: a strong bend from a coarse 8-bit map steps
 * a pixel at a time into dashed rings near the rim.
 */
function lens(width: number, height: number, radius: number, kind: GlassKind): Lens {
  const scale = Math.min(3, Math.max(2, Math.ceil(devicePixelRatio))),
    shape = shapes[kinds[kind]],
    band = Math.max(shape.least, shape.band * radius),
    border = Math.ceil(Math.max(radius, band) + 2),
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
  // The signed distance field's own gradient: straight off a side, or off a corner's centre.
  const normal = (x: number, y: number) => {
    const qx = Math.abs(x) - hx + radius,
      qy = Math.abs(y) - hy + radius
    if (qx > 0 && qy > 0) {
      const length = Math.hypot(qx, qy)
      return [(Math.sign(x) * qx) / length, (Math.sign(y) * qy) / length] as const
    }
    return qx > qy ? ([Math.sign(x), 0] as const) : ([0, Math.sign(y)] as const)
  }
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
        if (distance > 1 / scale || -distance > band + 2) continue
        draw(image.data, (j * canvas.width + i) * 4, x, y, distance)
      }
    context.putImageData(image, 0, 0)
    return canvas
  }
  const bend = paint(
    new Uint32Array(new Uint8ClampedArray([128, 128, 128, 255]).buffer)[0]!,
    (data, k, x, y, distance) => {
      const t = -distance / band,
        amount = t >= 1 ? 0 : (1 - Math.max(0, t)) ** shape.profile,
        [nx, ny] = normal(x, y)
      const noise = ((k * 2654435761) >>> 0) / 4294967296 - 0.5
      data[k] = Math.round(128 - amount * nx * 127 + noise)
      data[k + 1] = Math.round(128 - amount * ny * 127 - noise)
    },
  )
  const rim = paint(0, (data, k, x, y, distance) => {
    const inset = Math.max(0, -distance),
      [nx, ny] = normal(x, y)
    const diagonal = 2 * nx * ny,
      lobes =
        Math.max(0, -diagonal) ** light.lobe + light.other * Math.max(0, diagonal) ** light.lobe
    const weight = 0.25 + 0.75 * lobes
    const line = Math.exp(-(((inset - 0.5) / 0.6) ** 2)) * light.line * weight,
      fresnel = light.fresnel * weight * Math.exp(-inset / Math.max(0.8, radius * 0.06)),
      glow = light.glow * Math.exp(-inset / light.glowWidth)
    // The outermost pixel is covered only partly, which smooths the curve.
    const coverage = Math.max(0, Math.min(1, 0.5 - distance * scale))
    data[k] = data[k + 1] = data[k + 2] = 255
    data[k + 3] = Math.round(Math.min(1, line + fresnel + glow) * coverage * 255)
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
  const pieces: Lens['pieces'] = []
  for (const [sx, sw, x] of cuts(across, bend.width))
    for (const [sy, sh, y] of cuts(down, bend.height)) {
      // The face, the middle of both sliced axes, bends nothing: the neutral flood shows there.
      if (across && down && x.length === null && y.length === null) continue
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      canvas.getContext('2d')!.drawImage(bend, sx, sy, sw, sh, 0, 0, sw, sh)
      pieces.push({ href: canvas.toDataURL(), x, y })
    }
  const result: Lens = {
    pieces,
    rim: rim.toDataURL(),
    slice: [down ? border * scale : 0, across ? border * scale : 0],
    border: [down ? border : 0, across ? border : 0],
    band,
  }
  // A handful of kinds, radii and short sides: kept.
  lenses.set(key, result)
  return result
}

// Small maps stretched over a whole pane, as they change only slowly across it.
function smallMap(paint: (u: number, v: number) => number[]) {
  const size = 64,
    canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!,
    image = context.createImageData(size, size)
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++)
      image.data.set(
        [...paint(((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1), 255],
        (j * size + i) * 4,
      )
  context.putImageData(image, 0, 0)
  return canvas.toDataURL()
}
let wobbleMap = '',
  bodyMap = ''
// A weak, low-frequency wobble: the slab is not quite even.
const wobble = () =>
  (wobbleMap ||= smallMap((i, j) => {
    const u = i * 1.6,
      v = j * 1.6
    const dx = (Math.sin(2.3 * u + 1.1 * v + 0.7) + 0.6 * Math.sin(1.3 * u - 2.9 * v + 2.1)) / 1.6,
      dy = (Math.sin(1.7 * u - 2.1 * v + 1.9) + 0.6 * Math.sin(-2.6 * u + 1.4 * v + 0.4)) / 1.6
    return [Math.round(128 + dx * 127), Math.round(128 + dy * 127), 128]
  }))
// The body's light: a Gaussian of the distance from a point a little below the middle.
const body = () =>
  (bodyMap ||= smallMap((u, v) => {
    const value = Math.round(255 * Math.exp(-(u * u + (v - 0.15) ** 2) / 0.49))
    return [value, value, value]
  }))

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
  const bends = useRef<{ wobble?: SVGElement; bevel: SVGElement; amount: number } | null>(null)
  const bend = (value: number) => {
    const current = bends.current
    if (!current) return
    current.bevel.setAttribute('scale', String(2 * current.amount * value))
    current.wobble?.setAttribute(
      'scale',
      String(2 * shapes[kinds[kind]].wobble * current.amount * value),
    )
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
    const root = document.documentElement,
      shape = shapes[kinds[kind]]
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
    // The bevel's map: its pieces merged over a neutral face. Then the whole pane wobbles a
    // little, the bevel bends what the wobble left, and the body's light brightens the middle.
    const merge = primitive('feMerge', { result: 'bevel' })
    const stretched = (href: string, result: string) =>
      primitive('feImage', { href, x: '0', y: '0', preserveAspectRatio: 'none', result })
    const wobbleImage = shape.wobble ? stretched(wobble(), 'wobble-map') : undefined,
      wobbleBend = shape.wobble
        ? primitive('feDisplacementMap', {
            in: 'SourceGraphic',
            in2: 'wobble-map',
            xChannelSelector: 'R',
            yChannelSelector: 'G',
            result: 'wobbled',
          })
        : undefined
    const bevelBend = primitive('feDisplacementMap', {
      in: wobbleBend ? 'wobbled' : 'SourceGraphic',
      in2: 'bevel',
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: 'bent',
    })
    const bodyImage = stretched(body(), 'body'),
      gain = primitive('feComposite', { in: 'bent', in2: 'body', operator: 'arithmetic', k2: '1' })
    filter.append(
      primitive('feFlood', { 'flood-color': '#808080', result: 'flat' }),
      merge,
      ...(wobbleImage && wobbleBend ? [wobbleImage, wobbleBend] : []),
      bevelBend,
      bodyImage,
      gain,
    )
    svg.append(filter)
    if (bending) document.body.append(svg)
    bends.current = { wobble: wobbleBend, bevel: bevelBend, amount: 0 }
    let size = '',
      shown = false,
      current: Lens | undefined,
      pieces: SVGElement[] = []
    // Gives the filter the pieces of a new lens.
    const assemble = (next: Lens) => {
      for (const piece of pieces) piece.remove()
      pieces = next.pieces.map((piece, index) =>
        primitive('feImage', {
          href: piece.href,
          preserveAspectRatio: 'none',
          result: `bevel-${index}`,
        }),
      )
      merge.before(...pieces)
      merge.replaceChildren(
        ...['flat', ...pieces.map((_, index) => `bevel-${index}`)].map((input) =>
          primitive('feMergeNode', { in: input }),
        ),
      )
    }
    // Lays the current pieces over a glass `w` by `h`.
    const layout = (w: number, h: number) => {
      for (const node of [filter, wobbleImage, bodyImage]) {
        node?.setAttribute('width', String(w))
        node?.setAttribute('height', String(h))
      }
      current!.pieces.forEach((piece, index) => {
        const [x, width] = place(piece.x, w),
          [y, height] = place(piece.y, h)
        for (const [key, value] of Object.entries({ x, y, width, height }))
          pieces[index]!.setAttribute(key, String(value))
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
      // stretch with it, and none are made while it moves.
      if (next !== size && !(dynamic && size)) {
        if (!shown && !dynamic && bending) materialise()
        shown = true
        const fresh = made ? lens(made.width, made.height, made.radius, kind) : lens(w, h, r, kind)
        if (fresh !== current) {
          current = fresh
          assemble(fresh)
          element.style.setProperty('--rim', `url("${fresh.rim}")`)
          element.style.setProperty('--rim-slice', fresh.slice.join(' '))
          element.style.setProperty(
            '--rim-border',
            fresh.border.map((value) => `${value}px`).join(' '),
          )
          bends.current!.amount = fresh.band * shape.bend
        }
      }
      if (next !== size) layout(w, h)
      size = next
      gain.setAttribute('k1', String(lights[kinds[kind]][theme()].body))
      if (bending) element.style.setProperty('--refract', `url(#${id})`)
      element.dataset.refracting = 'true'
      // While it bends in, the rising spring alone sets its strength.
      if (!rising) bend(strength.current)
    }
    // Transparency and the theme's light change the maps; a page writing the same value again
    // changes nothing.
    const appearanceOf = () => `${root.dataset.opaque}/${theme()}`
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
    appearance.observe(root, { attributes: true, attributeFilter: ['data-opaque', 'data-theme'] })
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
