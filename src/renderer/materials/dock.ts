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
 *   rim: after the tone, mixed toward black and levels added, the same on red, green and blue
 *     (dockRim below).
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

/*
 * The rim (fitted to the real Dock, in both themes): what the tone gives is mixed toward black by
 * a(θ, d) and c(θ, d) levels added, out = (1 − a)·toned + c, the same on red, green and blue. θ
 * is the outward normal's angle from the vertical (0 top and bottom, 90° a side), d the depth in
 * pt; the tables hold a | c every 15° and at 0.5, 1.5, 2.5 and 3.5pt, between which they are
 * read straight. The outermost entry holds the first point (about one point wide); past 3.5pt the
 * rim fades to nothing at 4.5pt. Top and bottom: dark brightens as a screen (+76 over black at the
 * outermost point, less over brighter), light adds +65; the sides darken, mixing 36% (dark) or
 * 26% (light) toward black.
 */
type Rim = readonly (readonly [number, number])[][]
const rims: Record<'light' | 'dark', Rim> = {
  dark: [
    [
      [0.33, 76],
      [0.08, 18],
      [0.04, 9],
      [0.02, 5],
    ],
    [
      [0.18, 31],
      [0.03, 7],
      [0.01, 3.5],
      [0, 1],
    ],
    [
      [0.18, 24],
      [0.02, 3],
      [0, 0],
      [0, 0],
    ],
    [
      [0.19, 15],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    [
      [0.29, 13],
      [0, 2],
      [0, 0],
      [0, 0],
    ],
    [
      [0.35, 5],
      [-0.05, 3],
      [0, 0],
      [0, 0],
    ],
    [
      [0.36, -3.5],
      [0.07, 3.4],
      [0, 0],
      [0, 0],
    ],
  ],
  light: [
    [
      [0.04, 65],
      [0, 15],
      [0, 9],
      [0.01, 6],
    ],
    [
      [0.16, 37],
      [0, 6],
      [0, 4],
      [0, 2],
    ],
    [
      [0.16, 28],
      [0.03, 6],
      [0, 3],
      [0, 3],
    ],
    [
      [0.14, 12],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    [
      [0.15, 3],
      [0.03, 6],
      [0, 0],
      [0, 0],
    ],
    [
      [0.21, -7],
      [0.03, 8],
      [0, 0],
      [0, 0],
    ],
    [
      [0.26, -13],
      [0.06, 8],
      [0, 0],
      [0, 0],
    ],
  ],
}
/** The rim's mix toward black and its added levels, by the outward normal's angle from the
 * vertical (radians, 0 to π/2) and the depth (pt). */
export function dockRim(theme: 'light' | 'dark', angle: number, d: number) {
  const table = rims[theme],
    row = Math.min(6, Math.max(0, (angle * 180) / Math.PI / 15))
  const at = (column: number) => {
    const low = Math.floor(row),
      high = Math.min(6, low + 1),
      t = row - low
    return [0, 1].map(
      (k) => table[low]![column]![k]! * (1 - t) + table[high]![column]![k]! * t,
    ) as [number, number]
  }
  // Depth to the tables' columns: the first point is the outermost entry, then 1.5 to 3.5pt one
  // column a point, fading to nothing by 4.5pt.
  if (d < 1) return { mix: at(0)[0], add: at(0)[1] }
  if (d >= 4.5) return { mix: 0, add: 0 }
  const column = d < 1.5 ? 2 * (d - 1) : d - 0.5
  const low = Math.min(3, Math.floor(column)),
    t = column - low
  const start = at(low),
    end = low < 3 ? at(low + 1) : ([0, 0] as [number, number])
  return { mix: start[0] + (end[0] - start[0]) * t, add: start[1] + (end[1] - start[1]) * t }
}
