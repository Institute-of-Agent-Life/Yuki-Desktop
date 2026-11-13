import { useLayoutEffect, useRef } from 'react'

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
// [bezel width, bend, magnification, dispersion]. Only panes floating over moving content
// disperse: over a flat or blurred backdrop the fringe has nothing to colour.
const presets = {
  toolbar: [10, 12, 0, 0.32],
  composer: [16, 18, 0, 0.32],
  card: [18, 14, 0, 0],
  sheet: [20, 16, 0, 0],
  slider: [7, 10, 0.32, 0],
  toggle: [5, 7, 0.2, 0],
  segment: [6, 8, 0.12, 0],
} as const
export type GlassKind = keyof typeof presets
const painted = new Map<string, { bend: HTMLCanvasElement; rim: string }>(),
  composed = new Map<string, Lens>()
// A glass's maps: the bend as a whole image for its filter, and the light as a slice to lay
// around its edge: `slice` image pixels top and bottom, then left and right, into a border of
// as many CSS pixels; 0 along a side the slice already spans whole.
interface Lens {
  displacement: string
  rim: string
  slice: [number, number]
  border: [number, number]
}
let sequence = 0

export function roundedDistance(x: number, y: number, hx: number, hy: number, radius: number) {
  const qx = Math.abs(x) - hx + radius,
    qy = Math.abs(y) - hy + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

// Paints the maps of a glass `width` by `height` whole, at the display's own pixels for its light.
function paintLens(width: number, height: number, radius: number, kind: GlassKind, scale: number) {
  const key = `${width}/${height}/${radius}/${kind}/${scale}`
  const cached = painted.get(key)
  if (cached) return cached
  const [edgeHeight, amount, zoom] = presets[kind]
  const hx = width / 2,
    hy = height / 2,
    normalRadius = Math.min(radius * 1.5, hx, hy)
  // The outward direction of the nearest edge: straight off a side, or off a corner's centre.
  const normal = (x: number, y: number) => {
    const qx = Math.abs(x) - hx + normalRadius,
      qy = Math.abs(y) - hy + normalRadius
    if (qx > 0 && qy > 0) {
      const length = Math.hypot(qx, qy)
      return [(Math.sign(x) * qx) / length, (Math.sign(y) * qy) / length] as const
    }
    return qx > qy ? ([Math.sign(x), 0] as const) : ([0, Math.sign(y)] as const)
  }
  // Paints a map at `resolution`, visiting only pixels from `outside` beyond the edge to `band`
  // inside it: rows clear of the corners only visit either side, so most of a large pane is
  // never computed and keeps the map's starting value.
  const paint = (
    resolution: number,
    band: number,
    outside: number,
    start: number,
    draw: (data: Uint8ClampedArray, k: number, x: number, y: number, distance: number) => void,
  ) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * resolution))
    canvas.height = Math.max(1, Math.round(height * resolution))
    const context = canvas.getContext('2d')!,
      image = context.createImageData(canvas.width, canvas.height)
    new Uint32Array(image.data.buffer).fill(start)
    const skipFrom = Math.floor(((width / 2 - hx + band) * canvas.width) / width),
      skipTo = Math.ceil(((width / 2 + hx - band) * canvas.width) / width) - 1
    for (let j = 0; j < canvas.height; j++) {
      const y = ((j + 0.5) * height) / canvas.height - hy,
        clear = !zoom && Math.abs(y) < hy - Math.max(band, radius)
      for (let i = 0; i < canvas.width; i++) {
        if (clear && i === skipFrom && skipTo > skipFrom) i = skipTo
        const x = ((i + 0.5) * width) / canvas.width - width / 2,
          distance = roundedDistance(x, y, hx, hy, radius)
        // Magnifying glass bends its whole interior, so only the outside is skipped there.
        if (distance > outside || (!zoom && -distance >= band)) continue
        draw(image.data, (j * canvas.width + i) * 4, x, y, distance)
      }
    }
    context.putImageData(image, 0, 0)
    return canvas
  }
  const displacement = paint(
    scale,
    edgeHeight,
    0,
    new Uint32Array(new Uint8ClampedArray([128, 128, 128, 255]).buffer)[0]!,
    (data, k, x, y, distance) => {
      const inset = -distance,
        [nx, ny] = normal(x, y)
      let dx = 0,
        dy = 0
      if (inset < edgeHeight) {
        const edge = 1 - inset / edgeHeight
        const arc = 1 - Math.sqrt(Math.max(0, 1 - edge ** 2))
        dx = -arc * nx
        dy = -arc * ny
      }
      if (zoom) {
        dx -= (zoom * x) / amount
        dy -= (zoom * y) / amount
      }
      data[k] = Math.round(128 + Math.max(-1, Math.min(1, dx)) * 127)
      data[k + 1] = Math.round(128 + Math.max(-1, Math.min(1, dy)) * 127)
    },
  )
  const rim = paint(scale, 10, 1 / scale, 0, (data, k, x, y, distance) => {
    const inset = -distance,
      [nx, ny] = normal(x, y)
    // As in thick glass: light from the upper left catches that edge, and the far edge glows
    // with what passes through and reflects back, about half as bright; the sides between, which
    // neither face nor back the light, stay dim.
    const toward = nx * -0.42 + ny * -0.91,
      facing = Math.max(0, toward) ** 1.5 + 0.55 * Math.max(0, -toward) ** 1.5
    // A specular line about a display point thick on the outer edge, then a short glow carried
    // inward. The outermost pixel is covered only partly, which smooths the curve.
    const bright = Math.max(0, Math.min(1, 1 - inset / 1.25)) ** 0.6,
      glow = Math.max(0, Math.min(1, 1 - inset / 6)) ** 2 * 0.22,
      coverage = Math.max(0, Math.min(1, 0.5 - distance * scale))
    data[k] = data[k + 1] = data[k + 2] = 255
    data[k + 3] = Math.round(Math.min(1, (bright + glow) * facing) * coverage * 255)
  })
  const result = { bend: displacement, rim: rim.toDataURL() }
  // Only slices and small glass are painted: a handful of sizes, kept.
  painted.set(key, result)
  return result
}

