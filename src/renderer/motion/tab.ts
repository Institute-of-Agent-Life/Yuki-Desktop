import { useLayoutEffect, useRef } from 'react'
import { reducedMotion } from './hooks'

/** Animate only a genuine tab change, never query refreshes or keystrokes. */
export function useTabMotion<T extends HTMLElement>(value: string, order: readonly string[]) {
  const ref = useRef<T>(null),
    previous = useRef(value)
  useLayoutEffect(() => {
    const old = previous.current
    previous.current = value
    if (old === value || !ref.current || reducedMotion()) return
    const direction = order.indexOf(value) >= order.indexOf(old) ? 1 : -1
    const animation = ref.current.animate(
      [
        { opacity: 0, transform: `translateX(${direction * 10}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 200, easing: 'cubic-bezier(.2,0,0,1)' },
    )
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => {
      if (reducedMotion()) animation.cancel()
    }
    const observer = new MutationObserver(changed)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    })
    media.addEventListener('change', changed)
    return () => {
      animation.cancel()
      observer.disconnect()
      media.removeEventListener('change', changed)
    }
  }, [value])
  return ref
}
