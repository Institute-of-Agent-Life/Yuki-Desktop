import { useCallback } from 'react'

/** Keep the last message above the real footer, including attachments and work replies. */
export function useFloatingInsets() {
  return useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    let previousFooter = -1,
      previousNotices = -1
    const observed = new Set<Element>()
    const measure = () => {
      const footer = node.querySelector<HTMLElement>(
        ':scope > [data-work-reply], :scope > [data-region="composer"], :scope > [data-floating-footer]',
      )
      const notices = node.querySelector<HTMLElement>('[data-floating-notices]')
      const height = footer?.getBoundingClientRect().height ?? 0,
        top = notices?.getBoundingClientRect().height ?? 0
      const log = node.querySelector<HTMLElement>('[role="log"]')
      const atBottom = log && log.scrollHeight - log.scrollTop - log.clientHeight < 64
      if (height !== previousFooter || top !== previousNotices) {
        node.style.setProperty('--composer-h', `${height}px`)
        node.style.setProperty('--notice-h', `${top}px`)
        previousFooter = height
        previousNotices = top
        if (atBottom && log) log.scrollTop = log.scrollHeight
      }
      const current = new Set<Element>([...(footer ? [footer] : []), ...(notices ? [notices] : [])])
      for (const old of observed)
        if (!current.has(old)) {
          resize.unobserve(old)
          observed.delete(old)
        }
      for (const element of current)
        if (!observed.has(element)) {
          resize.observe(element)
          observed.add(element)
        }
    }
    const resize = new ResizeObserver(measure),
      mutation = new MutationObserver(measure)
    mutation.observe(node, { childList: true, subtree: true })
    measure()
    return () => {
      resize.disconnect()
      mutation.disconnect()
    }
  }, [])
}