/*
 * A rounded rectangle's bend and light depend only on the edge's direction and the distance to
 * it, the same all along a straight edge. So a glass is painted once as a slice just larger than
 * its corners, its bezel and its light band, along each side it is longer than that, and any
 * length is made from the slice: the light is laid around the edge by the browser (a mask
 * border), and the bend is put together from the slice's corners, edges and middle. Glass that
 * magnifies its whole inside is painted whole.
 */
function lens(width: number, height: number, radius: number, kind: GlassKind): Lens {
  const scale = Math.min(3, Math.max(1, Math.ceil(devicePixelRatio)))
  const [edgeHeight, , zoom] = presets[kind]
  const border = Math.ceil(Math.max(radius * 1.5, edgeHeight, 10)) + 1,
    tile = 2 * border + 1
  const across = !zoom && width > tile,
    down = !zoom && height > tile
  // Up to the display's own pixels, so narrow glass bends crisply on Retina screens; large panes
  // keep a coarser bend, which only changes within the bezel and is smoothed between its points.
  const resolution = Math.min(scale, 360 / Math.max(width, height))
  const key = `${width}/${height}/${radius}/${kind}/${scale}`
  const cached = composed.get(key)
  if (cached) return cached
  const slice = paintLens(across ? tile : width, down ? tile : height, radius, kind, scale)
  let displacement: string
  if (!across && !down) displacement = slice.bend.toDataURL()
  else {
    const source = slice.bend,
      canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * resolution))
    canvas.height = Math.max(1, Math.round(height * resolution))
    const context = canvas.getContext('2d')!
    // Each side's pieces: [from, length] in the slice and [to, length] in the whole.
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
    displacement = canvas.toDataURL()
  }
  const result: Lens = {
    displacement,
    rim: slice.rim,
    slice: [down ? border * scale : 0, across ? border * scale : 0],
    border: [down ? border : 0, across ? border : 0],
  }
  // Resizing a window must not retain every historical size in memory.
  if (composed.size >= 16) composed.delete(composed.keys().next().value!)
  composed.set(key, result)
  return result
}

// One listener moves the light source for every lit rim: a fixed-position gradient centred on
// the pointer, masked by each pane's own light map. The position is written only on the panes
// that show it (registered, not inherited), so moving the pointer restyles those few elements
// rather than every node of a long conversation.
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

