import { reducedMotion } from './hooks'
import { sampleSpring, springs } from './spring'

interface Shape {
  left: number
  top: number
  width: number
  height: number
  radius: number
}

// The button a person last pressed or activated by key, so a pane it opens can grow out of it.
let pressed: { element: Element; at: number } | undefined
const press = (event: Event) => {
  if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return
  const button = (event.target as Element | null)?.closest?.('button,[role="button"]')
  if (button) pressed = { element: button, at: performance.now() }
}
addEventListener('pointerdown', press, true)
addEventListener('keydown', press, true)
const origins = new WeakMap<Element, Element>()
let withdrawals = 0

const shapeOf = (element: Element): Shape => {
  const box = element.getBoundingClientRect()
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    // A pill's large radius means half its height.
    radius: Math.min(
      parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
      box.width / 2,
      box.height / 2,
    ),
  }
}
// Without a button to grow from, a pane swells slightly from its own centre.
const near = (shape: Shape): Shape => ({
  ...shape,
  left: shape.left + shape.width * 0.03,
  top: shape.top + shape.height * 0.03,
  width: shape.width * 0.94,
  height: shape.height * 0.94,
})
const clamp = (value: number) => Math.min(1, Math.max(0, value))

// Moves `element`, laid out at `layout`, along the spring from `start` to `end`. The radius is
// divided by each axis' scale, so every frame is an ordinary rounded rectangle, never squashed.
function morph(
  element: HTMLElement,
  layout: Shape,
  start: Shape,
  end: Shape,
  samples: { value: number }[],
  glass: (value: number) => number,
) {
  const last = samples.length - 1
  return element.animate(
    samples.map(({ value }, index) => {
      const width = start.width + (end.width - start.width) * value,
        height = start.height + (end.height - start.height) * value,
        radius = Math.min(
          start.radius + (end.radius - start.radius) * clamp(value),
          width / 2,
          height / 2,
        ),
        sx = width / layout.width,
        sy = height / layout.height
      return {
        offset: index / last,
        transformOrigin: '0 0',
        transform: `translate(${start.left + (end.left - start.left) * value - layout.left}px, ${start.top + (end.top - start.top) * value - layout.top}px) scale(${sx}, ${sy})`,
        borderRadius: `${radius / sx}px / ${radius / sy}px`,
        opacity: glass(value),
      }
    }),
    { duration: (last * 1000) / 60, easing: 'linear' },
  )
}

/** Grows an opened pane out of the button that opened it; its content arrives last. */
export function emerge(pane: HTMLElement) {
  if (reducedMotion()) return
  const end = shapeOf(pane)
  if (!end.width || !end.height) return
  const origin =
    pressed &&
    performance.now() - pressed.at < 800 &&
    pressed.element.isConnected &&
    !pane.contains(pressed.element)
      ? pressed.element
      : undefined
  if (origin) origins.set(pane, origin)
  const samples = sampleSpring(springs.emerge)
  morph(pane, end, origin ? shapeOf(origin) : near(end), end, samples, (value) =>
    Math.min(1, 0.4 + 2 * value),
  )
  const last = samples.length - 1
  for (const child of pane.children)
    child.animate(
      samples.map(({ value }, index) => ({
        offset: index / last,
        opacity: clamp((value - 0.55) / 0.35),
      })),
      { duration: (last * 1000) / 60, easing: 'linear' },
    )
}

/**
 * Shrinks a closing pane back into the button it came from. The pane itself closes at once,
 * so focus and the next action never wait; an empty, inert piece of the same glass shrinks.
 */
export function withdraw(pane: HTMLElement) {
  if (reducedMotion() || !pane.isConnected) return
  const start = shapeOf(pane)
  if (!start.width || !start.height) return
  const origin = origins.get(pane)
  // Only the look is copied: no role, name or content that could be found or read twice.
  const glass = document.createElement('div')
  glass.className = pane.className
  glass.style.cssText = pane.style.cssText
  for (const name of ['glass', 'refracting'])
    if (pane.dataset[name] !== undefined) glass.dataset[name] = pane.dataset[name]
  // It bends through its own copy of the pane's filter, which leaves with the pane.
  const bend = pane.style.getPropertyValue('--refract').match(/#([^")]+)/)?.[1]
  const filter = bend && document.getElementById(bend)
  if (filter) {
    const copy = filter.closest('svg')!.cloneNode(true) as SVGSVGElement
    copy.querySelector('filter')!.id = `${bend}-withdraw-${++withdrawals}`
    glass.append(copy)
    glass.style.setProperty('--refract', `url(#${bend}-withdraw-${withdrawals})`)
  }
  glass.inert = true
  glass.setAttribute('aria-hidden', 'true')
  glass.dataset.withdrawing = ''
  Object.assign(glass.style, {
    position: 'fixed',
    inset: 'auto',
    left: `${start.left}px`,
    top: `${start.top}px`,
    width: `${start.width}px`,
    height: `${start.height}px`,
    maxWidth: 'none',
    maxHeight: 'none',
    margin: '0',
    display: 'block',
    pointerEvents: 'none',
    zIndex: '2147483000',
  })
  document.body.append(glass)
  const shrink = morph(
    glass,
    start,
    start,
    origin?.isConnected ? shapeOf(origin) : near(start),
    sampleSpring(springs.withdraw),
    (value) => Math.min(1, 2.4 * (1 - value)),
  )
  const remove = () => glass.remove()
  void shrink.finished.then(remove, remove)
}
