import { Spring, springs } from './spring'

interface Glide {
  spring: Spring
  target: number | 'end'
  frame: number
  stop(): void
}
const glides = new WeakMap<HTMLElement, Glide>(),
  placed = new WeakMap<HTMLElement, number>()

/** Whether `list` is being moved by a glide rather than by the person. */
export const gliding = (list: HTMLElement) => glides.has(list)

/** Puts `list` at `top` itself, so its scroll event is known not to be the person's. */
export function place(list: HTMLElement, top: number) {
  list.scrollTop = top
  placed.set(list, list.scrollTop)
}

/** Whether the list stands exactly where the app last put it, rather than where someone moved it. */
export const movedByApp = (list: HTMLElement) => placed.get(list) === list.scrollTop

const end = (list: HTMLElement) => list.scrollHeight - list.clientHeight

/**
 * Moves a scroll list to `top` on the same spring as the message bubbles, so the transcript and
 * a rising bubble travel together. `'end'` follows the end as the content keeps growing. A second
 * call only retargets, keeping the speed it has. Any wheel, touch, key or press on the list, or
 * any other scroll (a jump to a message, find in page), hands it straight back.
 */
export function glide(list: HTMLElement, top: number | 'end') {
  const running = glides.get(list)
  if (running) {
    running.target = top
    running.spring.aim(top === 'end' ? end(list) : top, springs.bubble)
    return
  }
  const spring = new Spring(list.scrollTop)
  spring.aim(top === 'end' ? end(list) : top, springs.bubble)
  const yieldToPerson = () => glide.stop()
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
  const glide: Glide = {
    spring,
    target: top,
    frame: 0,
    stop() {
      cancelAnimationFrame(glide.frame)
      for (const name of events) list.removeEventListener(name, yieldToPerson)
      glides.delete(list)
    },
  }
  for (const name of events) list.addEventListener(name, yieldToPerson, { passive: true })
  glides.set(list, glide)
  let time = performance.now()
  const step = (now: number) => {
    // Someone else scrolled since the last frame: they have the list now.
    if (placed.get(list) !== undefined && Math.abs(list.scrollTop - placed.get(list)!) > 1)
      return glide.stop()
    if (glide.target === 'end') spring.aim(end(list), springs.bubble)
    spring.step((now - time) / 1000)
    time = now
    // Settled to the pixel: a list end that wavers by a pixel must not keep the glide alive.
    const rest = Math.abs(spring.value - spring.target) < 0.5 && Math.abs(spring.velocity) < 20
    place(list, rest ? spring.target : spring.value)
    if (rest) glide.stop()
    else glide.frame = requestAnimationFrame(step)
  }
  glide.frame = requestAnimationFrame(step)
}

/** Stops a glide where it is, as when the list must jump to an exact place. */
export const stopGlide = (list: HTMLElement) => glides.get(list)?.stop()
