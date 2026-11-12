import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const NS = 'http://www.w3.org/2000/svg'
// [bezel width, bend, magnification, red bend relative to the rest]. Only panes floating over
// moving content disperse: over a flat or blurred backdrop the fringe has nothing to colour.
const presets = {
  toolbar: [10, 12, 0, 1.22],
  composer: [16, 18, 0, 1.22],
  // Gentle: a stronger bend curls the backdrop's thin lines into hooks at the corners.
  bubble: [12, 8, 0, 0],
  card: [18, 14, 0, 0],
  sheet: [20, 16, 0, 0],
  slider: [7, 10, 0.32, 0],
  toggle: [5, 7, 0.2, 0],
  segment: [6, 8, 0.12, 0],
} as const
export type GlassKind = keyof typeof presets
const maps = new Map<string, { displacement: string; rim: string }>()
let sequence = 0

export function roundedDistance(x: number, y: number, hx: number, hy: number, radius: number) {
  const qx = Math.abs(x) - hx + radius,
    qy = Math.abs(y) - hy + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

function lens(
  width: number,
  height: number,
  radius: number,
  kind: GlassKind,
  inline: number,
  bottom: number,
) {
  const key = `${width}/${height}/${radius}/${kind}/${inline}/${bottom}`
  const cached = maps.get(key)
  if (cached) return cached
  const [edgeHeight, amount, zoom] = presets[kind]
  const canvas = document.createElement('canvas'),
    rim = document.createElement('canvas')
  // Large panes only need their bezel resolved; a coarser map keeps opening a sheet smooth.
  const resolution =
    kind === 'bubble'
      ? Math.min(1, 360 / Math.max(width, height))
      : Math.min(2, 720 / Math.max(width, height))
  canvas.width = rim.width = Math.max(1, Math.round(width * resolution))
  canvas.height = rim.height = Math.max(1, Math.round(height * resolution))
  const context = canvas.getContext('2d')!,
    lightContext = rim.getContext('2d')!
  const pixels = context.createImageData(canvas.width, canvas.height)
  const lights = lightContext.createImageData(canvas.width, canvas.height)
  const hx = width / 2 - inline,
    hy = (height - bottom) / 2,
    normalRadius = Math.min(radius * (kind === 'bubble' ? 1 : 1.5), hx, hy)
  for (let j = 0; j < canvas.height; j++)
    for (let i = 0; i < canvas.width; i++) {
      const x = ((i + 0.5) * width) / canvas.width - width / 2,
        y = ((j + 0.5) * height) / canvas.height - hy,
        k = (j * canvas.width + i) * 4
      const distance = roundedDistance(x, y, hx, hy, radius),
        inset = -distance
      let nx =
        roundedDistance(x + 0.5, y, hx, hy, normalRadius) -
        roundedDistance(x - 0.5, y, hx, hy, normalRadius)
      let ny =
        roundedDistance(x, y + 0.5, hx, hy, normalRadius) -
        roundedDistance(x, y - 0.5, hx, hy, normalRadius)
      const length = Math.hypot(nx, ny) || 1
      nx /= length
      ny /= length
      let dx = 0,
        dy = 0
      if (distance <= 0 && inset < edgeHeight) {
        const edge = 1 - inset / edgeHeight
        const arc = kind === 'bubble' ? edge ** 2.4 : 1 - Math.sqrt(Math.max(0, 1 - edge ** 2))
        dx = -arc * nx
        dy = -arc * ny
      }
      if (distance <= 0 && zoom) {
        dx -= (zoom * x) / amount
        dy -= (zoom * y) / amount
      }
      pixels.data[k] = Math.round(128 + Math.max(-1, Math.min(1, dx)) * 127)
      pixels.data[k + 1] = Math.round(128 + Math.max(-1, Math.min(1, dy)) * 127)
      pixels.data[k + 2] = 128
      pixels.data[k + 3] = 255
      if (distance <= 0) {
        // Light from the upper left catches that edge; the far edge shows only its
        // weaker bounce, and the sides between stay nearly clear.
        const toward = nx * -0.42 + ny * -0.91,
          facing = Math.max(0, toward) + 0.38 * Math.max(0, -toward)
        // A thin specular line on the outer edge, then light carried inward through the
        // bezel, so the pane reads as thick glass rather than an outline.
        const bright = Math.max(0, 1 - inset / 1.5),
          glow = Math.max(0, 1 - inset / 10) ** 2 * 0.34
        lights.data[k] = lights.data[k + 1] = lights.data[k + 2] = 255
        lights.data[k + 3] = Math.round(
          Math.min(1, bright * (0.1 + 0.9 * facing) + glow * facing) * 255,
        )
      }
    }
  context.putImageData(pixels, 0, 0)
  lightContext.putImageData(lights, 0, 0)
  const result = { displacement: canvas.toDataURL(), rim: rim.toDataURL() }
  // Resizing a window must not retain every historical size in memory.
  if (maps.size >= 16) maps.delete(maps.keys().next().value!)
  maps.set(key, result)
  return result
}

// One listener moves the light source for every pane: rims are lit by a fixed-position
// gradient centred on the pointer, masked by each pane's own light map.
let pointerLight = false
export function followPointer() {
  if (pointerLight) return
  pointerLight = true
  const root = document.documentElement
  let frame = 0,
    x = 0,
    y = 0
  addEventListener(
    'pointermove',
    (event) => {
      x = event.clientX
      y = event.clientY
      frame ||= requestAnimationFrame(() => {
        frame = 0
        root.style.setProperty('--pointer-x', `${x}px`)
        root.style.setProperty('--pointer-y', `${y}px`)
      })
    },
    { passive: true },
  )
  root.addEventListener('pointerleave', () => {
    root.style.removeProperty('--pointer-x')
    root.style.removeProperty('--pointer-y')
  })
}

/** Samples only the backdrop; foreground text remains on the original surface. */
export function useGlass<T extends HTMLElement>(kind: GlassKind, dynamic = false, enabled = true) {
  const ref = useRef<T>(null),
    strength = useRef(dynamic ? 0 : 1)
  const displacement = useRef<SVGElement | null>(null),
    fringe = useRef<SVGElement | null>(null)
  const bend = (value: number) => {
    const [, amount, , red] = presets[kind]
    displacement.current?.setAttribute('scale', String(2 * amount * value))
    fringe.current?.setAttribute('scale', String(2 * amount * red * value))
  }
  const setStrength = (value: number) => {
    strength.current = Math.max(0, value)
    bend(strength.current)
    ref.current?.style.setProperty('--glass-pressure', String(Math.min(1, strength.current)))
  }
  const attachment = useRef<{ element: T; kind: GlassKind; dispose(): void } | undefined>(undefined)
  useLayoutEffect(() => {
    const element = enabled ? ref.current : null
    if (attachment.current?.element === element && attachment.current?.kind === kind) return
    attachment.current?.dispose()
    attachment.current = undefined
    if (!element || !CSS.supports('backdrop-filter', 'url(#glass)')) return
    followPointer()
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
    // Dispersion with one extra bend: red is bent a little further than green and blue, which
    // share the main bend, so edges crossing the rim split into red and cyan.
    if (presets[kind][3]) {
      const red = document.createElementNS(NS, 'feDisplacementMap'),
        reds = document.createElementNS(NS, 'feColorMatrix'),
        rest = document.createElementNS(NS, 'feColorMatrix'),
        merge = document.createElementNS(NS, 'feBlend')
      warp.setAttribute('result', 'bent')
      for (const [key, value] of Object.entries({
        in: 'SourceGraphic',
        in2: 'map',
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: 'redder',
      }))
        red.setAttribute(key, value)
      reds.setAttribute('in', 'redder')
      // Both halves keep their alpha: filters premultiply, so a zero alpha would erase the colour.
      reds.setAttribute('values', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0')
      reds.setAttribute('result', 'red')
      rest.setAttribute('in', 'bent')
      rest.setAttribute('values', '0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0')
      rest.setAttribute('result', 'rest')
      // The halves share no colour channel, so screen adds them exactly and keeps one alpha.
      for (const [key, value] of Object.entries({ in: 'red', in2: 'rest', mode: 'screen' }))
        merge.setAttribute(key, value)
      filter.append(red, reds, rest, merge)
      fringe.current = red
    }
    defs.append(filter)
    svg.append(defs)
    document.body.append(svg)
    displacement.current = warp
    let size = ''
    const sync = () => {
      if (document.documentElement.dataset.opaque === 'true') {
        element.style.removeProperty('--refract')
        element.style.removeProperty('--rim')
        delete element.dataset.refracting
        return
      }
      const w = element.offsetWidth,
        h = element.offsetHeight
      if (!w || !h) return
      const style = getComputedStyle(element)
      const inline = kind === 'bubble' ? parseFloat(style.paddingInlineStart) : 0
      const bottom = kind === 'bubble' ? parseFloat(style.paddingBottom) : 0
      const r = Math.min(
        parseFloat(style.borderTopLeftRadius) || 0,
        w / 2 - inline,
        (h - bottom) / 2,
      )
      const next = `${w}/${h}/${r}/${inline}/${bottom}`
      if (next !== size) {
        const map = lens(w, h, r, kind, inline, bottom)
        filter.setAttribute('width', String(w))
        filter.setAttribute('height', String(h))
        image.setAttribute('width', String(w))
        image.setAttribute('height', String(h))
        image.setAttribute('href', map.displacement)
        element.style.setProperty('--rim', `url("${map.rim}")`)
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
    resize.observe(element)
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-opaque'],
    })
    sync()
    const dispose = () => {
      resize.disconnect()
      appearance.disconnect()
      svg.remove()
      displacement.current = null
      fringe.current = null
      element.style.removeProperty('--refract')
      element.style.removeProperty('--rim')
      delete element.dataset.refracting
    }
    attachment.current = { element, kind, dispose }
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

const bubbleVisibility = new WeakMap<Element, (visible: boolean) => void>()
let bubbleObserver: IntersectionObserver | undefined

export function useConversationGlass() {
  const [visible, setVisible] = useState(false)
  const { ref } = useGlass<HTMLSpanElement>('bubble', false, visible)
  return useCallback(
    (element: HTMLSpanElement | null) => {
      ref.current = element
      if (!element) return
      const observer = (bubbleObserver ??= new IntersectionObserver((entries) => {
        for (const entry of entries) bubbleVisibility.get(entry.target)?.(entry.isIntersecting)
      }))
      bubbleVisibility.set(element, setVisible)
      observer.observe(element)
      return () => {
        observer.unobserve(element)
        bubbleVisibility.delete(element)
        ref.current = null
      }
    },
    [ref],
  )
}
