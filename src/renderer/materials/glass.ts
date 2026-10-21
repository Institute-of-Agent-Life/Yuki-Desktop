import { useLayoutEffect, useRef } from 'react'

const NS = 'http://www.w3.org/2000/svg'
const presets = {
  toolbar: [10, 12, 0],
  composer: [16, 18, 0],
  toast: [10, 12, 0],
  slider: [7, 10, 0.32],
  toggle: [5, 7, 0.2],
  segment: [6, 8, 0.12],
} as const
export type GlassKind = keyof typeof presets
const maps = new Map<string, { displacement: string; rim: string }>()
let sequence = 0

export function roundedDistance(x: number, y: number, hx: number, hy: number, radius: number) {
  const qx = Math.abs(x) - hx + radius,
    qy = Math.abs(y) - hy + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

function lens(width: number, height: number, radius: number, kind: GlassKind) {
  const key = `${width}/${height}/${radius}/${kind}`
  const cached = maps.get(key)
  if (cached) return cached
  const [edgeHeight, amount, zoom] = presets[kind]
  const canvas = document.createElement('canvas'),
    rim = document.createElement('canvas')
  canvas.width = rim.width = width * 2
  canvas.height = rim.height = height * 2
  const context = canvas.getContext('2d')!,
    lightContext = rim.getContext('2d')!
  const pixels = context.createImageData(canvas.width, canvas.height)
  const lights = lightContext.createImageData(canvas.width, canvas.height)
  const hx = width / 2,
    hy = height / 2,
    normalRadius = Math.min(radius * 1.5, hx, hy)
  for (let j = 0; j < canvas.height; j++)
    for (let i = 0; i < canvas.width; i++) {
      const x = (i + 0.5) / 2 - hx,
        y = (j + 0.5) / 2 - hy,
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
        const arc = 1 - Math.sqrt(Math.max(0, 1 - (1 - inset / edgeHeight) ** 2))
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
        const facing = Math.abs(nx * -0.42 + ny * -0.91)
        const bright = Math.max(0, 1 - inset / 1.5),
          glow = Math.max(0, 1 - inset / 4) * 0.22
        lights.data[k] = lights.data[k + 1] = lights.data[k + 2] = 255
        lights.data[k + 3] = Math.round(
          Math.min(1, bright * (0.28 + 0.72 * facing) + glow * facing) * 255,
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

/** Samples only the backdrop; foreground text remains on the original surface. */
export function useGlass<T extends HTMLElement>(kind: GlassKind, dynamic = false) {
  const ref = useRef<T>(null),
    strength = useRef(dynamic ? 0 : 1)
  const displacement = useRef<SVGElement | null>(null)
  const setStrength = (value: number) => {
    strength.current = Math.max(0, value)
    displacement.current?.setAttribute('scale', String(2 * presets[kind][1] * strength.current))
    ref.current?.style.setProperty('--glass-pressure', String(Math.min(1, strength.current)))
  }
  const attachment = useRef<{ element: T; kind: GlassKind; dispose(): void } | undefined>(undefined)
  useLayoutEffect(() => {
    const element = ref.current
    if (attachment.current?.element === element && attachment.current?.kind === kind) return
    attachment.current?.dispose()
    attachment.current = undefined
    if (!element || !CSS.supports('backdrop-filter', 'url(#glass)')) return
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
      const r = Math.min(
        parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
        w / 2,
        h / 2,
      )
      const next = `${w}/${h}/${r}`
      if (next !== size) {
        const map = lens(w, h, r, kind)
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
      warp.setAttribute('scale', String(2 * presets[kind][1] * strength.current))
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
