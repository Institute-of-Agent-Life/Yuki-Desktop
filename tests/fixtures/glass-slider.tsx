/*
 * Transparency slider, research prototype v2 (2026-11-23). A settings-row slider shaped and timed
 * after the Liquid Glass slider of iOS 26 / macOS 26, every size and spring taken from Apple's
 * own material (HIG Sliders images, WWDC25 219 frames); the numbers and how they were measured
 * are in docs/reports/2026-11-23-liquid-glass/slider-v2.md.
 *
 *   ?value=<0–100>   starting transparency (default 60)
 *   ?theme=dark      dark appearance
 *   ?mag=<x>         magnify the held thumb's middle x times (comparison only; Apple's is 1.00)
 *   ?track=<pt>      track length, to set beside Apple's pictures at their own length
 *   ?shape=ios       the thumb as wide as in WWDC25 219's iOS slider (1.54:1) instead of HIG's (1.2:1)
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { capturePointer, swallowDragClick, useSprings } from '../../src/renderer/motion/hooks'
import { clamp, rubber, type SpringConfig } from '../../src/renderer/motion/spring'
import { lensFilter } from './glass-slider-lens'
import '../../src/renderer/tokens.css'
import './glass-slider.css'

const params = new URLSearchParams(location.search)
// Points, as CSS pixels. HIG sliders images (@2x): track 6, thumb 24 by 20, end icons about 2.6
// tracks across, set about 2.4 tracks from the track. WWDC25 219: held thumb 1.55 times as wide
// and 1.65 times as tall as at rest. `?shape=ios` keeps the iOS video's proportions instead: rest
// 1.54:1, held 1.45:1, at HIG's 20pt height.
const ios = params.get('shape') === 'ios'
export const geometry = {
  track: 6,
  rest: [ios ? 31 : 24, 20],
  held: [ios ? 48 : 37, 33],
  icon: 16,
  gap: 14,
} as const
// Springs as this app's Spring takes them: stiffness for a unit mass and damping ratio. Release and
// frost are fitted to WWDC25 219's front-on release (04m31.6s); the press is read off its toggle
// (rest to full in 4 frames) and is an estimate.
export const motion: Record<'press' | 'release' | 'frost' | 'stretch' | 'edge', SpringConfig> = {
  press: { k: 990, damping: 0.8 },
  release: { k: 165, damping: 0.69 },
  frost: { k: 248, damping: 0.81 },
  stretch: { k: 400, damping: 1 },
  edge: { k: 165, damping: 0.69 },
}
// Stretch along the drag: +0.2% of width per pt/s, at most 1.2 times (WWDC25 219: 1.17 at about
// 86 pt/s, 1.2 at most); the height gives up as much, keeping the area.
const stretchPerSpeed = 0.002,
  stretchLimit = 0.2

export function GlassSlider({
  label,
  value,
  magnify = 1,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  magnify?: number
  onChange(value: number): void
  onCommit(value: number): void
}) {
  const host = useRef<HTMLDivElement>(null),
    thumb = useRef<HTMLSpanElement>(null),
    lens = useRef<ReturnType<typeof lensFilter> | undefined>(undefined)
  // The thumb's place along the track, 0–1, continuous while dragged; the value is its rounding.
  const position = useRef(value / 100),
    dragging = useRef(false),
    cancel = useRef<(() => void) | undefined>(undefined),
    resting = useRef(0),
    reported = useRef(value)
  const latest = useRef({ onChange, onCommit })
  useLayoutEffect(() => {
    latest.current = { onChange, onCommit }
  })
  const { values, wake } = useSprings({ held: 0, clear: 0, stretch: 0, edge: 0 }, (s, reduced) => {
    const element = host.current,
      knob = thumb.current
    if (!element || !knob) return
    const width = element.clientWidth,
      held = s.held.value,
      clear = clamp(s.clear.value, 0, 1),
      sx = reduced ? 1 : 1 + clamp(s.stretch.value, 0, stretchLimit)
    const w = (geometry.rest[0] + (geometry.held[0] - geometry.rest[0]) * held) * sx,
      h = (geometry.rest[1] + (geometry.held[1] - geometry.rest[1]) * held) / sx
    const centre = geometry.rest[0] / 2 + (width - geometry.rest[0]) * position.current
    element.style.setProperty('--fill', `${centre}px`)
    knob.style.width = `${w}px`
    knob.style.height = `${h}px`
    knob.style.borderRadius = `${h / 2}px`
    knob.style.left = `${centre + (reduced ? 0 : s.edge.value) - w / 2}px`
    knob.style.top = `${(element.clientHeight - h) / 2}px`
    knob.style.setProperty('--clear', clear.toFixed(3))
    knob.style.setProperty('--held', clamp(held, 0, 1).toFixed(3))
    knob.dataset.rest = String(Object.values(s).every((spring) => spring.settled) && !held)
    lens.current?.strength(clear)
    lens.current?.resize(w, h)
  })
  useLayoutEffect(() => {
    lens.current = lensFilter(geometry.held[0], geometry.held[1], magnify)
    thumb.current!.style.setProperty('--lens', `url(#${lens.current.id})`)
    wake()
    return () => lens.current?.dispose()
  }, [magnify])
  useLayoutEffect(() => {
    reported.current = value
    if (dragging.current) return
    position.current = value / 100
    wake()
  }, [value])
  const set = (next: number) => {
    position.current = clamp(next, 0, 1)
    const rounded = Math.round(position.current * 100)
    if (rounded !== reported.current) {
      reported.current = rounded
      latest.current.onChange(rounded)
    }
    return rounded
  }
  const text = (v: number) => (v === 0 ? '不透明' : `${v}%`)
  return (
    <div
      ref={host}
      className="gs-slider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={text(value)}
      // macOS HIG: the value as a tooltip while the pointer rests on the slider; nothing printed.
      title={text(value)}
      onKeyDown={(event) => {
        const steps: Record<string, number> = {
          ArrowLeft: -5,
          ArrowDown: -5,
          ArrowRight: 5,
          ArrowUp: 5,
          PageDown: -25,
          PageUp: 25,
        }
        if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return
        event.preventDefault()
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 100
              : reported.current + steps[event.key]!
        const committed = set(clamp(next, 0, 100) / 100)
        latest.current.onCommit(committed)
        wake()
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        // Focus for the keyboard, without the keyboard's ring: a press is not keyboard focus.
        event.currentTarget.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
        cancel.current?.()
        const bounds = event.currentTarget.getBoundingClientRect(),
          span = bounds.width - geometry.rest[0],
          centre = bounds.left + geometry.rest[0] / 2 + span * position.current
        // On the thumb it is grabbed where it is held and does not jump; elsewhere on the track
        // the thumb comes to the pointer, as macOS sliders do.
        const grab =
          Math.abs(event.clientX - centre) <= geometry.held[0] / 2 ? event.clientX - centre : 0
        dragging.current = true
        values.held.aim(1, motion.press)
        values.clear.aim(1, motion.press)
        let previous = event.clientX,
          time = event.timeStamp
        const update = (move: PointerEvent) => {
          const along = move.clientX - grab - bounds.left - geometry.rest[0] / 2
          set(along / span)
          // Pulled past an end, the thumb follows a little way and springs back on release.
          values.edge.snap(
            along < 0 ? -rubber(-along, 6, 48) : along > span ? rubber(along - span, 6, 48) : 0,
          )
          const speed =
            (Math.abs(move.clientX - previous) * 1000) / Math.max(1, move.timeStamp - time)
          values.stretch.aim(Math.min(stretchLimit, speed * stretchPerSpeed), motion.stretch)
          // A thumb that stops moving stops stretching.
          clearTimeout(resting.current)
          resting.current = window.setTimeout(() => {
            values.stretch.aim(0, motion.release)
            wake()
          }, 60)
          previous = move.clientX
          time = move.timeStamp
          wake()
        }
        if (!grab && Math.abs(event.clientX - centre) > geometry.held[0] / 2)
          update(event.nativeEvent)
        cancel.current = capturePointer(event.currentTarget, event.nativeEvent, update, () => {
          dragging.current = false
          cancel.current = undefined
          clearTimeout(resting.current)
          swallowDragClick()
          values.held.aim(0, motion.release)
          values.clear.aim(0, motion.frost)
          values.stretch.aim(0, motion.release)
          values.edge.aim(0, motion.edge)
          latest.current.onCommit(Math.round(position.current * 100))
          wake()
        })
        wake()
      }}
    >
      <span className="gs-track" aria-hidden="true">
        <span className="gs-fill" />
      </span>
      <span ref={thumb} className="gs-thumb" aria-hidden="true" />
    </div>
  )
}

// Least transparency: a solid square. Most: a clear one, the backdrop showing through.
function Opaque() {
  return (
    <svg className="gs-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="2.5" fill="currentColor" />
    </svg>
  )
}
function Clear() {
  return (
    <svg className="gs-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="1.6"
        y="1.6"
        width="12.8"
        height="12.8"
        rx="3"
        fill="currentColor"
        fillOpacity="0.2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}

// A small window over a desktop picture, drawn from the variable the slider writes as it moves.
function Preview() {
  return (
    <figure className="gs-desk" data-testid="preview">
      <div className="gs-wallpaper" />
      <div className="gs-window" data-testid="preview-window">
        <aside>
          <i />
          <i />
          <i />
        </aside>
        <div className="gs-page">
          <p className="gs-bubble">今天的訪談整理好了嗎？</p>
          <p className="gs-bubble mine">整理好了，三場都在這裡。</p>
          <div className="gs-composer">傳訊息…</div>
        </div>
      </div>
    </figure>
  )
}

if (params.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark'
const commits: number[] = []
Object.assign(window, { glassSliderCommits: commits })

// What the renderer does: a CSS variable written on every move, the preference committed (here
// recorded in place of the `yuki:preferences` IPC call) once the thumb is let go.
function writeTransparency(value: number) {
  document.documentElement.style.setProperty('--window-transparency', String(value / 100))
}

function Page() {
  const [transparency, setTransparency] = useState(() =>
    clamp(Number(params.get('value') ?? 60), 0, 100),
  )
  useLayoutEffect(() => {
    writeTransparency(transparency)
  }, [transparency])
  useLayoutEffect(() => {
    document.documentElement.dataset.labReady = 'true'
  }, [])
  return (
    <main className="gs-layout">
      <section className="gs-form" aria-label="外觀">
        <h2>外觀</h2>
        <div className="gs-group">
          <div className="gs-row">
            <span className="gs-label">主題</span>
            <span className="gs-value">跟隨系統</span>
          </div>
          <div className="gs-row" data-testid="transparency-row">
            <span className="gs-label" id="transparency-label">
              透明度
            </span>
            <div
              className="gs-control"
              style={
                params.has('track')
                  ? { width: Number(params.get('track')) + 2 * (geometry.icon + geometry.gap) }
                  : undefined
              }
            >
              <Opaque />
              <GlassSlider
                label="透明度"
                value={transparency}
                magnify={Number(params.get('mag') ?? 1)}
                onChange={(value) => {
                  writeTransparency(value)
                  setTransparency(value)
                }}
                onCommit={(value) => commits.push(value)}
              />
              <Clear />
            </div>
          </div>
        </div>
        <p className="gs-footnote">拖到最左即不透明。系統開啟「減少透明度」時一律不透明。</p>
      </section>
      <Preview />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
