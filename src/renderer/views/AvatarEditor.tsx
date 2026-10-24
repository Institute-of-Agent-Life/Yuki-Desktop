import { capturePointer } from '../motion/hooks'
import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, RotateCcw } from 'lucide-react'
import type {
  AvatarCommandItem,
  AvatarInput,
  CharacterCommandItem,
  Profile,
} from '../../shared/api'
import { formatBytes } from '../../shared/media'
import { Avatar, Banner, Button, Slider, Sheet, Spinner } from '../components/Controls'
import { CharacterAvatar, CharacterVisuals, usePixelRatio } from '../components/CharacterAvatar'
import { PresenceCard } from '../components/PresenceCard'
import {
  croppedAvatar,
  cropCanvas,
  cropPosition,
  decodeAvatar,
  type AvatarImage,
  type Pan,
} from '../images/avatar'
import { ClientProblem, problemText, unwrap } from '../queries/client'
import styles from './AvatarEditor.module.css'

function avatarItem(item: CharacterCommandItem): AvatarCommandItem {
  if (item.command.kind !== 'avatar') throw new Error('原請求不是頭像更新。')
  return {
    requestId: item.requestId,
    action: item.command.action,
    expectedRevision: item.command.expectedRevision,
    state: item.state,
    problem: item.problem,
    current: (item.details?.current as Profile | undefined) ?? null,
  }
}

export function AvatarPending({
  id,
  owner,
  open,
}: {
  id: string
  owner: boolean
  open: (item: AvatarCommandItem) => void
}) {
  const query = useQueryClient()
  const commands = useQuery({
    queryKey: [id, 'character-commands'],
    queryFn: () => window.yuki.client.characterCommands(id).then(unwrap),
  })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <>
      {commands.data
        ?.filter((item) => item.command.kind === 'avatar' && item.state === 'submitted')
        .map((item) => (
          <div className={styles.pending} key={item.requestId} role="status">
            <span>頭像更新：結果尚未確認</span>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const result = unwrap(
                    await window.yuki.client.verifyCharacterCommand(id, item.requestId),
                  )
                  setError(result.problem ? problemText(result.problem) : '')
                  await query.invalidateQueries({ queryKey: [id, 'character-commands'] })
                  await query.invalidateQueries({ queryKey: [id, 'character'] })
                } catch (error) {
                  setError(error instanceof Error ? error.message : '無法查證原請求。')
                } finally {
                  setBusy(false)
                }
              }}
            >
              查證頭像更新
            </Button>
            {owner && (
              <Button disabled={busy} onClick={() => open(avatarItem(item))}>
                查看這次更新
              </Button>
            )}
          </div>
        ))}
      {error && <Banner status="failed">{error}</Banner>}
    </>
  )
}

