import { sampleSpring, springs } from './spring'
import './bubble.css'

const svgNamespace = 'http://www.w3.org/2000/svg'
const quarter = (4 / 3) * Math.tan(Math.PI / 8)

// Pull the middle of one rounded corner outward with a smooth displacement.
// The displacement has zero slope where the corner joins the straight edges.
function liquidPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  reach: number,
  point: (x: number, y: number) => string,
) {
  const right = x + width
  const bottom = y + height
  const r = Math.min(radius, width / 2, height / 2)
  const handle = quarter * r
  const segments = 8
  const arc = Math.PI / 2
  const pull = 0.88 * reach
  const tension = Math.min(0.68, (0.48 * reach) / r)
  const corner = Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments
    const sin = Math.sin(arc * t)
    const cos = Math.cos(arc * t)
    const wave = Math.sin(Math.PI * t)
    const shift = pull * wave ** 3
    const slope = 3 * Math.PI * pull * wave ** 2 * Math.cos(Math.PI * t)
    // Narrow both sides of the stretch while the tip keeps its own roundness.
    const neckWave = Math.sin(2 * Math.PI * t)
    const pinch = tension * neckWave ** 2
    const cross = (r * (cos - sin)) / 2
    const sideways = pinch * cross
    const sidewaysSlope =
      4 * Math.PI * tension * neckWave * Math.cos(2 * Math.PI * t) * cross -
      (pinch * r * arc * (sin + cos)) / 2
    return {
      x: x + r - r * sin - shift - sideways,
      y: bottom - r + r * cos + shift - sideways,
      dx: -r * arc * cos - slope - sidewaysSlope,
      dy: -r * arc * sin + slope - sidewaysSlope,
    }
  })
  const tangent = 1 / (3 * segments)
  const tail = corner.slice(1).map((next, index) => {
    const from = corner[index]!
    const startHandle = point(from.x + from.dx * tangent, from.y + from.dy * tangent)
    const endHandle = point(next.x - next.dx * tangent, next.y - next.dy * tangent)
    return `C ${startHandle} ${endHandle} ${point(next.x, next.y)}`
  })

  return [
    `M ${point(x + r, y)} L ${point(right - r, y)}`,
    `C ${point(right - r + handle, y)} ${point(right, y + r - handle)} ${point(right, y + r)}`,
    `L ${point(right, bottom - r)}`,
    `C ${point(right, bottom - r + handle)} ${point(right - r + handle, bottom)} ${point(right - r, bottom)}`,
    `L ${point(x + r, bottom)}`,
    ...tail,
    `L ${point(x, y + r)}`,
    `C ${point(x, y + r - handle)} ${point(x + r - handle, y)} ${point(x + r, y)} Z`,
  ].join(' ')
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

// Own messages rise from the composer text at `origin`; Yuki's replies grow in place.
// A sticker has no glass to grow: it swells in from its corner on the same spring.
function animateSticker(sticker: HTMLElement, outgoing: boolean) {
  const samples = sampleSpring(springs.bubble),
    last = samples.length - 1
  sticker.animate(
    samples.map(({ value }, index) => ({
      offset: index / last,
      transformOrigin: outgoing ? '100% 100%' : '0 100%',
      transform: `scale(${0.4 + 0.6 * value})`,
      opacity: Math.min(1, 0.2 + 1.6 * value),
    })),
    { duration: (last * 1000) / 60, easing: 'linear' },
  )
}

