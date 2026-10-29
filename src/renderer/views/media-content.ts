import { useEffect, useState } from 'react'
import type { ArtifactSource, AttachmentSource, CachedContent } from '../../shared/api'
import { unwrap } from '../queries/client'
import { useSessionActive } from '../state/workspace'

export type MediaSource = ArtifactSource | AttachmentSource

/** The renderer owns a preview, rather than retaining a live resource in Query's cache. */
export function useMediaContent(id: string, source?: MediaSource, enabled = true) {
  const activeSession = useSessionActive()
  const key = JSON.stringify(source),
    [revision, setRevision] = useState(0),
    [result, setResult] = useState<{ data?: CachedContent; error?: Error; isPending: boolean }>({
      isPending: enabled && !!source,
    })
  useEffect(() => {
    if (!enabled || !source || !activeSession) {
      setResult({ isPending: false })
      return
    }
    let active = true,
      content: CachedContent | undefined
    const release = (value?: CachedContent) => {
      if (value?.preview) void window.yuki.client.releasePreview(id, value.preview.id)
    }
    setResult({ isPending: true })
    const request =
      'artifactId' in source
        ? window.yuki.client.artifactContent(id, source)
        : window.yuki.client.content(id, source)
    void request
      .then(unwrap)
      .then((data) => {
        if (!active) return release(data)
        content = data
        setResult({ data, isPending: false })
      })
      .catch((error: Error) => {
        if (active) setResult({ error, isPending: false })
      })
    return () => {
      active = false
      release(content)
    }
    // Source is a value, not the caller's freshly constructed object.
  }, [id, key, enabled, revision, activeSession])
  useEffect(() => {
    if (!enabled || !source || !activeSession) return
    return window.yuki.client.onHint((character, kind, data) => {
      if (character !== id) return
      if (kind === 'media-expired') {
        const { previewId } = data as { previewId: string }
        if (result.data?.preview?.id === previewId) setRevision((revision) => revision + 1)
      }
      if (kind === 'connection' && (data as { code?: string }).code === 'unauthenticated')
        setResult({ error: new Error('連接已失效，請重新配對。'), isPending: false })
      if (kind === 'sync' || kind === 'artifacts') setRevision((value) => value + 1)
    })
  }, [id, key, enabled, activeSession, result.data?.preview?.id])
  return { ...result, refetch: () => setRevision((value) => value + 1) }
}
