export const springs = {
  pressDown: { k: 1400, damping: 1 },
  pressUp: { k: 520, damping: 0.62 },
  select: { k: 480, damping: 0.8 },
  thumb: { k: 620, damping: 0.66 },
  highlight: { k: 300, damping: 0.6 },
  settle: { k: 380, damping: 0.74 },
  toggle: { k: 520, damping: 0.7 },
  bubble: { k: 190, damping: 0.72 },
  emerge: { k: 300, damping: 0.76 },
  withdraw: { k: 520, damping: 1 },
  busy: { k: 420, damping: 0.62 },
} as const
export type SpringConfig = { k: number; damping: number }

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
    const drag = 2 * this.config.damping * Math.sqrt(this.config.k)
    for (let i = 0; i < steps; i++) {
      this.velocity += (-this.config.k * (this.value - this.target) - drag * this.velocity) * h
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
