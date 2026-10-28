import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import type { CachedContent } from '../../shared/api'
import { unwrap } from '../queries/client'
import { internalImage, useMarkdown } from './markdown'
import { useSessionActive } from '../state/workspace'

let diagrams: Promise<(typeof import('mermaid'))['default']> | undefined
function mermaid() {
  diagrams ??= import('mermaid').then(({ default: engine }) => {
    engine.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
    })
    return engine
  })
  return diagrams
}

/** Markdown remains readable while its visible diagrams and authorized images load. */
export function Markdown({
  id,
  text,
  rendered,
  ...props
}: HTMLAttributes<HTMLDivElement> & { id: string; text: string; rendered?: string }) {
  const markdown = useMarkdown(text),
    html = rendered ?? markdown,
    root = useRef<HTMLDivElement>(null)
  const activeSession = useSessionActive()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    // Ordinary text/code/math need no observers, IPC subscriptions or DOM hydration.
    if (!root.current!.querySelector('[data-mermaid], [data-media-ref]')) return
    root.current!.innerHTML = html
    if (!activeSession) return
    let active = true
    const resources: CachedContent[] = []
    const release = (value: CachedContent) => {
      if (value.preview) void window.yuki.client.releasePreview(id, value.preview.id)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const node = entry.target as HTMLElement
          observer.unobserve(node)
          if (node.hasAttribute('data-mermaid')) {
            const source = node.textContent ?? ''
            void mermaid()
              .then((engine) => engine.render(`diagram-${crypto.randomUUID()}`, source))
              .then(({ svg }) => {
                if (!active) return
                const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
                // Local diagrams do not fetch images, open links, or install callbacks.
                parsed
                  .querySelectorAll('script, foreignObject, image')
                  .forEach((item) => item.remove())
                parsed.querySelectorAll('*').forEach((item) => {
                  for (const attribute of [...item.attributes])
                    if (
                      /^on/i.test(attribute.name) ||
                      /href$/i.test(attribute.name) ||
                      /url\(\s*['"]?(?!#)/i.test(attribute.value)
                    )
                      item.removeAttribute(attribute.name)
                })
                node.replaceChildren(document.importNode(parsed.documentElement, true))
              })
              .catch(() => {
                if (active) node.dataset.renderError = '無法繪製，以下保留原始碼。'
              })
          } else {
            const source = internalImage(node.dataset.mediaRef!)
            if (!source) continue
            void (
              'artifactId' in source
                ? window.yuki.client.artifactContent(id, source)
                : window.yuki.client.content(id, source)
            )
              .then(unwrap)
              .then((content) => {
                if (!active) return release(content)
                resources.push(content)
                if (!content.mime.startsWith('image/') || !content.preview) return
                const image = document.createElement('img')
                image.src = content.preview.url
                image.alt = node.getAttribute('aria-label') ?? content.filename
                image.loading = 'lazy'
                node.replaceChildren(image)
              })
              .catch(() => {
                if (active) node.append('（圖片無法讀取）')
              })
          }
        }
      },
      { rootMargin: '120px' },
    )
    root
      .current!.querySelectorAll('[data-mermaid], [data-media-ref]')
      .forEach((node) => observer.observe(node))
    const unsubscribe = window.yuki.client.onHint((owner, kind, data) => {
      if (owner !== id) return
      if (
        resources.length &&
        (kind === 'sync' ||
          kind === 'artifacts' ||
          (kind === 'connection' && (data as { code?: string }).code === 'unauthenticated'))
      ) {
        setRevision((value) => value + 1)
        return
      }
      if (kind !== 'media-expired') return
      const content = resources.find(
        (item) => item.preview?.id === (data as { previewId: string }).previewId,
      )
      if (content) setRevision((value) => value + 1)
    })
    return () => {
      active = false
      observer.disconnect()
      unsubscribe()
      resources.forEach(release)
    }
  }, [html, id, activeSession, revision])
  return <div {...props} ref={root} dangerouslySetInnerHTML={{ __html: html }} />
}
