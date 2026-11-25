/*
 * The appearance of glass that carries text, as iOS 26's glass takes it: over a picture of one's
 * own (backdrop.ts) the composer and its send button, the toolbar's capsules, the sidebar, each
 * bubble and each block of content turn to the dark glass with white ink over a dark part of it, and to
 * the light glass with black ink over a bright one, whatever the theme, each by what lies under
 * itself (`data-appearance`); so does content's frost (materials.css). Over the app's own backdrops the theme's appearance holds.
 *
 * What lies under an element is read from the picture as the bubbles' blurred copy has it
 * (backdrop.ts: blurred as a bubble's glass blurs, the page's colour laid over it as dimmed), as
 * luma (Rec. 709 on the encoded values, 0–1, as the Dock's tone weighs it) under the element's
 * box. The glass keeps the theme's appearance while its main ink still reads at 4.5:1 over what
 * the mean gives, as Apple's does, and turns only where it would not:
 *   light theme: black on the light glass keeps 4.5:1 down to a mean of 0.39 (glass level 118);
 *     below it the glass turns dark, and light again only above 0.49 (white on the dark glass
 *     there 5.1:1), so it holds while the window moves or resizes near the edge;
 *   dark theme: white on the dark glass keeps 4.5:1 up to 0.53 (glass level 118); above it the
 *     glass turns light, and dark again only below 0.43 (black on the light glass 5.2:1).
 * Quiet text, black at 0.66 or white at 0.70 over the glass (materials.css), keeps 3.2:1 at those
 * edges. The 90th percentile guards white ink against bright spots under it: above 0.70 the glass
 * is light (white keeps 3.2:1 over the dark glass at 0.70), and it may turn dark only below 0.65.
 * The glass and its ink cross-fade over 200ms as it turns (glass.ts, materials.css).
 */
export type Appearance = 'light' | 'dark'

/** The mean and 90th percentile of the luma (sRGB, 0–1) under a box in the window. */
export type Sample = (box: DOMRect) => { mean: number; high: number }

// Where each theme's glass turns to the other appearance, and where it turns back.
const edges = {
  light: { turn: 0.39, back: 0.49 },
  dark: { turn: 0.53, back: 0.43 },
} as const
const guard = 0.7,
  band = 0.05

let sample: Sample | undefined
// What is to be read afresh, by the theme's rule alone: everything, when another picture (or the
// picture of another theme) is shown. Hysteresis holds only while one picture stays.
let anew = new WeakSet<HTMLElement>()
// What is watched (and whether it is content, whose frost is a fill without GPU compositing), and
// of it what is in sight: only that is read as the conversation scrolls. Their sizes and sight are
// observed only while a picture of one's own is shown, so that otherwise a long conversation costs
// nothing more to scroll.
const watched = new Map<HTMLElement, boolean>(),
  shown = new Set<HTMLElement>()
let frame = 0

/*
 * Glass shows what lies under it only while it is glass: without transparency it is a fill of the
 * theme, and so is content's frost without GPU compositing (glass then keeps its blur and colour,
 * which take the appearance: materials.css). There the theme's appearance holds.
 */
const showsThrough = (content: boolean) => {
  const root = document.documentElement.dataset
  return root.opaque !== 'true' && !(content && root.gpuCompositing === 'false')
}

function decide(element: HTMLElement) {
  if (!showsThrough(watched.get(element) ?? false)) {
    delete element.dataset.appearance
    return
  }
  // Between one picture and the next it keeps the appearance it has; with none it has the theme's.
  if (!sample) {
    if (document.documentElement.dataset.backdrop !== 'custom') delete element.dataset.appearance
    return
  }
  const box = element.getBoundingClientRect()
  if (!box.width || !box.height) return
  const { mean, high } = sample(box)
  const had = anew.has(element) ? undefined : (element.dataset.appearance as Appearance | undefined)
  anew.delete(element)
  const theme: Appearance = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  const { turn, back } = edges[theme],
    shown = had ?? theme
  // Dark is allowed only below the guard (entered only below it less the band).
  const darkAllowed = high < (shown === 'dark' ? guard : guard - band)
  const next: Appearance =
    theme === 'light'
      ? shown === 'light'
        ? mean < turn && darkAllowed
          ? 'dark'
          : 'light'
        : mean > back || !darkAllowed
          ? 'light'
          : 'dark'
      : shown === 'dark'
        ? mean > turn || !darkAllowed
          ? 'light'
          : 'dark'
        : mean < back && darkAllowed
          ? 'dark'
          : 'light'
  if (next !== had) element.dataset.appearance = next
}

