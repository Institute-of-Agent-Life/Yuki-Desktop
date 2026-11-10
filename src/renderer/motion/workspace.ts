import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { reducedMotion } from './hooks'

interface Layout {
  active: boolean
  view: string
  width: number
  focus: boolean
  left: number
  right: number
  sidebarOpen: boolean
  sidebarOverlay: boolean
  inspectorOpen: boolean
  detailPage: boolean
}

type Motion = Partial<Record<'tracks' | 'sidebar' | 'detail', Animation>>
const px = (value: number) => `${value}px`
const slide = (open: boolean, offset: number) => ({
  translate: px(open ? 0 : offset),
  opacity: open ? '1' : '0',
})

function presented(
  element: HTMLElement,
  motion: Animation | undefined,
  open: boolean,
  offset: number,
) {
  if (!motion) return slide(open, offset)
  const { translate, opacity } = getComputedStyle(element)
  return { translate, opacity }
}

export function useWorkspaceMotion(
  shell: RefObject<HTMLElement | null>,
  sidebar: RefObject<HTMLElement | null>,
  inspector: RefObject<HTMLElement | null>,
  layout: Layout,
) {
  const previous = useRef(layout)
  const running = useRef<Motion | null>(null)
  const [keepInspector, setKeepInspector] = useState(layout.inspectorOpen)

  const clear = (root: HTMLElement) => {
    const motion = running.current
    running.current = null
    for (const animation of Object.values(motion ?? {})) animation.cancel()
    root.style.removeProperty('--workspace-left-reveal')
    root.style.removeProperty('--workspace-right-reveal')
    delete root.dataset.sidebarMoving
    delete root.dataset.detailMoving
  }

  useLayoutEffect(() => {
    const root = shell.current!
    const before = previous.current
    previous.current = layout
    const toggled =
      before.sidebarOpen !== layout.sidebarOpen || before.inspectorOpen !== layout.inspectorOpen
    const resized = before.left !== layout.left || before.right !== layout.right
    if (
      !before.active ||
      !layout.active ||
      before.width !== layout.width ||
      before.view !== layout.view ||
      before.focus !== layout.focus ||
      reducedMotion() ||
      (resized && !toggled)
    ) {
      clear(root)
      setKeepInspector(layout.inspectorOpen)
      return
    }
    if (!toggled) return

    const current = running.current
    const style = getComputedStyle(root)
    const left = current?.tracks
      ? parseFloat(style.getPropertyValue('--workspace-left'))
      : before.left
    const right = current?.tracks
      ? parseFloat(style.getPropertyValue('--workspace-right'))
      : before.right
    const leftReveal = parseFloat(root.style.getPropertyValue('--workspace-left-reveal')) || 0
    const rightReveal = parseFloat(root.style.getPropertyValue('--workspace-right-reveal')) || 0
    const side = sidebar.current
    const pane = inspector.current
    const slideSidebar =
      layout.sidebarOverlay && (before.sidebarOpen !== layout.sidebarOpen || current?.sidebar)
    const slideDetail =
      layout.detailPage && (before.inspectorOpen !== layout.inspectorOpen || current?.detail)
    const sideFrom =
      slideSidebar && side && presented(side, current?.sidebar, before.sidebarOpen, -20)
    const detailFrom =
      slideDetail && pane && presented(pane, current?.detail, before.inspectorOpen, 24)
    clear(root)

    const opening =
      (!before.sidebarOpen && layout.sidebarOpen) || (!before.inspectorOpen && layout.inspectorOpen)
    const timing: KeyframeAnimationOptions = {
      duration: opening ? 250 : 205,
      easing: 'cubic-bezier(.31, .13, .24, 1)',
      fill: 'both',
    }
    const motion: Motion = {}
    if (Math.abs(left - layout.left) > 0.1 || Math.abs(right - layout.right) > 0.1) {
      // Keep the entering or leaving pane's text at its open width while its edge moves.
      if (before.left === 0 || layout.left === 0 || leftReveal > 0) {
        const reveal = Math.max(before.left, layout.left, leftReveal)
        if (reveal > 0) {
          root.style.setProperty('--workspace-left-reveal', px(reveal))
          root.dataset.sidebarMoving = ''
        }
      }
      if (before.right === 0 || layout.right === 0 || rightReveal > 0)
        root.style.setProperty(
          '--workspace-right-reveal',
          px(Math.max(before.right, layout.right, rightReveal)),
        )
      motion.tracks = root.animate(
        [
          { '--workspace-left': px(left), '--workspace-right': px(right) },
          { '--workspace-left': px(layout.left), '--workspace-right': px(layout.right) },
        ],
        timing,
      )
    }
    if (side && sideFrom) {
      root.dataset.sidebarMoving = ''
      motion.sidebar = side.animate([sideFrom, slide(layout.sidebarOpen, -20)], timing)
    }
    if (pane && detailFrom) {
      root.dataset.detailMoving = ''
      motion.detail = pane.animate([detailFrom, slide(layout.inspectorOpen, 24)], timing)
    }
    const animations = Object.values(motion)
    if (!animations.length) {
      setKeepInspector(layout.inspectorOpen)
      return
    }
    running.current = motion
    setKeepInspector(
      layout.inspectorOpen || (keepInspector && Boolean(motion.tracks || motion.detail)),
    )
    void Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (running.current !== motion) return
        clear(root)
        setKeepInspector(layout.inspectorOpen)
      },
      () => {},
    )
  })

  useLayoutEffect(() => {
    const root = shell.current!
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const settle = () => {
      if (!running.current || !reducedMotion()) return
      clear(root)
      setKeepInspector(previous.current.inspectorOpen)
    }
    const preference = new MutationObserver(settle)
    preference.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-motion'],
    })
    media.addEventListener('change', settle)
    return () => {
      preference.disconnect()
      media.removeEventListener('change', settle)
      clear(root)
    }
  }, [shell])

  return layout.inspectorOpen || keepInspector
}
