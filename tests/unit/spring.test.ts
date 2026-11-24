import { describe, expect, it } from 'vitest'
import { physics, sampleSpring, springs, type SpringConfig } from '../../src/renderer/motion/spring'

/*
 * Springs in SwiftUI's terms (hig-audit.md §8). Failure cases, written before the change:
 *   1. a spring is given as stiffness and damping, not duration and bounce;
 *   2. the conversion is not SwiftUI's: duration 0.5 is not k ≈ 157.9, bounce 0.15 not ζ 0.85;
 *   3. a transition overshoots more than `.snappy` (bounce 0.15), or what a hand lets go of
 *      (a press released, a thumb, a switch) more than 0.2; Apple's measured slider is kept;
 *   4. a spring is quicker than `interactiveSpring` (0.15s) or slower than SwiftUI's 0.5s;
 *   5. a spring without bounce overshoots at all, or one's overshoot does not grow with its bounce.
 */
const handled = new Set(['pressUp', 'thumb', 'toggle'])
const measured = new Set(['sliderPress', 'sliderRelease', 'sliderFrost', 'sliderStretch'])
const overshoot = (config: SpringConfig) =>
  Math.max(...sampleSpring(config).map((sample) => sample.value)) - 1

describe('springs', () => {
  it('are stated as duration and bounce', () => {
    for (const [name, config] of Object.entries(springs))
      expect(Object.keys(config).sort(), name).toEqual(['bounce', 'duration'])
  })
  it("convert as SwiftUI's do", () => {
    const smooth = physics({ duration: 0.5, bounce: 0 }),
      snappy = physics({ duration: 0.5, bounce: 0.15 })
    expect(smooth.k).toBeCloseTo(157.91, 1)
    expect(smooth.damping).toBe(1)
    expect(snappy.damping).toBeCloseTo(0.85, 5)
  })
  it('bounce no more than snappy, or a little more where a hand lets go', () => {
    for (const [name, config] of Object.entries(springs)) {
      if (measured.has(name)) continue
      expect(config.bounce, name).toBeLessThanOrEqual(handled.has(name) ? 0.2 : 0.15)
      expect(config.duration, name).toBeGreaterThanOrEqual(0.15)
      expect(config.duration, name).toBeLessThanOrEqual(0.5)
    }
  })
  it('overshoot as much as their bounce says', () => {
    expect(overshoot({ duration: 0.3, bounce: 0 })).toBeLessThanOrEqual(0.0005)
    expect(overshoot({ duration: 0.3, bounce: 0.15 })).toBeGreaterThan(0.001)
    expect(overshoot({ duration: 0.3, bounce: 0.3 })).toBeGreaterThan(
      overshoot({ duration: 0.3, bounce: 0.15 }),
    )
  })
})
