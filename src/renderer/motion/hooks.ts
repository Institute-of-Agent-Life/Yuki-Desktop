import { useLayoutEffect, useRef, useState } from 'react'
import { Spring, springs } from './spring'

export const reducedMotion = () =>
  document.documentElement.dataset.motion === 'reduced' ||
  matchMedia('(prefers-reduced-motion: reduce)').matches
export function useSprings<K extends string>(
  initial: Record<K, number>,
  paint: (values: Record<K, Spring>, reduced: boolean) => void,
) {
  const painter = useRef(paint)
  const [values] = useState(
    () =>
      Object.fromEntries(
        Object.entries(initial).map(([key, value]) => [key, new Spring(value as number)]),
      ) as Record<K, Spring>,
  )
  const frame = useRef(0),
    time = useRef(0),
    live = useRef(false)
  useLayoutEffect(() => {
    painter.current = paint
  })
  const wake = () => {
    if (!live.current || frame.current) return
    time.current = performance.now()
    const tick = (now: number) => {
      frame.current = 0
      const reduced = reducedMotion(),
        dt = (now - time.current) / 1000
      time.current = now
      for (const spring of Object.values<Spring>(values)) {
        if (reduced) spring.snap()
        else spring.step(dt)
      }
      painter.current(values, reduced)
      if (Object.values<Spring>(values).some((spring) => !spring.settled))
        frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }
  useLayoutEffect(() => {
    live.current = true
    const changes = new MutationObserver(wake),
      media = matchMedia('(prefers-reduced-motion: reduce)')
    changes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    })
    media.addEventListener('change', wake)
    return () => {
      live.current = false
      cancelAnimationFrame(frame.current)
      frame.current = 0
      changes.disconnect()
      media.removeEventListener('change', wake)
    }
    // Each controller and its springs retain identity through React renders.
  }, [])
  return { values, wake }
}

export type DragEnd = 'up' | 'cancel'
export function capturePointer(
  element: HTMLElement,
  event: PointerEvent,
  move: (event: PointerEvent) => void,
  end: (reason: DragEnd) => void,
) {
  const id = event.pointerId
  let finished = false
  const finish = (reason: DragEnd) => {
    if (finished) return
    finished = true
    window.removeEventListener('pointermove', moving)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('blur', blur)
    element.removeEventListener('lostpointercapture', blur)
    if (element.hasPointerCapture(id)) element.releasePointerCapture(id)
    delete document.documentElement.dataset.controlDrag
    end(reason)
  }
  const moving = (e: PointerEvent) => {
    if (e.pointerId === id) {
      if (e.buttons === 0) finish('cancel')
      else move(e)
    }
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId === id) finish('up')
  }
  const cancel = (e: PointerEvent) => {
    if (e.pointerId === id) finish('cancel')
  }
  const blur = () => finish('cancel')
  element.setPointerCapture(id)
  document.documentElement.dataset.controlDrag = ''
  window.addEventListener('pointermove', moving)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('blur', blur)
  element.addEventListener('lostpointercapture', blur)
  return blur
}

/** Suppress only the native click immediately following a completed drag. */
export function swallowDragClick() {
  const remove = () => {
    window.removeEventListener('click', click, true)
    window.removeEventListener('pointerdown', remove, true)
    clearTimeout(timer)
  }
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || event.detail === 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    remove()
  }
  const timer = setTimeout(remove, 100)
  window.addEventListener('click', click, true)
  window.addEventListener('pointerdown', remove, true)
}

