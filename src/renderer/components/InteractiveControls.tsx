import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useGlass } from '../materials/glass'
import { capturePointer, reducedMotion, swallowDragClick, useSprings } from '../motion/hooks'
import { clamp, rubber, springs } from '../motion/spring'
import styles from './InteractiveControls.module.css'

export function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange(value: boolean): void
  disabled?: boolean
}) {
  const glass = useGlass<HTMLSpanElement>('toggle', true),
    host = useRef<HTMLButtonElement>(null)
  const drag = useRef(false),
    latest = useRef({ checked, onChange }),
    cancel = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => {
    latest.current = { checked, onChange }
  })
  const { values, wake } = useSprings({ x: checked ? 16 : 0, press: 0 }, (s, reduced) => {
    if (!glass.ref.current) return
    const pressure = clamp(s.press.value, 0, 1),
      p = reduced ? 0 : pressure
    const x = s.x.value
    glass.ref.current.style.transform = `translateX(${x - (p * 6 * x) / 16}px)`
    glass.ref.current.style.width = `${18 + p * 6}px`
    glass.setStrength(pressure)
    host.current?.style.setProperty('--toggle-progress', String(clamp(x / 16, 0, 1)))
  })
  useLayoutEffect(() => {
    if (!drag.current) {
      values.x.aim(checked ? 16 : 0, springs.toggle)
      wake()
    }
  }, [checked])
  useLayoutEffect(() => {
    if (disabled) cancel.current?.()
    return () => cancel.current?.()
  }, [disabled])
  return (
    <button
      ref={host}
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className={styles.toggle}
      onClick={() => latest.current.onChange(!latest.current.checked)}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || !event.isPrimary) return
        cancel.current?.()
        const start = event.clientX,
          initial = checked ? 16 : 0
        let moved = false
        drag.current = true
        values.press.aim(1, springs.thumb)
        wake()
        cancel.current = capturePointer(
          event.currentTarget,
          event.nativeEvent,
          (move) => {
            const dx = move.clientX - start
            if (!moved && Math.abs(dx) < 3) return
            moved = true
            values.x.snap(clamp(initial + dx, 0, 16))
            wake()
          },
          (reason) => {
            drag.current = false
            cancel.current = undefined
            values.press.aim(0, springs.thumb)
            const next = values.x.value > 8
            if (moved) swallowDragClick()
            if (moved && reason === 'up') {
              swallowDragClick()
              if (next !== latest.current.checked) latest.current.onChange(next)
              values.x.aim(next ? 16 : 0, springs.toggle)
            } else values.x.aim(latest.current.checked ? 16 : 0, springs.toggle)
            wake()
          },
        )
      }}
    >
      <span ref={glass.ref} data-glass="toggle" className={styles.toggleThumb} />
    </button>
  )
}

