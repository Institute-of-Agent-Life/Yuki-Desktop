import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './EdgeFade.module.css'

/**
 * Whether content has scrolled under the top edge of the element the returned ref is put on:
 * the last scrolling area that starts at that edge and has left its start. A page swapped in
 * takes the old one's area away, so after every render it is measured again.
 */
export function useScrolledUnder<T extends HTMLElement>() {
  const edge = useRef<T>(null)
  const area = useRef<HTMLElement | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const measure = useCallback(() => {
    const element = area.current
    setScrolled(!!element && element.isConnected && element.scrollTop > 0)
  }, [])
  useEffect(measure)
  useEffect(() => {
    const root = edge.current!
    const scroll = (event: Event) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.getBoundingClientRect().top <= root.getBoundingClientRect().top + 1
      )
        area.current = target
      measure()
    }
    root.addEventListener('scroll', scroll, { capture: true, passive: true })
    return () => root.removeEventListener('scroll', scroll, { capture: true })
  }, [measure])
  return [edge, scrolled] as const
}

// The top edge's two layers, shown while content lies under it.
export function EdgeFade({ shown }: { shown: boolean }) {
  return (
    <>
      <div
        className={`${styles.frost} ${shown ? styles.shown : ''}`}
        data-edge-fade="upper"
        aria-hidden="true"
      />
      <div
        className={`${styles.wash} ${shown ? styles.shown : ''}`}
        data-edge-fade="lower"
        aria-hidden="true"
      />
    </>
  )
}