export function animateBubble(row: Element, outgoing: boolean, origin?: DOMRect) {
  const sticker = row.querySelector<HTMLElement>('[data-sticker]')
  if (sticker) return animateSticker(sticker, outgoing)
  const surface = row.querySelector<HTMLElement>('[data-glass="bubble"]')
  const copy = row.querySelector<HTMLElement>('[data-bubble-copy]')
  const bubble = surface?.parentElement
  if (!surface || !copy || !bubble) return
  // The drop reaches past its bubble only while it enters; measure it so.
  surface.dataset.liquid = ''

  const box = surface.getBoundingClientRect()
  const copyBox = copy.getBoundingClientRect()
  const style = getComputedStyle(surface)
  const inline = parseFloat(style.paddingInlineStart)
  const bottom = parseFloat(style.paddingBottom)
  const width = box.width - 2 * inline
  const height = box.height - bottom
  const radius = parseFloat(style.borderTopLeftRadius)
  const startWidth = Math.min(width, Math.max(36, width * 0.2))
  const startHeight = Math.min(height, Math.max(22, height * 0.4))

  // The drop rises no further than the list's own bottom space, so scrolling never changes.
  const log = row.closest('[role="log"]')
  const room = log
    ? log.getBoundingClientRect().top - log.scrollTop + log.scrollHeight - box.bottom
    : 0
  // While the list is still gliding to its end the bubble may sit below the composer, so the
  // rise can be upward or downward.
  const rise = Math.min(
    room,
    origin ? origin.top + origin.height / 2 - (box.top + height - startHeight / 2) : 10,
  )

  // The text scales from the drop's growing corner to whatever the glass can hold.
  const side = outgoing ? box.right - inline - copyBox.right : copyBox.left - box.left - inline
  const under = box.top + height - copyBox.bottom
  const fit = (w: number, h: number) =>
    clamp(Math.min((w - side) / copyBox.width, (h - under) / copyBox.height))

  // One spring carries the whole entry, sampled per frame so every property keeps
  // its velocity: no keyframe stops the drop halfway.
  const samples = sampleSpring(springs.bubble)
  const fastest = Math.max(...samples.map((sample) => sample.velocity))
  const last = samples.length - 1
  const frames = samples.map(({ value, velocity }, index) => {
    const grow = Math.min(1, value)
    const w = startWidth + (width - startWidth) * grow
    const h = startHeight + (height - startHeight) * grow
    // The tail is the drop's stretch: longest at full speed, gone once it rests.
    const reach = (Math.max(0, velocity) / fastest) * (bottom - 6)
    const px = (x: number) => (outgoing ? box.width - x : x)
    const path = liquidPath(
      inline,
      height - h,
      w,
      h,
      radius,
      reach,
      (x, y) => `${px(x).toFixed(2)} ${y.toFixed(2)}`,
    )
    const settle = clamp((index / last - 0.5) / 0.5)
    return {
      offset: index / last,
      contour: `path("${path}")`,
      glass: Math.min(1, 0.55 + 1.5 * value),
      lift: `translateY(${((1 - value) * rise).toFixed(2)}px)`,
      scale: `scale(${fit(w, h).toFixed(4)})`,
      ink: clamp((value - 0.55) / 0.35),
      settle,
    }
  })

  const outline = document.createElementNS(svgNamespace, 'svg')
  const edge = document.createElementNS(svgNamespace, 'path')
  outline.dataset.liquidOutline = ''
  outline.setAttribute('aria-hidden', 'true')
  outline.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`)
  edge.setAttribute('fill', 'none')
  edge.setAttribute('stroke', 'currentColor')
  edge.setAttribute('stroke-width', '1.1')
  outline.append(edge)
  surface.after(outline)

  const timing: KeyframeAnimationOptions = {
    duration: (last * 1000) / 60,
    easing: 'linear',
    fill: 'backwards',
  }
  const glass = surface.animate(
    frames.map(({ offset, contour, glass }) => ({ offset, clipPath: contour, opacity: glass })),
    timing,
  )
  const others = [
    bubble.animate(
      [
        ...frames.map(({ offset, lift }) => ({ offset, transform: lift })),
        // The resting shadow belongs to the resting shape.
        { offset: 0, boxShadow: 'none' },
        { offset: 0.5, boxShadow: 'none' },
      ].sort((a, b) => a.offset - b.offset),
      timing,
    ),
    edge.animate(
      frames.map(({ offset, contour, glass, settle }) => ({
        offset,
        d: contour,
        opacity: glass * (1 - settle),
      })),
      timing,
    ),
    copy.animate(
      frames.map(({ offset, scale, ink }) => ({
        offset,
        transform: scale,
        transformOrigin: outgoing ? '100% 100%' : '0 100%',
        opacity: ink,
      })),
      timing,
    ),
    // The resting rim returns while the drawn edge fades, so the end has no switch.
    ...(['::before', '::after'] as const).map((pseudoElement) =>
      surface.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }], {
        ...timing,
        pseudoElement,
      }),
    ),
  ]
  const finish = () => {
    for (const animation of others) animation.cancel()
    delete surface.dataset.liquid
    outline.remove()
  }
  void glass.finished.then(finish, finish)
}

// The sent words leave the composer upward while their bubble rises from it.
export function releaseDraft(field: HTMLTextAreaElement) {
  const box = field.getBoundingClientRect()
  const style = getComputedStyle(field)
  const words = document.createElement('div')
  words.dataset.draftRelease = field.value
  words.setAttribute('aria-hidden', 'true')
  Object.assign(words.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    padding: style.padding,
    font: style.font,
    letterSpacing: style.letterSpacing,
    color: style.color,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '7',
  })
  document.body.append(words)
  words.scrollTop = field.scrollTop
  const leave = words.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-10px)' }], {
    duration: 180,
    easing: 'cubic-bezier(.3, 0, .2, 1)',
  })
  // The placeholder returns only as the words clear, so the two never overlap.
  field.animate([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], { duration: 260 })
  const remove = () => words.remove()
  void leave.finished.then(remove, remove)
}
