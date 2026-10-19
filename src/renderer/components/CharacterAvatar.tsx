import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Profile } from '../../shared/api'
import { Avatar } from './Controls'
import { hidesPrivateData, unwrap } from '../queries/client'

export const CharacterVisuals = createContext<{
  id: string
  name: string
  profile?: Profile
  presence?: { color: 'running' | 'waiting' | 'done' | 'offline'; text: string }
}>({
  id: '',
  name: '',
})
export function usePixelRatio() {
  const [ratio, setRatio] = useState(window.devicePixelRatio)
  useEffect(() => {
    const media = window.matchMedia(`(resolution: ${ratio}dppx)`)
    const changed = () => setRatio(window.devicePixelRatio)
    media.addEventListener('change', changed)
    window.addEventListener('resize', changed)
    return () => {
      media.removeEventListener('change', changed)
      window.removeEventListener('resize', changed)
    }
  }, [ratio])
  return ratio
}
export function useImageUrl(bytes?: Uint8Array | null, enabled = true, scope = '') {
  const current = useRef<{ url: string; scope: string } | undefined>(undefined)
  const [image, setImage] = useState<{ url: string; scope: string }>()
  useEffect(() => {
    if (!enabled || (current.current && current.current.scope !== scope)) {
      if (current.current) URL.revokeObjectURL(current.current.url)
      current.current = undefined
      setImage(undefined)
    }
    if (!enabled || !bytes) return
    const value = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'image/png' }))
    const previous = current.current
    current.current = { url: value, scope }
    setImage(current.current)
    if (previous) URL.revokeObjectURL(previous.url)
  }, [bytes, enabled, scope])
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current.url)
    },
    [],
  )
  return enabled && image?.scope === scope ? image.url : undefined
}
export function avatarSize(size: number, ratio = window.devicePixelRatio) {
  return [64, 128, 256, 512].find((value) => value >= size * ratio) ?? 512
}
export function CharacterAvatar({
  size = 36,
  avatar,
  name,
}: {
  size?: number
  avatar?: { sha256: string } | null
  name?: string
}) {
  const context = useContext(CharacterVisuals)
  const ratio = usePixelRatio()
  const photo = avatar === undefined ? context.profile?.avatar : avatar
  const pixels = avatarSize(size, ratio)
  const result = useQuery({
    queryKey: [context.id, 'avatar', photo?.sha256, pixels],
    queryFn: () => window.yuki.client.avatarBytes(context.id, photo!.sha256, pixels).then(unwrap),
    enabled: !!context.id && !!photo,
  })
  const allowed = !!photo && !hidesPrivateData(result.error)
  const url = useImageUrl(
    result.data,
    allowed,
    avatar === undefined ? context.id : `${context.id}/${photo?.sha256 ?? 'none'}`,
  )
  return (
    <Avatar
      name={name ?? context.name}
      size={size}
      src={url}
      loading={allowed && result.isPending}
    />
  )
}
export function PairingAvatar({
  server,
  name,
  size,
  avatarUrl,
}: {
  server: string
  name: string
  size: number
  avatarUrl: string | null
}) {
  const result = useQuery({
    queryKey: ['pairing-avatar', server, avatarUrl],
    queryFn: () => window.yuki.client.previewAvatar(server).then(unwrap),
    enabled: !!avatarUrl,
  })
  const url = useImageUrl(result.data, !!avatarUrl && !result.error, `${server}/${avatarUrl}`)
  return <Avatar name={name} size={size} src={url} loading={!!avatarUrl && result.isPending} />
}