export function AvatarEditor({
  id,
  profile,
  close,
  restore,
}: {
  id: string
  profile: Profile
  close: () => void
  restore?: AvatarCommandItem
}) {
  const query = useQueryClient()
  const visuals = useContext(CharacterVisuals)
  const pixels = Math.round(280 * usePixelRatio())
  const [image, setImage] = useState<AvatarImage>()
  const imageRef = useRef<AvatarImage | undefined>(undefined)
  const opener = useRef(document.activeElement)
  const submitting = useRef(false)
  const generation = useRef(0)
  const [transform, setTransform] = useState<{ zoom: number; pan: Pan }>({
    zoom: 1,
    pan: { x: 0, y: 0 },
  })
  const [preview, setPreview] = useState<string>()
  const [baseline, setBaseline] = useState(restore?.expectedRevision ?? profile.avatar_revision)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(restore?.problem ? problemText(restore.problem) : '')
  const [fromCurrent, setFromCurrent] = useState(false)
  const [conflict, setConflict] = useState<{
    current: Profile
    action: 'set' | 'reset'
  }>()
  const [unknown, setUnknown] = useState<AvatarCommandItem | undefined>(
    restore?.state === 'submitted' ? restore : undefined,
  )
  const crop = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const cancelDrag = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    if (busy || unknown) cancelDrag.current?.()
    return () => cancelDrag.current?.()
  }, [busy, unknown])
  const load = useCallback(async (input: Promise<AvatarInput | null>, current = false) => {
    const turn = ++generation.current
    setBusy(true)
    setError('')
    let decoded: AvatarImage | undefined
    try {
      const source = await input
      if (!source) return false
      decoded = await decodeAvatar(source)
      if (turn !== generation.current) {
        decoded.bitmap.close()
        return false
      }
      imageRef.current?.bitmap.close()
      imageRef.current = decoded
      setImage(decoded)
      setFromCurrent(current)
      setTransform({ zoom: 1, pan: { x: 0, y: 0 } })
      setConflict(undefined)
      return true
    } catch (error) {
      if (turn === generation.current)
        setError(
          error instanceof ClientProblem
            ? error.message
            : '無法讀取這張圖片，請改用 PNG、JPEG 或 WebP。',
        )
      return false
    } finally {
      if (turn === generation.current) setBusy(false)
    }
  }, [])
  useEffect(() => {
    if (restore?.action === 'set')
      void load(window.yuki.client.avatarDraft(id, restore.requestId).then(unwrap), true)
    else if (!restore && profile.avatar)
      void load(
        window.yuki.client
          .avatarBytes(id, profile.avatar.sha256, 1024)
          .then(unwrap)
          .then((bytes) => ({ filename: '目前頭像.png', bytes })),
        true,
      )
    return () => {
      generation.current++
      imageRef.current?.bitmap.close()
      imageRef.current = undefined
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
    // An open editor retains the avatar revision it began with.
  }, [id, load, restore?.requestId])
  useEffect(() => {
    if (!profile.viewer.is_owner) close()
  }, [profile.viewer.is_owner, close])
  useEffect(() => {
    if (!image) return
    const output = cropCanvas(image, transform.zoom, transform.pan, pixels)
    canvas.current?.getContext('2d', { colorSpace: 'srgb' })?.drawImage(output, 0, 0)
    setPreview(cropCanvas(image, transform.zoom, transform.pan, 128).toDataURL('image/png'))
  }, [image, transform, pixels])
  const zoom = useCallback((value: number) => {
    setTransform((previous) => {
      const current = imageRef.current
      const next = Math.max(1, Math.min(4, value))
      if (!current) return previous
      const position = cropPosition(current.bitmap.width, current.bitmap.height, next, previous.pan)
      return { zoom: next, pan: { x: position.x, y: position.y } }
    })
  }, [])
  useEffect(() => {
    const area = crop.current
    if (!area || !image || busy || unknown) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      zoom(transform.zoom * Math.exp(-event.deltaY / 800))
    }
    area.addEventListener('wheel', wheel, { passive: false })
    return () => area.removeEventListener('wheel', wheel)
  }, [image, transform.zoom, zoom, busy, unknown])
  const move = (pan: Pan) => {
    if (!image || busy || unknown) return
    const position = cropPosition(image.bitmap.width, image.bitmap.height, transform.zoom, pan)
    setTransform((previous) => ({ ...previous, pan: { x: position.x, y: position.y } }))
  }
  const refreshed = async (item: AvatarCommandItem, session: number) => {
    await query.invalidateQueries({ queryKey: [id, 'character-commands'] })
    await query.invalidateQueries({ queryKey: [id, 'character'] })
    if (session !== generation.current) return
    if (item.state === 'submitted') {
      setUnknown(item)
      setError('更新結果尚未確認，裁切已保留。請查證原請求。')
      return
    }
    setUnknown(undefined)
    if (item.problem === 'version_conflict') {
      const current =
        item.current ?? unwrap(await window.yuki.client.read<Profile>(id, { kind: 'character' }))
      setConflict({ current, action: item.action })
      setError('頭像剛被另一台裝置更新。')
    } else if (item.problem) setError(problemText(item.problem))
    else {
      close()
    }
  }
  const save = async (action: 'set' | 'reset', revision = baseline) => {
    const session = generation.current
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const bytes =
        action === 'set' && image
          ? await croppedAvatar(image, transform.zoom, transform.pan)
          : undefined
      if (action === 'set' && !bytes) return
      const item = unwrap(await window.yuki.client.avatarCommand(id, revision, bytes))
      await refreshed(avatarItem(item), session)
    } catch (error) {
      if (session === generation.current)
        setError(error instanceof Error ? error.message : '頭像更新未完成。')
    } finally {
      if (session === generation.current) {
        submitting.current = false
        setBusy(false)
      }
    }
  }
  const pick = () => void load(window.yuki.client.pickAvatar().then(unwrap))
  return (
    <>
      <Sheet
        title={`更換 ${profile.display_name} 的頭像`}
        width={600}
        onKeyDown={(event) => {
          if (
            !submitting.current &&
            !unknown &&
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === 'v'
          ) {
            event.preventDefault()
            void load(window.yuki.client.pasteAvatar().then(unwrap))
          }
        }}
        onDragOver={(event) => {
          if (!submitting.current && !unknown && event.dataTransfer.types.includes('Files'))
            event.preventDefault()
        }}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files[0]
          if (file && !submitting.current && !unknown)
            void load(window.yuki.client.dropAvatar(file).then(unwrap))
        }}
        onPaste={(event) => {
          if (!submitting.current && !unknown) {
            event.preventDefault()
            void load(window.yuki.client.pasteAvatar().then(unwrap))
          }
        }}
        open
        onClose={() => {
          if (!submitting.current) close()
        }}
        actions={
          <>
            <div className={styles.leftActions}>
              <Button disabled={submitting.current || !!unknown} onClick={pick}>
                {image ? '選擇其他圖片…' : '選擇圖片…'}
              </Button>
              <Button
                variant="plain"
                disabled={busy || !!unknown}
                onClick={() => void save('reset')}
              >
                還原預設
              </Button>
            </div>
            <Button disabled={submitting.current} onClick={close}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!image || !!unknown || !!conflict}
              onClick={() => void save('set')}
            >
              儲存
            </Button>
          </>
        }
      >
        <p className={styles.description}>
          只改變大家看到的頭像，不會改變 {profile.display_name} 的身份、記憶或歷史。
        </p>
        <div className={styles.editor}>
          <div>
            <div
              className={styles.crop}
              ref={crop}
              tabIndex={0}
              role="application"
              aria-label="頭像裁切區，方向鍵移動，加減鍵縮放"
              aria-disabled={busy || !!unknown}
              onPointerDown={(event) => {
                if (!image || busy || unknown || event.button !== 0 || !event.isPrimary) return
                cancelDrag.current?.()
                event.preventDefault()
                event.currentTarget.focus({
                  preventScroll: true,
                  focusVisible: false,
                } as FocusOptions)
                const start = { x: event.clientX, y: event.clientY, pan: transform.pan }
                const ratio = 280 / event.currentTarget.getBoundingClientRect().width
                cancelDrag.current = capturePointer(
                  event.currentTarget,
                  event.nativeEvent,
                  (next) => {
                    move({
                      x: start.pan.x + (next.clientX - start.x) * ratio,
                      y: start.pan.y + (next.clientY - start.y) * ratio,
                    })
                  },
                  () => {
                    cancelDrag.current = undefined
                  },
                )
              }}
              onKeyDown={(event) => {
                if (busy || unknown) return
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                  event.preventDefault()
                  const delta =
                    ((event.shiftKey ? 20 : 4) * 280) /
                    event.currentTarget.getBoundingClientRect().width
                  move({
                    x:
                      transform.pan.x +
                      (event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0),
                    y:
                      transform.pan.y +
                      (event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0),
                  })
                } else if (['+', '=', '-', '_'].includes(event.key)) {
                  event.preventDefault()
                  zoom(transform.zoom + (event.key === '-' || event.key === '_' ? -0.1 : 0.1))
                }
              }}
            >
              {image ? (
                <>
                  <canvas width={pixels} height={pixels} ref={canvas} />
                  <span className={styles.mask} />
                </>
              ) : (
                <div className={styles.choose}>
                  <ImagePlus size={32} strokeWidth={1.5} />
                  <span>選擇或拖入圖片</span>
                  <small>也可貼上剪貼簿圖片</small>
                </div>
              )}
              {busy && (
                <div className={styles.loading}>
                  <Spinner />
                </div>
              )}
            </div>
            <div className={styles.zoom}>
              <Slider
                label="頭像縮放"
                value={transform.zoom * 100}
                min={100}
                max={400}
                disabled={!image || busy || !!unknown}
                onChange={(value) => zoom(value / 100)}
              />
              <output aria-live="off">{Math.round(transform.zoom * 100)}%</output>
              <Button
                variant="plain"
                disabled={!image || busy || !!unknown}
                onClick={() => setTransform((previous) => ({ ...previous, pan: { x: 0, y: 0 } }))}
              >
                <RotateCcw size={14} />
                置中
              </Button>
            </div>
            {image && (
              <small className={styles.metadata}>
                {image.filename} · {image.width}×{image.height} · {formatBytes(image.size)}
              </small>
            )}
          </div>
          <div className={styles.previews}>
            <small>預覽</small>
            {(['light', 'dark'] as const).map((theme) => (
              <div
                className={`${styles.preview} ${styles[theme]}`}
                key={theme}
                style={{ '--accent': profile.accent[theme] } as CSSProperties}
              >
                {[20, 28, 36].map((size) => (
                  <Avatar name={profile.display_name} size={size} src={preview} key={size} />
                ))}
                <small>{theme === 'light' ? '淺色' : '深色'}</small>
              </div>
            ))}
            <small>側邊欄</small>
            <div className={styles.card}>
              <PresenceCard
                name={profile.display_name}
                status={visuals.presence?.text ?? '頭像預覽'}
                color={visuals.presence?.color}
                avatar={<Avatar name={profile.display_name} size={36} src={preview} />}
              />
            </div>
            <Button
              variant="plain"
              disabled={submitting.current || !!unknown}
              onClick={() => void load(window.yuki.client.pasteAvatar().then(unwrap))}
            >
              貼上圖片
            </Button>
          </div>
        </div>
        {fromCurrent && <p className={styles.description}>重新選擇原圖可以得到更大範圍。</p>}
        {image && Math.min(image.width, image.height) < 1024 && (
          <Banner status="waiting">
            這張圖片只有 {image.width}×{image.height}
            ，放在關於頁等大尺寸位置可能不夠清晰。仍然可以儲存。
          </Banner>
        )}
        {error && <Banner status="failed">{error}</Banner>}
        {unknown && (
          <Button
            loading={busy}
            onClick={async () => {
              const session = generation.current
              setBusy(true)
              try {
                await refreshed(
                  avatarItem(
                    unwrap(await window.yuki.client.verifyCharacterCommand(id, unknown.requestId)),
                  ),
                  session,
                )
              } catch (error) {
                if (session === generation.current)
                  setError(error instanceof Error ? error.message : '無法查證原請求。')
              } finally {
                if (session === generation.current) setBusy(false)
              }
            }}
          >
            查證頭像更新
          </Button>
        )}
        {conflict && (
          <div className={styles.conflict}>
            <div>
              <span>目前頭像</span>
              <CharacterAvatar size={64} avatar={conflict.current.avatar} />
            </div>
            <div>
              <span>你的選擇</span>
              {conflict.action === 'set' ? (
                <Avatar name={profile.display_name} size={64} src={preview} />
              ) : (
                <CharacterAvatar size={64} avatar={conflict.current.default_avatar} />
              )}
            </div>
            <div className={styles.conflictActions}>
              <Button disabled={busy} onClick={close}>
                保留目前的
              </Button>
              <Button
                variant="primary"
                loading={busy}
                disabled={!!unknown}
                onClick={() => {
                  setBaseline(conflict.current.avatar_revision)
                  void save(conflict.action, conflict.current.avatar_revision)
                }}
              >
                用我的
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  )
}
