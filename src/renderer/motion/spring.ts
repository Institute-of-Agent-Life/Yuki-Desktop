/*
 * Springs as SwiftUI states them (`Spring(duration:bounce:)`): `duration` is the perceived time in
 * seconds and `bounce` how far it overshoots, 0 for none. SwiftUI's own: `.smooth` 0.5 / 0,
 * `.snappy` 0.5 / 0.15, `.bouncy` 0.5 / 0.3, `interactiveSpring` about 0.15. A desktop's controls
 * are denser than a phone's, so transitions are a little quicker than 0.5, and none bounces more
 * than `.snappy` except what a hand lets go of (hig-audit.md §8).
 */
export const springs = {
  pressDown: { duration: 0.17, bounce: 0 },
  pressUp: { duration: 0.3, bounce: 0.2 },
  select: { duration: 0.35, bounce: 0.15 },
  thumb: { duration: 0.3, bounce: 0.2 },
  highlight: { duration: 0.35, bounce: 0.15 },
  settle: { duration: 0.35, bounce: 0.15 },
  toggle: { duration: 0.3, bounce: 0.2 },
  bubble: { duration: 0.45, bounce: 0.15 },
  emerge: { duration: 0.35, bounce: 0.15 },
  withdraw: { duration: 0.28, bounce: 0 },
  busy: { duration: 0.3, bounce: 0.15 },
  // The glass slider, fitted to WWDC25 219's front-on release (slider-v2.md §3.3): let go, it
  // returns to its size and frosts over; the press is read off its toggle and is an estimate.
  sliderPress: { duration: 0.2, bounce: 0.2 },
  sliderRelease: { duration: 0.49, bounce: 0.31 },
  sliderFrost: { duration: 0.4, bounce: 0.19 },
  sliderStretch: { duration: 0.31, bounce: 0 },
} as const
export type SpringConfig = { duration: number; bounce: number }
/** Stiffness and damping ratio for unit mass: k = (2π / duration)², ζ = 1 − bounce. */
export const physics = ({ duration, bounce }: SpringConfig) => ({
  k: ((2 * Math.PI) / duration) ** 2,
  damping: 1 - bounce,
})

export class Spring {
  velocity = 0
  target: number
  config: SpringConfig = springs.select
  constructor(public value: number) {
    this.target = value
  }
  aim(value: number, config = this.config) {
    this.target = value
    this.config = config
  }
  snap(value = this.target) {
    this.value = this.target = value
    this.velocity = 0
  }
  get settled() {
    return Math.abs(this.value - this.target) < 0.0005 && Math.abs(this.velocity) < 0.01
  }
  step(seconds: number) {
    const dt = Math.min(1 / 30, Math.max(0, seconds)),
      steps = Math.max(1, Math.ceil(dt * 240)),
      h = dt / steps
    const { k, damping } = physics(this.config),
      drag = 2 * damping * Math.sqrt(k)
    for (let i = 0; i < steps; i++) {
      this.velocity += (-k * (this.value - this.target) - drag * this.velocity) * h
      this.value += this.velocity * h
    }
    if (this.settled) this.snap()
  }
}
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))
export const rubber = (distance: number, limit: number, span: number) =>
  limit * Math.tanh(distance / span)
// The spring's whole path from `from` to `to`, one sample per 60 Hz frame until it rests.
export function sampleSpring(config: SpringConfig, from = 0, to = 1) {
  const spring = new Spring(from)
  spring.aim(to, config)
  const samples = [{ value: from, velocity: 0 }]
  while (spring.value !== to || spring.velocity !== 0) {
    spring.step(1 / 60)
    samples.push({ value: spring.value, velocity: spring.velocity })
  }
  return samples
}
/** A CSS `linear()` easing that follows `config`'s spring, and how long it lasts: CSS transitions
 * move as the springs do (`--ease-pop`, `--motion-pop`). */
export function springEasing(config: SpringConfig) {
  const samples = sampleSpring(config)
  return {
    easing: `linear(${samples.map((sample) => +sample.value.toFixed(4)).join(', ')})`,
    duration: `${Math.round(((samples.length - 1) * 1000) / 60)}ms`,
  }
}
