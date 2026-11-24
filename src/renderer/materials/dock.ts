/*
 * The glass of the macOS Dock, as measured on this Mac (Apple's own glass filter fitted to the real
 * Dock, then the Dock's edge measured). What lies behind the glass is blurred a little (2pt), then:
 *   tone: its luminance Y mapped straight, intercept + slope·Y (dark 20 + 0.67·Y; light
 *     provisional, 122 + 0.48·Y, until a light Dock is measured), while its colour's distance from
 *     grey is kept and raised a tenth: each channel C becomes tone(Y) + 1.1·(C − Y). Over grey
 *     that is the straight line; over a saturated colour it keeps the colour where a per-channel
 *     line would grey it (Apple's own filter does so, within a level). The system's Clear ↔
 *     Tinted slider (`NSGlassTintAmount`, read by the main process) moves the dark one toward
 *     34 + 0.32·Y when fully tinted (measured once, at 1);
 *   lens: within 13pt of the edge each point shows what lies D(d) deeper along the inward normal,
 *     D(d) = 25.5·(e^(−d/4) − e^(−13/4)), so the band mirrors the strip just inside it;
 *   rim: what the lens shows is multiplied by 1 + k(θ)·r(d), keeping its colour: k lit along the
 *     vertical axis (+0.30 at the top, +0.22 at the bottom, −0.15 on the sides), r(d) = e^(−d/1.6).
 * No tint, fill, hairline or shadow is laid on it.
 */
export const dockSaturation = 1.1
export const dockLens = { amplitude: 25.5, decay: 4, width: 13 } as const

const middle = 0.49

/** The tone's slope and intercept (0–1) for a theme and the slider's place (0 clear, 1 tinted). */
export function dockTone(theme: 'light' | 'dark', tint: number) {
  if (theme === 'light') return { slope: 0.48, intercept: 0.478 }
  const toward = Math.min(1, Math.max(0, (tint - middle) / (1 - middle)))
  return {
    slope: 0.67 + (0.32 - 0.67) * toward,
    intercept: (20 + (34 - 20) * toward) / 255,
  }
}

// Luminance, as Apple's filter weighs the channels (Rec. 709, on the encoded values).
const weights = [0.2126, 0.7152, 0.0722] as const

/**
 * The glass's colour as an feColorMatrix (type "matrix", sRGB): each channel tone(Y) + s·(C − Y),
 * and the alpha whole (the half pixel of blur past the glass's edge keeps the colour within).
 */
export function dockMatrix(theme: 'light' | 'dark', tint: number) {
  const { slope, intercept } = dockTone(theme, tint),
    s = dockSaturation
  return [0, 1, 2]
    .map((row) =>
      [...weights.map((w, column) => (row === column ? s : 0) + (slope - s) * w), 0, intercept]
        .map((value) => value.toFixed(4))
        .join(' '),
    )
    .concat('0 0 0 0 1')
    .join(' ')
}

/**
 * The tone as a grey laid over what lies behind: `rgb(level level level / cover)` maps B to
 * (1 − cover)·B + cover·level, the same straight line. For what carries no filter of its own (the
 * bubbles' copy of the backdrop).
 */
export function dockToneLayer(theme: 'light' | 'dark', tint: number) {
  const { slope, intercept } = dockTone(theme, tint),
    cover = 1 - slope,
    level = Math.round((intercept * 255) / cover)
  return `rgb(${level} ${level} ${level} / ${cover.toFixed(3)})`
}

/** The rim's strength by the outward normal's angle (radians, 0 right, π/2 up). */
export const dockRim = (theta: number) =>
  0.055 - 0.205 * Math.cos(2 * theta) + 0.04 * Math.sin(theta)
/** The rim's fall inward, by depth (pt). */
export const dockRimDepth = (d: number) => Math.exp(-Math.max(0, d) / 1.6)
