/*
 * The glass of the macOS Dock, as measured on this Mac (Apple's own glass filter fitted to the real
 * Dock, then the Dock's colour and edge measured, in both themes). What lies behind the glass is
 * blurred a little (2pt), then:
 *   tone: its luminance Y (levels) mapped by a curve, its colour's distance from grey kept and
 *     raised: each channel C becomes tone(Y) + g·(C − Y), with
 *       light: tone(Y) = 48.4 + 0.695·Y, g = 1.2;
 *       dark: tone(Y) = 11 + 0.919·Y − 0.000992·Y², g = 1.08.
 *     The system's Clear ↔ Tinted slider (`NSGlassTintAmount`, read by the main process) moves
 *     the dark one toward 34 + 0.32·Y when fully tinted (measured once, at 1);
 *   lens: within 13pt of the edge each point shows what lies D(d) deeper along the inward normal,
 *     D(d) = 25.5·(e^(−d/4) − e^(−13/4)), so the band mirrors the strip just inside it;
 *   rim: after the tone, the same added to red, green and blue (so it keeps the colour within):
 *     in the outermost point +52·sin⁴θ at the top and bottom and −S·cos⁴θ on the sides (S 64
 *     light, 39 dark), nothing near 45–60°; within, at the top and bottom only, +15, +9, +6, +3.5
 *     and +2 at 1 to 5pt, times sin⁴θ (θ the outward normal's angle from the right).
 * No tint, fill, hairline or shadow is laid on it.
 */
export const dockLens = { amplitude: 25.5, decay: 4, width: 13 } as const

const middle = 0.49

/** The tone curve (levels to levels) and the colour's gain, for a theme and the slider's place. */
export function dockTone(theme: 'light' | 'dark', tint: number) {
  if (theme === 'light') return { tone: (y: number) => 48.4 + 0.695 * y, gain: 1.2 }
  const toward = Math.min(1, Math.max(0, (tint - middle) / (1 - middle)))
  return {
    tone: (y: number) =>
      (1 - toward) * (11 + 0.919 * y - 0.000992 * y * y) + toward * (34 + 0.32 * y),
    gain: 1.08,
  }
}

// Luminance, as Apple's filter weighs the channels (Rec. 709, on the encoded values).
const weights = [0.2126, 0.7152, 0.0722] as const
/** tone(Y) − g·Y is held lifted by this much, so that it stays within 0–1 in a filter's table. */
export const dockLift = 100

/**
 * The glass's colour in a filter: Y (a colour matrix), then tone(Y) − g·Y + lift as a table on it,
 * then added to g·C (dropping the lift).
 */
export function dockFilter(theme: 'light' | 'dark', tint: number) {
  const { tone, gain } = dockTone(theme, tint)
  return {
    luma: [0, 1, 2]
      .map(() => `${weights.join(' ')} 0 0`)
      .concat('0 0 0 1 0')
      .join(' '),
    curve: Array.from({ length: 256 }, (_, i) =>
      ((tone(i) - gain * i + dockLift) / 255).toFixed(4),
    ).join(' '),
    gain,
  }
}

/** The glass's colour for one sRGB colour (0–255), as the filter gives it. */
export function dockColour(theme: 'light' | 'dark', tint: number) {
  const { tone, gain } = dockTone(theme, tint)
  return (r: number, g: number, b: number) => {
    const y = weights[0] * r + weights[1] * g + weights[2] * b,
      shade = tone(y)
    return [r, g, b].map((c) => shade + gain * (c - y))
  }
}

/**
 * The tone as a grey laid over what lies behind, `rgb(level level level / cover)`: the straight
 * line touching the curve where a page of the theme's colour lies (white light, #1b1d22 dark), for
 * what carries no filter of its own (the bubbles' copy of a pattern).
 */
export function dockToneLayer(theme: 'light' | 'dark', tint: number) {
  const { tone } = dockTone(theme, tint),
    at = theme === 'light' ? 254 : 29,
    slope = (tone(at + 1) - tone(at - 1)) / 2,
    intercept = tone(at) - slope * at,
    cover = 1 - slope,
    level = Math.round(intercept / cover)
  return `rgb(${level} ${level} ${level} / ${cover.toFixed(3)})`
}

const tail = [15, 9, 6, 3.5, 2]
/** The rim, in levels, by the outward normal's angle (radians, 0 right, π/2 up) and depth (pt). */
export function dockRim(theme: 'light' | 'dark', theta: number, d: number) {
  const vertical = Math.sin(theta) ** 4,
    side = Math.cos(theta) ** 4
  if (d < 1) return 52 * vertical - (theme === 'light' ? 64 : 39) * side
  if (d >= 6) return 0
  const i = Math.floor(d) - 1,
    next = i < 4 ? tail[i + 1]! : 0
  return vertical * (tail[i]! + (next - tail[i]!) * (d - Math.floor(d)))
}
