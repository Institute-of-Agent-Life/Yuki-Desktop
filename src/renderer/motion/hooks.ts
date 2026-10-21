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

export function usePress<T extends HTMLElement>() {
  const ref = useRef<T>(null),
    held = useRef(false)
  const { values, wake } = useSprings(
    { scale: 1, x: 0, y: 0, stretchX: 0, stretchY: 0, light: 0 },
    (s, reduced) => {
      const node = ref.current
      if (!node) return
      const rest = Object.values(s).every((value) => value.settled) && !held.current
      node.style.transform =
        rest || reduced
          ? ''
          : `translate(${s.x.value}px,${s.y.value}px) scale(${s.scale.value + s.stretchX.value},${s.scale.value + s.stretchY.value})`
      node.style.setProperty('--hp', rest ? '0' : String(Math.max(0, s.light.value)))
    },
  )
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    let rect: DOMRect | undefined,
      x = 0,
      y = 0,
      timer: ReturnType<typeof setTimeout> | undefined
    const disabled = () => node.matches(':disabled,[aria-disabled="true"],[aria-busy="true"]')
    const end = () => {
      held.current = false
      node.removeAttribute('data-held')
      values.scale.aim(1, springs.pressUp)
      values.x.aim(0, springs.settle)
      values.y.aim(0, springs.settle)
      values.stretchX.aim(0, springs.settle)
      values.stretchY.aim(0, springs.settle)
      values.light.aim(0, springs.highlight)
      wake()
    }
    const scale = () =>
      reducedMotion()
        ? 1
        : node.offsetWidth <= 34 && node.offsetHeight <= 34
          ? 0.9
          : node.offsetWidth >= 120
            ? 0.975
            : 0.955
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || disabled()) return
      clearTimeout(timer)
      rect = node.getBoundingClientRect()
      x = event.clientX
      y = event.clientY
      held.current = true
      node.dataset.held = 'true'
      values.scale.aim(scale(), springs.pressDown)
      values.light.aim(1, springs.highlight)
      move(event)
      wake()
    }
    const move = (event: PointerEvent) => {
      if (!held.current || !rect || !event.isPrimary) return
      if (event.buttons === 0 || disabled()) {
        end()
        return
      }
      const out =
        event.clientX < rect.left - 12 ||
        event.clientX > rect.right + 12 ||
        event.clientY < rect.top - 12 ||
        event.clientY > rect.bottom + 12
      values.light.aim(out ? 0 : 1, springs.highlight)
      node.dataset.held = String(!out)
      values.scale.aim(out ? 1 : scale(), out ? springs.pressUp : springs.pressDown)
      if (!reducedMotion()) {
        const dx = event.clientX - x,
          dy = event.clientY - y
        values.x.aim(out ? 0 : 1.5 * Math.tanh(dx / 30), springs.settle)
        values.y.aim(out ? 0 : 1.5 * Math.tanh(dy / 30), springs.settle)
        values.stretchX.aim(
          out ? 0 : Math.min(2, Math.abs(dx) / 60) / node.offsetWidth,
          springs.settle,
        )
        values.stretchY.aim(
          out ? 0 : Math.min(2, Math.abs(dy) / 60) / node.offsetHeight,
          springs.settle,
        )
      }
      node.style.setProperty('--hx', `${((event.clientX - rect.left) / rect.width) * 100}%`)
      node.style.setProperty('--hy', `${((event.clientY - rect.top) / rect.height) * 100}%`)
      wake()
    }
    const key = (event: KeyboardEvent) => {
      if (!['Enter', ' '].includes(event.key) || event.repeat || disabled()) return
      held.current = true
      node.dataset.held = 'true'
      values.scale.aim(scale(), springs.pressDown)
      values.light.aim(1, springs.highlight)
      wake()
      clearTimeout(timer)
      timer = setTimeout(end, 90)
    }
    const attributes = new MutationObserver(() => {
      if (disabled()) end()
    })
    attributes.observe(node, {
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'aria-busy'],
    })
    node.addEventListener('pointerdown', down)
    node.addEventListener('keydown', key)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
    return () => {
      clearTimeout(timer)
      attributes.disconnect()
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('keydown', key)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
    }
  }, [])
  return ref
}