const update = () => {
  frame = 0
  for (const element of shown) decide(element)
}
const schedule = () => {
  frame ||= requestAnimationFrame(update)
}
addEventListener('scroll', schedule, { capture: true, passive: true })
addEventListener('resize', schedule)
addEventListener('transitionend', schedule, true)
addEventListener('animationend', schedule, true)
const sizes = new ResizeObserver(schedule)
// Out of sight an element keeps what it was; it is read again as it comes in.
const sight = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const element = entry.target as HTMLElement
    if (entry.isIntersecting) {
      shown.add(element)
      decide(element)
    } else shown.delete(element)
  }
})

const observe = (element: HTMLElement) => {
  sizes.observe(element)
  sight.observe(element)
}
const unobserve = (element: HTMLElement) => {
  sizes.unobserve(element)
  sight.unobserve(element)
  shown.delete(element)
}

/*
 * Content's frost (materials.css: `data-frost`, and the children of `data-frost-children`) is
 * watched as it comes into the page and left as it goes, while a picture of one's own is shown.
 */
const frost = '[data-frost], [data-frost-children] > :not([data-frost-children])'
const frosts = new Map<HTMLElement, () => void>()
const addFrost = (node: Node) => {
  if (!(node instanceof HTMLElement)) return
  for (const element of [
    ...(node.matches(frost) ? [node] : []),
    ...node.querySelectorAll<HTMLElement>(frost),
  ])
    if (!frosts.has(element)) frosts.set(element, watchAppearance(element, true))
}
const blocks = new MutationObserver((records) => {
  let removed = false
  for (const record of records) {
    record.addedNodes.forEach(addFrost)
    removed ||= [...record.removedNodes].some((node) => node instanceof HTMLElement)
  }
  if (removed)
    for (const [element, unwatch] of frosts)
      if (!element.isConnected || !element.matches(frost)) {
        unwatch()
        frosts.delete(element)
      }
})

/**
 * What lies under the glass, while a picture of one's own is shown (none: the theme's); `fresh`
 * the first time for a picture, which every glass then reads afresh.
 */
export function setBackdropSample(next: Sample | undefined, fresh = false) {
  if (!sample && next) {
    addFrost(document.body)
    blocks.observe(document.body, { childList: true, subtree: true })
  }
  if (sample && !next) {
    blocks.disconnect()
    for (const unwatch of frosts.values()) unwatch()
    frosts.clear()
  }
  if (fresh) anew = new WeakSet(watched.keys())
  if (!sample && next) for (const element of watched.keys()) observe(element)
  if (sample && !next) for (const element of watched.keys()) unobserve(element)
  sample = next
  if (!next) {
    cancelAnimationFrame(frame)
    frame = 0
    for (const element of watched.keys()) decide(element)
  } else schedule()
}

new MutationObserver(() => {
  for (const element of watched.keys()) decide(element)
}).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-opaque', 'data-gpu-compositing'],
})

/**
 * Gives `element` the appearance of what lies under it, until called; `content` for a bubble or a
 * card, whose frost is a fill without GPU compositing.
 */
export function watchAppearance(element: HTMLElement, content = false) {
  watched.set(element, content)
  if (sample) observe(element)
  decide(element)
  return () => {
    watched.delete(element)
    unobserve(element)
    delete element.dataset.appearance
  }
}
