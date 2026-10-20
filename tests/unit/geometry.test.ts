import { describe, expect, it } from 'vitest'
import { columns, windowGeometry } from '../../src/main/geometry'

describe('moving windows across actual available work areas', () => {
  it('keeps the titlebar and entire window visible on a 200% monitor', () => {
    const area = { x: 1920, y: 0, width: 960, height: 492 }
    const result = windowGeometry(area, { x: -500, y: -200, width: 1440, height: 900 })
    expect(result.bounds).toEqual(area)
    expect(result.minimum).toEqual({ width: 960, height: 492 })
  })
  it('does not enlarge the window when returning to a larger display', () => {
    const saved = { x: 0, y: 0, width: 960, height: 640 }
    expect(windowGeometry({ x: 0, y: 0, width: 1920, height: 1040 }, saved).bounds).toEqual(saved)
  })
  it('allows work areas smaller than the normal minimum', () => {
    expect(windowGeometry({ x: 0, y: 0, width: 911, height: 464 }).bounds).toEqual({
      x: 0,
      y: 0,
      width: 911,
      height: 464,
    })
  })
})
describe('three column sizing', () => {
  it('uses the large automatic inspector while preserving explicit widths across breakpoints', () => {
    expect(columns(1920, 260, 380, true, true, true)).toMatchObject({
      inspector: 440,
      center: 1220,
    })
    expect(columns(1679, 260, 380, true, true, true).inspector).toBe(380)
    expect(columns(1920, 260, 380).inspector).toBe(380)
    expect(columns(1920, 260, 508).inspector).toBe(508)
    expect(columns(1180, 320, 560).inspector).toBe(340)
    expect(columns(1920, 320, 560).inspector).toBe(560)
  })
  it('keeps the center readable for all drag combinations at the narrow breakpoint', () => {
    for (let sidebar = 220; sidebar <= 320; sidebar += 4) {
      for (let inspector = 320; inspector <= 560; inspector += 4) {
        const result = columns(1180, sidebar, inspector)
        expect(result.center).toBeGreaterThanOrEqual(520)
        expect(result.inspector).toBeGreaterThanOrEqual(320)
        expect(result.sidebar).toBeGreaterThanOrEqual(220)
      }
    }
  })
  it('moves panels to overlays without reducing text size on small screens', () => {
    expect(columns(960, 320, 560)).toMatchObject({
      sidebar: 0,
      inspector: 0,
      center: 960,
      overlayInspector: true,
      overlaySidebar: true,
    })
  })
})
