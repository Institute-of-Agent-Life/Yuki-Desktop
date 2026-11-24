/*
 * The appearance of glass that carries text, as iOS 26's glass takes it: over a picture of one's
 * own (backdrop.ts) the composer, the toolbar's capsules, the sidebar and each bubble turn to the
 * dark glass with white ink over a dark part of it, and to the light glass with black ink over a
 * bright one, whatever the theme, each by what lies under itself (`data-appearance`). Over the
 * app's own backdrops the theme's appearance holds.
 *
 * What lies under an element is read from the picture as the bubbles' blurred copy has it
 * (backdrop.ts: blurred as a bubble's glass blurs, the page's colour laid over it as dimmed), as
 * luma (Rec. 709 on the encoded values, 0–1, as the Dock's tone weighs it) under the element's
 * box, and of that
 *   the mean, which chooses: dark below 0.46 − 0.05, light above 0.46 + 0.05, and between the
 *     two whatever it was (so it holds while the window moves or resizes near the threshold);
 *   the 90th percentile, which guards white ink against bright spots under it: above 0.70 the
 *     glass is light, and it turns dark again only below 0.65.
 * The threshold is where the two glasses (dock.ts) give main text the same contrast: black on
 * the light glass at luma 0.46 and white on the dark glass both 5.4:1; at the band's edges black
 * keeps 4.8:1 over the light glass (luma 0.41, glass level 121) and white 4.8:1 over the dark one
 * (luma 0.51, glass level 114), and quiet text, its ink at 0.66 over the glass (materials.css),
 * 3.3:1 and 3.1:1. Under the guard white keeps 3.2:1 over the dark glass at luma 0.70.
 * The glass and its ink cross-fade over 200ms as it turns (glass.ts, materials.css).
 */
export type Appearance = 'light' | 'dark'

/** The mean and 90th percentile of the luma (sRGB, 0–1) under a box in the window. */
export type Sample = (box: DOMRect) => { mean: number; high: number }

const threshold = 0.46,
  band = 0.05,
  guard = 0.7

let sample: Sample | undefined
const watched = new Set<HTMLElement>()
let frame = 0

function decide(element: HTMLElement) {
  // Between one picture and the next it keeps the appearance it has; with none it has the theme's.
  if (!sample) {
    if (document.documentElement.dataset.backdrop !== 'custom') delete element.dataset.appearance
    return
  }
  const box = element.getBoundingClientRect()
  // Out of sight it keeps what it was; it is read again as it comes in.
  if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight) return
  const { mean, high } = sample(box)
  const shown = element.dataset.appearance as Appearance | undefined
  const next: Appearance =
    shown === 'dark'
      ? mean > threshold + band || high > guard
        ? 'light'
        : 'dark'
      : shown === 'light'
        ? mean < threshold - band && high < guard - band
          ? 'dark'
          : 'light'
        : mean < threshold && high < guard
          ? 'dark'
          : 'light'
  if (next !== shown) element.dataset.appearance = next
}

const update = () => {
  frame = 0
  for (const element of watched) decide(element)
}
const schedule = () => {
  frame ||= requestAnimationFrame(update)
}
addEventListener('scroll', schedule, { capture: true, passive: true })
addEventListener('resize', schedule)
addEventListener('transitionend', schedule, true)
addEventListener('animationend', schedule, true)
const sizes = new ResizeObserver(schedule)

/** What lies under the glass, while a picture of one's own is shown (none: the theme's). */
export function setBackdropSample(next: Sample | undefined) {
  sample = next
  if (!next) {
    cancelAnimationFrame(frame)
    frame = 0
    update()
  } else schedule()
}

/** Gives `element` the appearance of what lies under it, until called. */
export function watchAppearance(element: HTMLElement) {
  watched.add(element)
  sizes.observe(element)
  decide(element)
  return () => {
    watched.delete(element)
    sizes.unobserve(element)
    delete element.dataset.appearance
  }
}