/** Samples only the backdrop; foreground text remains on the original surface. */
export function useGlass<T extends HTMLElement>(kind: GlassKind, dynamic = false, enabled = true) {
  const ref = useRef<T>(null),
    strength = useRef(dynamic ? 0 : 1)
  const displacement = useRef<SVGElement | null>(null),
    fringe = useRef<{ red: SVGElement; blue: SVGElement } | null>(null)
  const bend = (value: number) => {
    const [, amount, , spread] = presets[kind]
    displacement.current?.setAttribute('scale', String(2 * amount * value))
    fringe.current?.red.setAttribute('scale', String(2 * amount * (1 - spread) * value))
    fringe.current?.blue.setAttribute('scale', String(2 * amount * (1 + spread) * value))
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
    const unlit = followPointer(element)
    const svg = document.createElementNS(NS, 'svg'),
      defs = document.createElementNS(NS, 'defs')
    const filter = document.createElementNS(NS, 'filter'),
      image = document.createElementNS(NS, 'feImage')
    const warp = document.createElementNS(NS, 'feDisplacementMap'),
      id = `yuki-glass-${++sequence}`
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
    filter.id = id
    for (const [key, value] of Object.entries({
      x: '0',
      y: '0',
      filterUnits: 'userSpaceOnUse',
      primitiveUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB',
    }))
      filter.setAttribute(key, value)
    image.setAttribute('result', 'map')
    image.setAttribute('preserveAspectRatio', 'none')
    for (const [key, value] of Object.entries({
      in: 'SourceGraphic',
      in2: 'map',
      xChannelSelector: 'R',
      yChannelSelector: 'G',
    }))
      warp.setAttribute(key, value)
    filter.append(image, warp)
    // Dispersion as in real glass: blue bends most and red least, around the main bend that green
    // keeps. Each channel is taken from its own bend; the three share no channel, so screen
    // blending adds them exactly. Both bends cost one displacement each, only on floating panes.
    if (presets[kind][3]) {
      const element = (name: string, attributes: Record<string, string>) => {
        const node = document.createElementNS(NS, name)
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
        filter.append(node)
        return node
      }
      const bent = (result: string) =>
        element('feDisplacementMap', {
          in: 'SourceGraphic',
          in2: 'map',
          xChannelSelector: 'R',
          yChannelSelector: 'G',
          result,
        })
      warp.setAttribute('result', 'green-bend')
      fringe.current = { red: bent('red-bend'), blue: bent('blue-bend') }
      // Every channel keeps its alpha: filters premultiply, so a zero alpha would erase the colour.
      element('feColorMatrix', {
        in: 'red-bend',
        values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
        result: 'red',
      })
      element('feColorMatrix', {
        in: 'green-bend',
        values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
        result: 'green',
      })
      element('feColorMatrix', {
        in: 'blue-bend',
        values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
        result: 'blue',
      })
      // A third of each, added: over a half-clear backdrop the alpha stays the backdrop's own (a
      // screen blend would unite the three alphas and darken the colour), then the colour, read
      // unpremultiplied, is tripled back.
      element('feComposite', {
        in: 'red',
        in2: 'green',
        operator: 'arithmetic',
        k2: String(1 / 3),
        k3: String(1 / 3),
        result: 'red-green',
      })
      element('feComposite', {
        in: 'red-green',
        in2: 'blue',
        operator: 'arithmetic',
        k2: '1',
        k3: String(1 / 3),
        result: 'thirds',
      })
      const restore = element('feComponentTransfer', { in: 'thirds' })
      for (const channel of ['feFuncR', 'feFuncG', 'feFuncB']) {
        const tripled = document.createElementNS(NS, channel)
        tripled.setAttribute('type', 'linear')
        tripled.setAttribute('slope', '3')
        restore.append(tripled)
      }
    }
    defs.append(filter)
    svg.append(defs)
    document.body.append(svg)
    displacement.current = warp
    let size = ''
    const quiet = () => {
      element.style.removeProperty('--refract')
      element.style.removeProperty('--rim')
      element.style.removeProperty('--rim-slice')
      element.style.removeProperty('--rim-border')
      delete element.dataset.refracting
    }
    const sync = () => {
      // Without transparency nothing bends; a control at rest is quiet, as in Apple's glass.
      if (document.documentElement.dataset.opaque === 'true' || (dynamic && !strength.current))
        return quiet()
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
      if (dynamic && size) {
        // A held control stretches as it is pressed and dragged: the maps it was first given
        // stretch with it, and none are made while it moves.
        for (const node of [filter, image]) {
          node.setAttribute('width', String(w))
          node.setAttribute('height', String(h))
        }
      } else if (next !== size) {
        const map = lens(w, h, r, kind)
        filter.setAttribute('width', String(w))
        filter.setAttribute('height', String(h))
        image.setAttribute('width', String(w))
        image.setAttribute('height', String(h))
        image.setAttribute('href', map.displacement)
        element.style.setProperty('--rim', `url("${map.rim}")`)
        element.style.setProperty('--rim-slice', map.slice.join(' '))
        element.style.setProperty('--rim-border', map.border.map((value) => `${value}px`).join(' '))
        size = next
      }
      element.style.setProperty('--refract', `url(#${id})`)
      element.dataset.refracting = 'true'
      bend(strength.current)
    }
    const resize = new ResizeObserver(sync),
      appearance = new MutationObserver(() => {
        size = ''
        sync()
      })
    // The border box: a drop entering adds padding around the same content, and its map must follow.
    resize.observe(element, { box: 'border-box' })
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-opaque'],
    })
    sync()
    const dispose = () => {
      unlit()
      resize.disconnect()
      appearance.disconnect()
      svg.remove()
      displacement.current = null
      fringe.current = null
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