export function Segmented<T extends string>({
  label,
  items,
  value,
  onChange,
  disabled = false,
  kind = 'tabs',
}: {
  label: string
  items: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  kind?: 'tabs' | 'radio'
}) {
  const root = useRef<HTMLDivElement>(null),
    glass = useGlass<HTMLSpanElement>('segment', true)
  const latest = useRef({ value, onChange }),
    active = useRef(false),
    initialized = useRef(false)
  const cancel = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => {
    latest.current = { value, onChange }
  })
  const buttons = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  const { values, wake } = useSprings({ x: 2, width: 64, press: 0 }, (s, reduced) => {
    const thumb = glass.ref.current
    if (!thumb) return
    const pressure = clamp(s.press.value, 0, 1),
      p = reduced ? 0 : pressure,
      velocity = reduced ? 0 : Math.min(0.05, Math.abs(s.x.velocity) / 4000)
    thumb.style.width = `${s.width.value}px`
    thumb.style.transform = `translateX(${s.x.value}px) scale(${1 + 0.04 * p + velocity},${1 + 0.08 * p - velocity * 0.4})`
    glass.setStrength(pressure)
  })
  const target = (snap = false) => {
    const selected = buttons().find((button) => button.dataset.value === latest.current.value)
    if (!selected) return
    if (snap || !initialized.current) {
      values.x.snap(selected.offsetLeft)
      values.width.snap(selected.offsetWidth)
      initialized.current = true
    } else {
      values.x.aim(selected.offsetLeft, springs.select)
      values.width.aim(selected.offsetWidth, springs.select)
    }
    wake()
  }
  useLayoutEffect(() => {
    if (!active.current) target()
  }, [value, items])
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      if (!active.current) target(true)
    })
    if (root.current) observer.observe(root.current)
    return () => {
      observer.disconnect()
      cancel.current?.()
    }
  }, [])
  useLayoutEffect(() => {
    if (disabled) cancel.current?.()
  }, [disabled])
  return (
    <div
      ref={root}
      className={styles.segment}
      role={kind === 'tabs' ? 'tablist' : 'radiogroup'}
      aria-label={label}
    >
      <span
        ref={glass.ref}
        data-glass="segment"
        className={styles.segmentThumb}
        aria-hidden="true"
      />
      {items.map((item, index) => (
        <button
          key={item.value}
          type="button"
          data-value={item.value}
          disabled={disabled}
          role={kind === 'tabs' ? 'tab' : 'radio'}
          aria-selected={kind === 'tabs' ? value === item.value : undefined}
          aria-checked={kind === 'radio' ? value === item.value : undefined}
          tabIndex={value === item.value ? 0 : -1}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : (index + (event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length
            onChange(items[next]!.value)
            buttons()[next]?.focus()
          }}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0 || !event.isPrimary) return
            cancel.current?.()
            values.press.aim(1, springs.thumb)
            wake()
            if (item.value !== value) {
              const release = () => {
                cancel.current = undefined
                values.press.aim(0, springs.thumb)
                wake()
                window.removeEventListener('pointerup', release)
                window.removeEventListener('pointercancel', release)
                window.removeEventListener('blur', release)
              }
              cancel.current = release
              window.addEventListener('pointerup', release)
              window.addEventListener('pointercancel', release)
              window.addEventListener('blur', release)
              return
            }
            const initial = values.x.target,
              start = event.clientX
            let moved = false
            active.current = true
            cancel.current = capturePointer(
              event.currentTarget,
              event.nativeEvent,
              (move) => {
                const dx = move.clientX - start
                if (!moved && Math.abs(dx) < 4) return
                moved = true
                const all = buttons(),
                  first = all[0]!.offsetLeft,
                  last = all.at(-1)!.offsetLeft,
                  raw = initial + dx
                const x = reducedMotion()
                  ? clamp(raw, first, last)
                  : raw < first
                    ? first - rubber(first - raw, 6, 40)
                    : raw > last
                      ? last + rubber(raw - last, 6, 40)
                      : raw
                values.x.snap(x)
                const nearest = all.reduce((a, b) =>
                  Math.abs(a.offsetLeft - x) < Math.abs(b.offsetLeft - x) ? a : b,
                )
                values.width.aim(nearest.offsetWidth, springs.select)
                wake()
              },
              (reason) => {
                active.current = false
                cancel.current = undefined
                values.press.aim(0, springs.thumb)
                if (moved) swallowDragClick()
                if (moved && reason === 'up') {
                  swallowDragClick()
                  const nearest = buttons().reduce((a, b) =>
                    Math.abs(a.offsetLeft - values.x.value) <
                    Math.abs(b.offsetLeft - values.x.value)
                      ? a
                      : b,
                  )
                  if (nearest.dataset.value !== latest.current.value) {
                    nearest.click()
                    nearest.focus({ preventScroll: true })
                  }
                  values.x.aim(nearest.offsetLeft, springs.select)
                  values.width.aim(nearest.offsetWidth, springs.select)
                } else target()
                wake()
              },
            )
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

/*
 * A settings slider after the Liquid Glass slider of iOS 26 and macOS 26
 * (docs/reports/2026-11-23-liquid-glass/slider-v2.md): a 6pt track filled with the accent up to a
 * solid thumb. Held, the thumb grows and clears into glass that bends the track at its rim; let
 * go, it springs back and frosts over. Grabbed on the thumb it does not jump; pressed elsewhere on
 * the track the thumb comes to the pointer. Dragged quickly it stretches along the drag.
 */
const thumb = { rest: [24, 20], held: [37, 33] } as const
const stretchPerSpeed = 0.002,
  stretchLimit = 0.2

export function Slider({
  label,
  value,
  min = 100,
  max = 400,
  disabled = false,
  valueText = (value) => `${value}%`,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  max?: number
  disabled?: boolean
  valueText?(value: number): string
  /** Every value the thumb passes while dragged or keyed. */
  onChange(value: number): void
  /** The value it was let go at, or keyed to. */
  onCommit?(value: number): void
}) {
  const host = useRef<HTMLDivElement>(null),
    glass = useGlass<HTMLSpanElement>('slider', true, true, {
      width: thumb.held[0],
      height: thumb.held[1],
      radius: thumb.held[1] / 2,
    })
  // The thumb's place along the track, 0–1, continuous while dragged; the value is its rounding.
  const position = useRef((value - min) / (max - min)),
    shown = useRef(value),
    emitted = useRef<number[]>([]),
    dragging = useRef(false),
    resting = useRef(0),
    cancel = useRef<(() => void) | undefined>(undefined)
  const latest = useRef({ onChange, onCommit, min, max }),
    [endRevision, setEndRevision] = useState(0)
  useLayoutEffect(() => {
    latest.current = { onChange, onCommit, min, max }
  })
  const { values, wake } = useSprings({ held: 0, clear: 0, stretch: 0, edge: 0 }, (s, reduced) => {
    const element = host.current,
      knob = glass.ref.current
    if (!element || !knob) return
    const held = s.held.value,
      clear = clamp(s.clear.value, 0, 1),
      stretch = reduced ? 1 : 1 + clamp(s.stretch.value, 0, stretchLimit)
    const w = (thumb.rest[0] + (thumb.held[0] - thumb.rest[0]) * held) * stretch,
      h = (thumb.rest[1] + (thumb.held[1] - thumb.rest[1]) * held) / stretch
    const centre = thumb.rest[0] / 2 + (element.clientWidth - thumb.rest[0]) * position.current
    element.style.setProperty('--fill', `${centre}px`)
    knob.style.width = `${w}px`
    knob.style.height = `${h}px`
    knob.style.borderRadius = `${h / 2}px`
    knob.style.left = `${centre + (reduced ? 0 : s.edge.value) - w / 2}px`
    knob.style.top = `${(element.clientHeight - h) / 2}px`
    knob.style.setProperty('--held', clamp(held, 0, 1).toFixed(3))
    glass.setStrength(clear)
  })
  const show = (next: number) => {
    shown.current = next
    host.current?.setAttribute('aria-valuenow', String(next))
    host.current?.setAttribute('aria-valuetext', valueText(next))
    host.current?.setAttribute('title', valueText(next))
  }
  // Moves the thumb to `next` (0–1) and reports the value it now shows, if that changed.
  const place = (next: number) => {
    const { min, max } = latest.current
    position.current = clamp(next, 0, 1)
    const rounded = Math.round(min + position.current * (max - min))
    if (rounded !== shown.current) {
      show(rounded)
      emitted.current.push(rounded)
      latest.current.onChange(rounded)
    }
    return rounded
  }
  useLayoutEffect(() => {
    if (dragging.current) return
    // A value it gave out coming back (saved, say, after a round trip) is not a new value: keys
    // pressed since have moved on, and it waits for the last of them.
    const echo = emitted.current.indexOf(value)
    emitted.current = echo < 0 ? [] : emitted.current.slice(echo + 1)
    if (emitted.current.length) return
    show(value)
    position.current = (value - min) / (max - min)
    wake()
  }, [value, min, max, endRevision])
  useLayoutEffect(() => {
    if (disabled) cancel.current?.()
    return () => cancel.current?.()
  }, [disabled])
  return (
    <div
      ref={host}
      className={styles.slider}
      role="slider"
      aria-label={label}
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown.current}
      aria-valuetext={valueText(shown.current)}
      // macOS shows a slider's value as a tooltip while the pointer rests on it; nothing printed.
      title={valueText(shown.current)}
      onKeyDown={(event) => {
        if (disabled) return
        const keys: Record<string, number> = {
          ArrowLeft: -5,
          ArrowDown: -5,
          ArrowRight: 5,
          ArrowUp: 5,
          PageDown: -25,
          PageUp: 25,
        }
        if (!(event.key in keys) && !['Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next =
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : shown.current +
                keys[event.key]! * (event.shiftKey && event.key.startsWith('Arrow') ? 5 : 1)
        const keyed = place((clamp(next, min, max) - min) / (max - min))
        latest.current.onCommit?.(keyed)
        wake()
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || !event.isPrimary) return
        event.preventDefault()
        // Focus for the keyboard, without the keyboard's ring: a press is not keyboard focus.
        event.currentTarget.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
        cancel.current?.()
        const bounds = event.currentTarget.getBoundingClientRect(),
          span = bounds.width - thumb.rest[0],
          centre = bounds.left + thumb.rest[0] / 2 + span * position.current
        const grab =
          Math.abs(event.clientX - centre) <= thumb.held[0] / 2 ? event.clientX - centre : 0
        dragging.current = true
        values.held.aim(1, springs.sliderPress)
        values.clear.aim(1, springs.sliderPress)
        let previous = event.clientX,
          time = event.timeStamp
        const update = (move: PointerEvent) => {
          const along = move.clientX - grab - bounds.left - thumb.rest[0] / 2
          place(along / span)
          // Pulled past an end, the thumb follows a little way and springs back when let go.
          values.edge.snap(
            along < 0 ? -rubber(-along, 6, 48) : along > span ? rubber(along - span, 6, 48) : 0,
          )
          const speed =
            (Math.abs(move.clientX - previous) * 1000) / Math.max(1, move.timeStamp - time)
          values.stretch.aim(Math.min(stretchLimit, speed * stretchPerSpeed), springs.sliderStretch)
          // A thumb that stops moving stops stretching.
          clearTimeout(resting.current)
          resting.current = window.setTimeout(() => {
            values.stretch.aim(0, springs.sliderRelease)
            wake()
          }, 60)
          previous = move.clientX
          time = move.timeStamp
          wake()
        }
        if (!grab) update(event.nativeEvent)
        cancel.current = capturePointer(event.currentTarget, event.nativeEvent, update, () => {
          dragging.current = false
          cancel.current = undefined
          clearTimeout(resting.current)
          swallowDragClick()
          values.held.aim(0, springs.sliderRelease)
          values.clear.aim(0, springs.sliderFrost)
          values.stretch.aim(0, springs.sliderRelease)
          values.edge.aim(0, springs.sliderRelease)
          latest.current.onCommit?.(shown.current)
          wake()
          // A value given while it was held is shown once it is let go.
          setEndRevision((revision) => revision + 1)
        })
        wake()
      }}
    >
      <span className={styles.sliderTrack} aria-hidden="true">
        <span />
      </span>
      <span ref={glass.ref} data-glass="slider" className={styles.sliderThumb} aria-hidden="true" />
    </div>
  )
}

export function SelectionPill({ selected, selector }: { selected: string; selector: string }) {
  const ref = useRef<HTMLSpanElement>(null),
    previous = useRef<Element | undefined>(undefined)
  const { values, wake } = useSprings({ x: 0, y: 0, width: 0, height: 32, opacity: 0 }, (s) => {
    if (!ref.current) return
    Object.assign(ref.current.style, {
      transform: `translate(${s.x.value}px,${s.y.value}px)`,
      width: `${s.width.value}px`,
      height: `${s.height.value}px`,
      opacity: String(clamp(s.opacity.value, 0, 1)),
    })
  })
  const measure = (resize = false) => {
    const item = ref.current?.parentElement?.querySelector<HTMLElement>(selector)
    if (!item) {
      values.opacity.aim(0)
      wake()
      return
    }
    const initial = !previous.current || resize,
      geometry = {
        x: item.offsetLeft,
        y: item.offsetTop,
        width: item.offsetWidth,
        height: item.offsetHeight,
        opacity: 1,
      }
    for (const [name, value] of Object.entries(geometry)) {
      const spring = values[name as keyof typeof values]
      if (initial) spring.snap(value)
      else spring.aim(value, springs.select)
    }
    previous.current = item
    wake()
  }
  useLayoutEffect(() => {
    measure()
  }, [selected])
  useLayoutEffect(() => {
    const host = ref.current?.parentElement
    if (!host) return
    const resize = new ResizeObserver(() => measure(true))
    resize.observe(host)
    const changes = new MutationObserver(() => measure())
    changes.observe(host, {
      attributes: true,
      subtree: true,
      attributeFilter: ['aria-current', 'aria-selected'],
      childList: true,
    })
    return () => {
      resize.disconnect()
      changes.disconnect()
    }
  }, [])
  return (
    <span
      ref={ref}
      className={styles.selection}
      aria-hidden="true"
      style={{ opacity: 0 } as CSSProperties}
    />
  )
}
