import { useLayoutEffect, useRef } from 'react'
import { reducedMotion } from '../motion/hooks'
import { sampleSpring, springs } from '../motion/spring'
import { watchAppearance, type Appearance } from './appearance'
import { dockFilter, dockLens, dockLift, dockRim } from './dock'
import { encodings, mapValues } from './display'

const NS = 'http://www.w3.org/2000/svg'

const primitive = (name: string, attributes: Record<string, string>) => {
  const node = document.createElementNS(NS, name)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
  return node
}

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

const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
const glassTint = () => Number(document.documentElement.dataset.glassTint ?? 0.49)

/*
 * The Dock's colour (dock.ts) as filter primitives reading `input`: its luminance, the tone curve
 * less the colour's gain on it (a table), added to the colour times its gain. `set` gives it an
 * appearance's and the slider's (or `toward` of the way there from another's, as it turns); a held
 * control's is none (the colour passes as it is).
 */
function dockColour(input: string, prefix: string) {
  const luma = primitive('feColorMatrix', { in: input, type: 'matrix', result: `${prefix}luma` }),
    curve = primitive('feComponentTransfer', { in: `${prefix}luma`, result: `${prefix}curve` }),
    combine = primitive('feComposite', {
      in: `${prefix}curve`,
      in2: input,
      operator: 'arithmetic',
      k2: '1',
      k4: String(-dockLift / 255),
      result: `${prefix}toned`,
    })
  for (const name of ['feFuncR', 'feFuncG', 'feFuncB'])
    curve.append(primitive(name, { type: 'table' }))
  return {
    nodes: [luma, curve, combine],
    input(name: string) {
      luma.setAttribute('in', name)
      combine.setAttribute('in2', name)
    },
    set(docked: boolean, appearance: Appearance = theme(), from = appearance, toward = 1) {
      const look = dockFilter(appearance, glassTint(), from, toward)
      luma.setAttribute('values', look.luma)
      for (const func of curve.children)
        func.setAttribute(
          'tableValues',
          docked ? look.curve : `${dockLift / 255} ${dockLift / 255}`,
        )
      combine.setAttribute('k3', String(docked ? look.gain : 1))
    },
  }
}

/*
 * The Dock's colour for glass that carries no filter of its own (`--glass-native`,
 * materials.css), one for each appearance (the theme's, or what a glass has taken: appearance.ts),
 * for the slider shown now.
 */
for (const look of ['light', 'dark'] as const) {
  const svg = document.createElementNS(NS, 'svg'),
    filter = document.createElementNS(NS, 'filter')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
  filter.id = `yuki-glass-tone-${look}`
  filter.setAttribute('color-interpolation-filters', 'sRGB')
  const colour = dockColour('SourceGraphic', '')
  // What nothing lies behind stays clear: the sums give back the backdrop's alpha.
  filter.append(
    ...colour.nodes,
    primitive('feComposite', { in: 'toned', in2: 'SourceGraphic', operator: 'in' }),
  )
  const update = () => colour.set(true, look)
  update()
  new MutationObserver(update).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-glass-tint'],
  })
  svg.append(filter)
  document.body.append(svg)
}

/*
 * The lens. The bend always samples from further inside, along the inward normal: a pixel at depth
 * d shows what lies D(d) deeper, up to the band's width, so the band shows the strip just inside it
 * mirrored and pressed together, as the rounded rim of real glass reflects it. The lens is a
 * part's own, not its radius's or height's:
 *   pane: the Dock's (dock.ts), for the sidebar, toolbars, the composer, cards and sheets;
 *   lens: a control held under the finger, the clear lens of WWDC25 219;
 *   slider: its held thumb (slider-v2.md §3.2): a rim a tenth of the radius wide showing what lies
 *     0.6 of the radius in.
 * Near a corner the bend follows a rounder shape (the normal of a corner `turn` times as large).
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
  pane: exponential(dockLens.amplitude, dockLens.decay, dockLens.width),
  lens: power(0.19, 2.16, 4, 3),
  slider: power(0.1, 6, 0.5, 1),
} satisfies Record<string, Shape>
/*
 * The rim (dock.ts): what the lens shows, mixed toward black and lifted by the same levels on red,
 * green and blue, so it keeps its colour. The slider's thumb draws its own (InteractiveControls.module.css). Only panes
 * take the Dock's colour; a held control stays clear.
 */
const rimmed = { pane: true, lens: true, slider: false } as const
/*
 * A huge pane draws no rim: a pane that carries text sized by its short side (`sized` below) past
 * 200pt (the sidebar, 245pt across) is read as a sheet of glass the window floats, not an object
 * with an edge, so only its lens bends the picture at the border. The composer (at most 200pt
 * tall), bubbles, toolbar capsules, buttons, menus and sheets keep theirs, whatever their size.
 * The same short side sets such a pane's blur (paneBlur below).
 */
