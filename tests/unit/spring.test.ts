import { describe, expect, it } from 'vitest'
import { Spring, rubber, springs } from '../../src/renderer/motion/spring'
import { roundedDistance } from '../../src/renderer/materials/glass'

describe('interruptible control feedback', () => {
  it('presses without overshoot, releases with one small overshoot and comes to rest', () => {
    const value = new Spring(1)
    value.aim(0.955, springs.pressDown)
    for (let i = 0; i < 30; i++) {
      value.step(1 / 120)
      expect(value.value).toBeGreaterThanOrEqual(0.955)
    }
    expect(value.value).toBeCloseTo(0.955, 3)
    value.aim(1, springs.pressUp)
    const positions: number[] = []
    for (let i = 0; i < 240; i++) {
      value.step(1 / 120)
      positions.push(value.value)
    }
    expect(Math.max(...positions)).toBeGreaterThan(1.002)
    expect(Math.max(...positions)).toBeLessThan(1.006)
    expect(value.settled).toBe(true)
    expect(value.value).toBe(1)
  })
  it('retargets from current position and velocity without a queued restart', () => {
    const value = new Spring(0)
    value.aim(120, springs.select)
    value.step(1 / 30)
    const position = value.value,
      velocity = value.velocity
    value.aim(40, springs.select)
    expect(value.value).toBe(position)
    expect(value.velocity).toBe(velocity)
    for (let i = 0; i < 180; i++) value.step(1 / 120)
    expect(value.value).toBe(40)
    expect(value.velocity).toBe(0)
  })
  it('bounds long frame stalls and appearance-only edge rubber', () => {
    const value = new Spring(1)
    value.aim(0.9, springs.pressDown)
    value.step(10)
    expect(value.value).toBeGreaterThan(0.9)
    expect(value.value).toBeLessThan(1)
    expect(rubber(48, 5, 48)).toBeCloseTo(3.808, 3)
    expect(rubber(10000, 5, 48)).toBeLessThanOrEqual(5)
    expect(rubber(-10000, 6, 40)).toBeGreaterThanOrEqual(-6)
  })
})
it('keeps lens displacement confined to rounded surface geometry', () => {
  expect(roundedDistance(0, 0, 50, 20, 14)).toBe(-20)
  expect(roundedDistance(50, 0, 50, 20, 14)).toBe(0)
  expect(roundedDistance(50, 20, 50, 20, 14)).toBeGreaterThan(0)
  expect(roundedDistance(-48, -8, 50, 20, 14)).toBe(roundedDistance(48, 8, 50, 20, 14))
})