export function usePress<T extends HTMLElement>(role: 'command' | 'compact' = 'command') {
  const ref = useRef<T>(null),
    held = useRef(false)
  const { values, wake } = useSprings({ scale: 1, light: 0, x: 0, y: 0 }, (s, reduced) => {
    const node = ref.current
    if (!node) return
    const rest = Object.values(s).every((value) => value.settled) && !held.current
    // A held button bulges and is drawn toward the pointer, stretching along the pull.
    const x = s.x.value,
      y = s.y.value,
      along = Math.abs(x) / (Math.abs(x) + Math.abs(y) || 1),
      stretch = Math.min(0.04, Math.hypot(x, y) * 0.012),
      scale = s.scale.value
    node.style.scale =
      rest || reduced
        ? ''
        : `${scale * (1 + stretch * along - stretch * 0.5 * (1 - along))} ${scale * (1 + stretch * (1 - along) - stretch * 0.5 * along)}`
    node.style.translate = rest || reduced ? '' : `${x}px ${y}px`
    node.style.setProperty('--hp', rest ? '0' : String(Math.max(0, s.light.value)))
  })
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    let press: AbortController | undefined
    const disabled = () => node.matches(':disabled,[aria-disabled="true"],[aria-busy="true"]')
    const end = () => {
      if (!held.current) return
      press?.abort()
      press = undefined
      attributes.disconnect()
      held.current = false
      node.removeAttribute('data-held')
      values.scale.aim(1, springs.pressUp)
      values.x.aim(0, springs.pressUp)
      values.y.aim(0, springs.pressUp)
      values.light.aim(0, springs.highlight)
      wake()
    }
    const attributes = new MutationObserver(() => {
      if (disabled()) end()
    })
    const start = (x: number, y: number, touch = false) => {
      press?.abort()
      press = new AbortController()
      const options = { signal: press.signal }
      window.addEventListener('blur', end, options)
      document.addEventListener('visibilitychange', end, options)
      attributes.observe(node, {
        attributes: true,
        attributeFilter: ['disabled', 'aria-disabled', 'aria-busy'],
      })
      held.current = true
      node.dataset.held = 'true'
      node.style.setProperty('--hx', `${x}%`)
      node.style.setProperty('--hy', `${y}%`)
      const target = role === 'compact' ? (touch ? 1.1 : 1.08) : touch ? 1.05 : 1.03
      values.scale.aim(reducedMotion() ? 1 : target, springs.pressDown)
      values.light.aim(1, springs.highlight)
      wake()
      return options
    }
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || disabled()) return
      const rect = node.getBoundingClientRect()
      const options = start(
        ((event.clientX - rect.left) / rect.width) * 100,
        ((event.clientY - rect.top) / rect.height) * 100,
        event.pointerType === 'touch',
      )
      const finish = (pointer: PointerEvent) => {
        if (pointer.pointerId === event.pointerId) end()
      }
      window.addEventListener(
        'pointermove',
        (pointer) => {
          if (
            pointer.buttons === 0 ||
            pointer.clientX < rect.left ||
            pointer.clientX > rect.right ||
            pointer.clientY < rect.top ||
            pointer.clientY > rect.bottom
          )
            return finish(pointer)
          if (reducedMotion()) return
          values.x.aim(
            (3 * (pointer.clientX - rect.left - rect.width / 2)) / (rect.width / 2),
            springs.thumb,
          )
          values.y.aim(
            (2 * (pointer.clientY - rect.top - rect.height / 2)) / (rect.height / 2),
            springs.thumb,
          )
          wake()
        },
        options,
      )
      window.addEventListener('pointerup', finish, options)
      window.addEventListener('pointercancel', finish, options)
      window.addEventListener('scroll', end, { ...options, capture: true })
    }
    const key = (event: KeyboardEvent) => {
      if (!['Enter', ' '].includes(event.key) || event.isComposing || disabled()) return
      if (event.repeat) event.preventDefault()
      else start(50, 50)
    }
    node.addEventListener('pointerdown', down)
    node.addEventListener('keydown', key)
    node.addEventListener('keyup', end)
    node.addEventListener('blur', end)
    return () => {
      end()
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('keydown', key)
      node.removeEventListener('keyup', end)
      node.removeEventListener('blur', end)
    }
  }, [role])
  return ref
}
