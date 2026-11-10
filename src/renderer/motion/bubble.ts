const svgNamespace = 'http://www.w3.org/2000/svg'
const quarter = (4 / 3) * Math.tan(Math.PI / 8)

const liquidBubbleDuration = 520

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

const phases = [
  { offset: 0, width: 0.18, height: 0.43, tail: 0.05, sink: 10, glass: 0.34, ink: 0 },
  { offset: 0.24, width: 0.3, height: 0.58, tail: 1, sink: 4, glass: 1, ink: 0 },
  { offset: 0.54, width: 0.79, height: 0.89, tail: 0.72, sink: 0, glass: 1, ink: 1 },
  { offset: 0.74, width: 1, height: 1, tail: 0.36, sink: 0, glass: 1, ink: 1 },
  { offset: 0.91, width: 1, height: 1, tail: 0.05, sink: 0, glass: 1, ink: 1 },
  { offset: 1, width: 1, height: 1, tail: 0, sink: 0, glass: 1, ink: 1 },
]

export function animateBubble(row: Element, outgoing: boolean) {
  const surface = row.querySelector<HTMLElement>('[data-glass="bubble"]')
  const copy = row.querySelector<HTMLElement>('[data-bubble-copy]')
  if (!surface || !copy) return

  const box = surface.getBoundingClientRect()
  const copyBox = copy.getBoundingClientRect()
  const style = getComputedStyle(surface)
  const inline = parseFloat(style.paddingInlineStart)
  const bottom = parseFloat(style.paddingBottom)
  const width = box.width - 2 * inline
  const height = box.height - bottom
  const radius = parseFloat(style.borderTopLeftRadius)

  // The backdrop and the text mask share the contour in their own coordinates.
  const frames = phases.map((phase) => {
    const w = Math.min(width, Math.max(28, width * phase.width))
    const h = Math.min(height, Math.max(19, height * phase.height))
    const args = [inline, height - h + phase.sink, w, h, radius, phase.tail * (bottom - 6)] as const
    const px = (x: number) => (outgoing ? box.width - x : x)
    const path = (dx: number, dy: number) =>
      liquidPath(...args, (x, y) => `${(px(x) - dx).toFixed(2)} ${(y - dy).toFixed(2)}`)
    return {
      ...phase,
      contour: `path("${path(0, 0)}")`,
      inkMask: `path("${path(copyBox.left - box.left, copyBox.top - box.top)}")`,
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
  surface.dataset.liquid = ''

  const timing: KeyframeAnimationOptions = {
    duration: liquidBubbleDuration,
    easing: 'linear',
    fill: 'backwards',
  }
  const easing = 'cubic-bezier(.25, .12, .36, 1)'
  const glass = surface.animate(
    frames.map(({ offset, contour, glass }) => ({
      offset,
      easing,
      clipPath: contour,
      opacity: glass,
    })),
    timing,
  )
  const stroke = edge.animate(
    frames.map(({ offset, contour, glass }) => ({ offset, easing, d: contour, opacity: glass })),
    timing,
  )
  const text = copy.animate(
    frames.map(({ offset, inkMask, ink }) => ({ offset, easing, clipPath: inkMask, opacity: ink })),
    timing,
  )
  const finish = () => {
    stroke.cancel()
    text.cancel()
    delete surface.dataset.liquid
    outline.remove()
  }
  void glass.finished.then(finish, finish)
}
