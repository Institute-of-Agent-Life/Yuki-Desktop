import { useEffect, useRef, useState } from 'react'
import type { ArtifactSource, AttachmentSource, CachedContent } from '../../shared/api'
import { unwrap } from '../queries/client'
import { useSessionActive } from '../state/workspace'

export type MediaSource = ArtifactSource | AttachmentSource

/** The renderer owns a preview, rather than retaining a live resource in Query's cache. */
export function useMediaContent(id: string, source?: MediaSource, enabled = true) {
  const activeSession = useSessionActive()
  const key = JSON.stringify(source),
    // A reload replaces what shows; a check (after a sync) reads again and keeps what shows when
    // the content is the same, so the picture is not reloaded and nothing around it moves.
    [revision, setRevision] = useState(0),
    [check, setCheck] = useState(0),
    [result, setResult] = useState<{ data?: CachedContent; error?: Error; isPending: boolean }>({
      isPending: enabled && !!source,
    })
  const shown = useRef<{ identity: string; data: CachedContent } | undefined>(undefined)
  useEffect(() => {
    const release = (value: CachedContent) => {
      if (value.preview) void window.yuki.client.releasePreview(id, value.preview.id)
    }
    const identity = `${id}\n${key}\n${revision}`,
      live = enabled && !!source && activeSession,
      kept = live && shown.current?.identity === identity ? shown.current.data : undefined
    if (!kept && shown.current) {
      release(shown.current.data)
      shown.current = undefined
    }
    if (!live) {
      setResult({ isPending: false })
      return
    }
    let active = true
    if (!kept) setResult({ isPending: true })
    const request =
      'artifactId' in source
        ? window.yuki.client.artifactContent(id, source)
        : window.yuki.client.content(id, source)
    void request
      .then(unwrap)
      .then((data) => {
        if (!active || (kept && data.sha256 === kept.sha256)) return release(data)
        if (shown.current) release(shown.current.data)
        shown.current = { identity, data }
        setResult({ data, isPending: false })
      })
      .catch((error: Error) => {
        if (!active) return
        if (shown.current) release(shown.current.data)
        shown.current = undefined
        setResult({ error, isPending: false })
      })
    return () => {
      active = false
    }
    // Source is a value, not the caller's freshly constructed object.
  }, [id, key, enabled, revision, check, activeSession])
  useEffect(
    () => () => {
      if (shown.current?.data.preview)
        void window.yuki.client.releasePreview(id, shown.current.data.preview.id)
    },
    [id],
  )
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
      if (kind === 'sync' || kind === 'artifacts') setCheck((value) => value + 1)
    })
  }, [id, key, enabled, activeSession, result.data?.preview?.id])
  return { ...result, refetch: () => setRevision((value) => value + 1) }
}