const huge = (kind: GlassKind, width: number, height: number) =>
  sized.has(kind) && Math.min(width, height) > 200
const kinds = {
  sidebar: 'pane',
  toolbar: 'pane',
  composer: 'pane',
  card: 'pane',
  sheet: 'pane',
  send: 'pane',
  slider: 'slider',
  toggle: 'lens',
  segment: 'lens',
} as const
export type GlassKind = keyof typeof kinds
// The glass that takes the appearance of what lies under it (appearance.ts): what carries text,
// menus and sheets among it, each by its own backdrop rather than the glass it opens from. The send
// button's circle takes its composer's.
const adaptive = new Set<GlassKind>(['sidebar', 'toolbar', 'composer', 'card', 'sheet'])
/*
 * A pane that carries text is blurred as Apple's clear glass blurs a pane of its size, measured on
 * NSGlassEffectView over the same pictures (the native captures, fitted with a Gaussian and a
 * straight tone): 10pt for a pane 42pt across its short side (the composer), 20pt for 148pt (a
 * bubble) and 245pt (the sidebar), every picture alike; so σ = min(20, 0.24 × the short side), in
 * pt. Small controls (the toolbar's capsules, the send button, held controls) keep the Dock's 2pt.
 */
const sized = new Set<GlassKind>(['sidebar', 'composer'])
export const paneBlur = (short: number) => Math.round(2 * Math.min(20, 0.24 * short)) / 2

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
  /** The bend across (x) and down (y) and the rim's mix and levels, each cut into pieces. */
  maps: Record<'bevel', { href: string; x: Span; y: Span }[]>
  /** The bend map's full scale: the largest bend, twice over (a map value runs ±0.5 of it). */
  span: number
  /**
   * Whether its pieces are decoded. A filter laid before its images have loaded reads an empty map
   * (no bend, the rim's levels all −128) for as long as they take, which a slow machine shows as a
   * dark flash: the glass is laid once they are.
   */
  decoded: Promise<void>
}
const lenses = new Map<string, Lens>()
// The rim's mix toward black where there is none, in the map's blue.
const mixRest = 0.25
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
function lens(
  width: number,
  height: number,
  radius: number,
  kind: GlassKind,
  look: Appearance,
): Lens {
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
    h = down ? tile : height
  const space = document.documentElement.dataset.displayColorSpace
  const edged = rimmed[kinds[kind]] && !huge(kind, width, height)
  const key = `${w}/${h}/${radius}/${kind}/${scale}/${space}/${look}/${edged}`
  const cached = lenses.get(key)
  if (cached) return cached
  const hx = w / 2,
    hy = h / 2,
    values = mapValues(space)
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
  // One map: the bend inward, as far as the lens says for this depth, along the rounder shape's
  // normal, across in red and down in green; the rim (dock.ts) by the outward normal's angle and
  // the depth, its mix toward black in blue (as 0.25 + mix, so that it can be less than none),
  // the three made (display.ts) to read as meant where the display converts them, and its added
  // levels in alpha as 128 + levels (which no colour management touches). The rim's outermost
  // pixel is covered only partly, which smooths the curve.
  const rest = values(0.5, 0.5, mixRest).map((value) => Math.round(value * 255))
  const bend = paint(
    new Uint32Array(new Uint8ClampedArray([rest[0]!, rest[1]!, rest[2]!, 128]).buffer)[0]!,
    (data, k, x, y, distance) => {
      const amount = shape.bend(-distance, radius) / span,
        [nx, ny] = normal(x, y, turned)
      const noise = (((k * 2654435761) >>> 0) / 4294967296 - 0.5) / 255
      const [rx, ry] = normal(x, y, radius),
        coverage = Math.max(0, Math.min(1, 0.5 - distance * scale))
      const rim = edged
        ? dockRim(look, Math.atan2(Math.abs(rx), Math.abs(ry)), -distance)
        : { mix: 0, add: 0 }
      const shown = values(
        0.5 - amount * nx + noise,
        0.5 - amount * ny - noise,
        mixRest + rim.mix * coverage,
      )
      data[k] = Math.round(shown[0] * 255)
      data[k + 1] = Math.round(shown[1] * 255)
      data[k + 2] = Math.round(shown[2] * 255)
      data[k + 3] = Math.round(128 + rim.add * coverage)
    },
  )
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
  // Every piece, the face too: the map's alpha is laid over nothing, so it is all there is.
  const cut = (map: HTMLCanvasElement) => {
    const pieces: Lens['maps']['bevel'] = []
    for (const [sx, sw, x] of cuts(across, map.width))
      for (const [sy, sh, y] of cuts(down, map.height)) {
        const canvas = document.createElement('canvas')
        canvas.width = sw
        canvas.height = sh
        canvas.getContext('2d')!.drawImage(map, sx, sy, sw, sh, 0, 0, sw, sh)
        pieces.push({ href: canvas.toDataURL(), x, y })
      }
    return pieces
  }
  const bevel = cut(bend)
  const result: Lens = {
    maps: { bevel },
    span,
    decoded: Promise.all(
      bevel.map((piece) => {
        const image = new Image()
        image.src = piece.href
        return image.decode()
      }),
    ).then(() => undefined),
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
    // on the CPU: the glass keeps its blur, its colour and its rim, and does not bend (the chain
    // below without its displacement and the smoothing after it).
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
    // The bend and the rim, each its pieces merged (they tile the glass; lens()). The blurred
    // backdrop (materials.css) is bent by the one, given the Dock's colour (a pane's own: a held
    // control stays clear), then mixed toward black and lifted by the rim (the map's blue and alpha).
    // A displacement map moves whole pixels: a fine line bent across the bevel steps and breaks
    // up, where Apple's stays a smooth curve. A pixel's smoothing after the bend joins it again.
    const merges = { bevel: primitive('feMerge', { result: 'bevel' }) }
    const bevelBend = primitive('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'bevel',
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: 'stepped',
    })
    // The half pixel of blur reaches past the glass's edge, where the filter has nothing: the
    // outermost pixels made whole again keep the colour of what lies within.
    const smooth = primitive('feGaussianBlur', {
      in: 'stepped',
      stdDeviation: '0.5',
      result: 'soft',
    })
    const cover = primitive('feComponentTransfer', { in: 'SourceGraphic', result: 'cover' })
    cover.append(primitive('feFuncA', { type: 'discrete', tableValues: '0 1 1 1 1 1 1 1' }))
    const whole = primitive('feColorMatrix', {
      in: bending ? 'soft' : 'SourceGraphic',
      type: 'matrix',
      values: '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1',
      result: 'bent',
    })
    const docked = kinds[kind] === 'pane'
    // The Dock's colour (a held control stays clear), worked out in sRGB (display.ts): the
    // backdrop taken from the display's encoding into sRGB's before, and back after.
    const encoding = (input: string, result: string) => {
      const node = primitive('feComponentTransfer', { in: input, result })
      for (const name of ['feFuncR', 'feFuncG', 'feFuncB'])
        node.append(primitive(name, { type: 'identity' }))
      return node
    }
    const intoSRGB = encoding('bent', 'srgb'),
      outOfSRGB = encoding('lit', 'shown')
    const colour = dockColour('srgb', '')
    filter.append(
      merges.bevel,
      ...(bending ? [bevelBend, smooth] : []),
      whole,
      intoSRGB,
      ...colour.nodes,
      // The rim (dock.ts), out = (1 − mix)·toned + added, on red, green and blue alike: the map's
      // blue as the share kept (halved, so that a little more than all is kept where the mix is
      // less than none), and its alpha as a grey (128 the neutral).
      primitive('feColorMatrix', {
        in: 'bevel',
        type: 'matrix',
        values: [0, 1, 2]
          .map(() => `0 0 -0.5 0 ${(1 + mixRest) / 2}`)
          .concat('0 0 0 0 1')
          .join(' '),
        result: 'kept',
      }),
      primitive('feComposite', {
        in: 'toned',
        in2: 'kept',
        operator: 'arithmetic',
        k1: '2',
        result: 'mixed',
      }),
      primitive('feColorMatrix', {
        in: 'bevel',
        type: 'matrix',
        values: '0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 1',
        result: 'rimGrey',
      }),
      primitive('feComposite', {
        in: 'rimGrey',
        in2: 'mixed',
        operator: 'arithmetic',
        k2: '1',
        k3: '1',
        k4: String(-128 / 255),
        result: 'added',
      }),
      // What nothing lies behind stays clear; what anything lies behind is whole (the backdrop's
      // own edge is half covered where the glass's lies between device pixels).
      cover,
      primitive('feComposite', { in: 'added', in2: 'cover', operator: 'in', result: 'lit' }),
      outOfSRGB,
    )
    svg.append(filter)
    document.body.append(svg)
    bends.current = { bevel: bevelBend, span: 0 }
    let size = '',
      shown = false,
      first = made,
      current: Lens | undefined
    // Gives the filter the pieces of a new lens.
    let images: Record<keyof Lens['maps'], SVGElement[]> = { bevel: [] }
    const assemble = (next: Lens) => {
      for (const list of Object.values(images)) for (const image of list) image.remove()
      images = { bevel: [] }
      for (const name of ['bevel'] as const) {
        images[name] = next.maps[name].map((piece, index) =>
          primitive('feImage', {
            href: piece.href,
            preserveAspectRatio: 'none',
            result: `${name}-${index}`,
          }),
        )
        merges[name].before(...images[name])
        merges[name].replaceChildren(
          ...images[name].map((_, index) => primitive('feMergeNode', { in: `${name}-${index}` })),
        )
      }
    }
    // Lays the current pieces over a glass `w` by `h`.
    const layout = (w: number, h: number) => {
      filter.setAttribute('width', String(w))
      filter.setAttribute('height', String(h))
      for (const name of ['bevel'] as const)
        current!.maps[name].forEach((piece, index) => {
          const [x, width] = place(piece.x, w),
            [y, height] = place(piece.y, h)
          for (const [key, value] of Object.entries({ x, y, width, height }))
            images[name][index]!.setAttribute(key, String(value))
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
    // Glass that carries text takes the appearance of what lies under it (appearance.ts): its
    // colour turns from the one to the other over 200ms, and its rim is made again for it once it
    // has turned (made during the turn, it would hold up the turn's frames).
    const unwatch = adaptive.has(kind) ? watchAppearance(element) : undefined
    const appearanceNow = (): Appearance =>
      (element.dataset.appearance as Appearance | undefined) ?? theme()
    let shownAppearance = appearanceNow(),
      turning = 0
    const turned = () => {
      turning = 0
      size = ''
      sync()
    }
    const turn = () => {
      const next = appearanceNow()
      if (next === shownAppearance) return
      const from = shownAppearance
      shownAppearance = next
      cancelAnimationFrame(turning)
      if (reducedMotion() || !docked) return turned()
      const start = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, Math.max(0, (now - start) / 200))
        colour.set(docked, next, from, t * t * (3 - 2 * t))
        if (t < 1) turning = requestAnimationFrame(step)
        else turned()
      }
      colour.set(docked, next, from, 0)
      turning = requestAnimationFrame(step)
    }
    const turns = new MutationObserver(turn)
    turns.observe(element, { attributes: true, attributeFilter: ['data-appearance'] })
    const quiet = () => {
      element.style.removeProperty('--refract')
      element.style.removeProperty('--glass-blur')
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
          ? lens(first.width, first.height, first.radius, kind, shownAppearance)
          : lens(w, h, r, kind, shownAppearance)
        if (fresh !== current) {
          current = fresh
          assemble(fresh)
          bends.current!.span = fresh.span
        }
      }
      if (next !== size) layout(w, h)
      if (sized.has(kind))
        element.style.setProperty('--glass-blur', `${paneBlur(Math.min(w, h))}px`)
      size = next
      if (!turning) colour.set(docked, shownAppearance)
      // On an sRGB display the encodings are not in the chain at all.
      const tables = encodings(root.dataset.displayColorSpace)
      for (const [node, values] of [
        [intoSRGB, tables?.toSRGB],
        [outOfSRGB, tables?.fromSRGB],
      ] as const) {
        for (const func of node.children) {
          func.setAttribute('type', 'table')
          if (values) func.setAttribute('tableValues', values)
        }
        if (!values) node.remove()
      }
      if (tables) {
        whole.after(intoSRGB)
        filter.append(outOfSRGB)
      }
      colour.input(tables ? 'srgb' : 'bent')
      // Laid once its map has loaded (Lens.decoded); until then the glass keeps the colour alone.
      const laying = current!
      void laying.decoded.then(() => {
        if (current !== laying || attachment.current?.sync !== sync) return
        if (root.dataset.opaque === 'true' || (dynamic && !strength.current)) return
        element.style.setProperty('--refract', `url(#${id})`)
        element.dataset.refracting = 'true'
        // While it bends in, the rising spring alone sets its strength.
        if (!rising) bend(strength.current)
      })
    }
    // Transparency, the theme and the system's slider change the glass; a page writing the same
    // value again changes nothing.
    const appearanceOf = () =>
      `${root.dataset.opaque}/${theme()}/${root.dataset.material}/${root.dataset.glassTint}/${root.dataset.displayColorSpace}`
    let shownAs = appearanceOf()
    const resize = new ResizeObserver(sync),
      appearance = new MutationObserver(() => {
        if (appearanceOf() === shownAs) return
        shownAs = appearanceOf()
        shownAppearance = appearanceNow()
        size = ''
        sync()
      })
    // The border box: a drop entering adds padding around the same content, and its map must follow.
    resize.observe(element, { box: 'border-box' })
    appearance.observe(root, {
      attributes: true,
      attributeFilter: [
        'data-opaque',
        'data-theme',
        'data-material',
        'data-glass-tint',
        'data-display-color-space',
      ],
    })
    sync()
    const dispose = () => {
      cancelAnimationFrame(rising)
      cancelAnimationFrame(turning)
      turns.disconnect()
      unwatch?.()
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
