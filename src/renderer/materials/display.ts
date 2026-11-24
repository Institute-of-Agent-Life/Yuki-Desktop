/*
 * The display's colour space (as Chromium reports it to the main process: its primaries' and white's
 * chromaticities and its transfer). On a display other than sRGB, Chromium treats what a filter
 * primitive produces as sRGB and converts it to the display before the next one reads it. For a
 * displacement map that changes where each pixel samples (a grey 0.5 reads as 0.456 on a
 * gamma-1.96 display, moving the glass's whole content 2pt), so the map's values are made such
 * that, converted, they are the ones meant (glass.ts).
 */
type Matrix = [number, number, number][]

const srgbDecode = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const srgbEncode = (l: number) =>
  l <= 0.0031308 ? l * 12.92 : 1.055 * Math.max(0, l) ** (1 / 2.4) - 0.055
const gamma = (g: number) => ({
  decode: (c: number) => Math.max(0, c) ** g,
  encode: (l: number) => Math.max(0, l) ** (1 / g),
})
const transfers: Record<string, { decode(c: number): number; encode(l: number): number }> = {
  SRGB: { decode: srgbDecode, encode: srgbEncode },
  IEC61966_2_1: { decode: srgbDecode, encode: srgbEncode },
  BT709_APPLE: gamma(1.961),
  GAMMA18: gamma(1.8),
  GAMMA22: gamma(2.2),
  GAMMA24: gamma(2.4),
  GAMMA28: gamma(2.8),
  LINEAR: gamma(1),
}

const invert = (m: Matrix): Matrix => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m as [Matrix[0], Matrix[0], Matrix[0]]
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ]
}
const multiply = (m: Matrix, n: Matrix): Matrix =>
  m.map((row) =>
    [0, 1, 2].map((j) => row.reduce((sum, value, k) => sum + value * n[k]![j]!, 0)),
  ) as Matrix
// Linear RGB to XYZ, for primaries and white given as chromaticities.
const toXYZ = (primaries: [number, number][], white: [number, number]): Matrix => {
  const xyz = ([x, y]: [number, number]) => [x / y, 1, (1 - x - y) / y]
  const columns = primaries.map(xyz),
    p: Matrix = [0, 1, 2].map((r) => columns.map((c) => c[r]!)) as Matrix
  const w = xyz(white),
    s = invert(p).map((row) => row.reduce((sum, value, k) => sum + value * w[k]!, 0))
  return p.map((row) => row.map((value, k) => value * s[k]!)) as Matrix
}
const srgbPrimaries: [number, number][] = [
  [0.64, 0.33],
  [0.3, 0.6],
  [0.15, 0.06],
]

/**
 * For a display's colour space, what to produce for red and green so that, converted from sRGB to
 * the display, they read as `x` and `y` (blue held at 0). Identity on an sRGB display.
 */
export function mapValues(colorSpace: string | undefined) {
  const numbers = (name: string) =>
    colorSpace
      ?.match(new RegExp(`${name}:\\[([\\d.]+), ([\\d.]+)\\]`))
      ?.slice(1)
      .map(Number) as [number, number] | undefined
  const r = numbers('r'),
    g = numbers('g'),
    b = numbers('b'),
    w = numbers('w')
  const transfer = transfers[colorSpace?.match(/transfer:([A-Z0-9_]+)/)?.[1] ?? 'SRGB']
  if (!r || !g || !b || !w || !transfer) return (x: number, y: number) => [x, y] as const
  // sRGB linear to the display's linear: the red and green rows, for red and green alone.
  const toDisplay = multiply(invert(toXYZ([r, g, b], w)), toXYZ(srgbPrimaries, w))
  const two = invert([
    [toDisplay[0]![0], toDisplay[0]![1], 0],
    [toDisplay[1]![0], toDisplay[1]![1], 0],
    [0, 0, 1],
  ])
  return (x: number, y: number) => {
    const dx = transfer.decode(x),
      dy = transfer.decode(y)
    const red = two[0]![0] * dx + two[0]![1] * dy,
      green = two[1]![0] * dx + two[1]![1] * dy
    return [
      Math.min(1, Math.max(0, srgbEncode(red))),
      Math.min(1, Math.max(0, srgbEncode(green))),
    ] as const
  }
}

/**
 * The display's encoding to sRGB's and back, as feComponentTransfer tables (null on an sRGB
 * display): the glass's colour is worked out in sRGB, where it was measured, though the backdrop
 * arrives in the display's encoding.
 */
export function encodings(colorSpace: string | undefined) {
  const name = colorSpace?.match(/transfer:([A-Z0-9_]+)/)?.[1] ?? 'SRGB'
  const transfer = transfers[name]
  if (!transfer || name === 'SRGB' || name === 'IEC61966_2_1') return null
  const table = (f: (c: number) => number) =>
    Array.from({ length: 64 }, (_, i) => f(i / 63).toFixed(4)).join(' ')
  return {
    toSRGB: table((c) => srgbEncode(transfer.decode(c))),
    fromSRGB: table((c) => transfer.encode(srgbDecode(c))),
  }
}
