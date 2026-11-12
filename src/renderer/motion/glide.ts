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

/** Whether the list's current position is one the app placed or is gliding through. */
export const movedByApp = (list: HTMLElement) =>
  gliding(list) || placed.get(list) === list.scrollTop

const end = (list: HTMLElement) => list.scrollHeight - list.clientHeight

/**
 * Moves a scroll list to `top` on the same spring as the message bubbles, so the transcript and
 * a rising bubble travel together. `'end'` follows the end as the content keeps growing. A second
 * call only retargets, keeping the speed it has. Any wheel, touch, key or press on the list hands
 * it straight back to the person.
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
    if (glide.target === 'end') spring.aim(end(list), springs.bubble)
    spring.step((now - time) / 1000)
    time = now
    place(list, spring.value)
    if (spring.settled) glide.stop()
    else glide.frame = requestAnimationFrame(step)
  }
  glide.frame = requestAnimationFrame(step)
}

/** Stops a glide where it is, as when the list must jump to an exact place. */
export const stopGlide = (list: HTMLElement) => glides.get(list)?.stop()
