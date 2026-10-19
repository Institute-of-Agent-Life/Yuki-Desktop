import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { File, Mic, Image as ImageIcon, Download, X } from 'lucide-react'
import type {
  AttachmentSource,
  ArtifactSource,
  CachedContent,
  PublicEvent,
  UploadDraft,
} from '../../shared/api'
import { Button, IconButton, Banner } from '../components/Controls'
import { unwrap, problemText } from '../queries/client'
import styles from './Media.module.css'

type Attachment = PublicEvent['attachments'][number]
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`
function useBlob(content?: CachedContent) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!content?.bytes) {
      setUrl(undefined)
      return
    }
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(content.bytes).buffer], { type: content.mime }),
    )
    setUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [content])
  return url
}
function useContent(id: string, source: AttachmentSource, enabled: boolean) {
  return useQuery({
    queryKey: [id, 'content', source.conversationId, source.eventId, source.index],
    queryFn: () => window.yuki.client.content(id, source).then(unwrap),
    enabled,
    retry: false,
  })
}
export function MessageAttachment({
  id,
  event,
  attachment,
  open,
  artifact,
}: {
  id: string
  event: PublicEvent
  attachment: Attachment
  open(source: AttachmentSource): void
  artifact?(source: ArtifactSource): void
}) {
  const source = {
      conversationId: event.conversation_id,
      eventId: event.event_id,
      index: attachment.attachment_index,
    },
    voice = ['audio', 'record'].includes(attachment.kind),
    available = attachment.availability === 'available',
    image = attachment.kind === 'image'
  const content = useContent(id, source, image && available && !attachment.artifact_id),
    url = useBlob(content.error || !available ? undefined : content.data)
  const [menuError, setMenuError] = useState('')
  if (voice)
    return (
      <div className={styles.voice}>
        <div>
          <Mic size={18} />
          語音訊息
        </div>
        <p>{event.transcript?.state === 'available' ? event.transcript.text : '沒有轉寫'}</p>
      </div>
    )
  const status =
    attachment.artifact_id ? undefined : attachment.availability === 'expired'
      ? '已過期'
      : !available
        ? '無法取得'
        : content.error?.message
  return (
    <button
      className={`${styles.attachment} ${image ? styles.image : ''}`}
      disabled={
        attachment.artifact_id ? !attachment.version || !artifact : !available || !!content.error
      }
      onClick={() =>
        attachment.artifact_id && attachment.version
          ? artifact?.({ artifactId: attachment.artifact_id, version: attachment.version })
          : open(source)
      }
      onContextMenu={(click) => {
        click.preventDefault()
        click.stopPropagation()
        void window.yuki.client
          .contextMenu({
            text: attachment.filename ?? '附件',
            save: available && !attachment.artifact_id,
          })
          .then(unwrap)
          .then((action) => {
            if (action === 'save') return window.yuki.client.saveContent(id, source).then(unwrap)
          })
          .catch((error) => setMenuError(error instanceof Error ? error.message : '操作未完成。'))
      }}
    >
      {image && url ? (
        <img src={url} alt={attachment.filename ?? '圖片附件'} />
      ) : (
        <div className={styles.file}>
          <span>{image ? <ImageIcon size={20} /> : <File size={20} />}</span>
          <span className={styles.filename}>
            {attachment.filename ?? (image ? '圖片' : '檔案')}
          </span>
          {attachment.size !== null && attachment.size !== undefined && (
            <small>{size(attachment.size)}</small>
          )}
          {!image && status && <small>{status}</small>}
        </div>
      )}
      {image && status && <small>{status}</small>}
      {menuError && <small role="alert">{menuError}</small>}
      {attachment.artifact_id && <small>成果檔案</small>}
    </button>
  )
}
export function DraftAttachments({
  id,
  items,
  refresh,
}: {
  id: string
  items: UploadDraft[]
  refresh(): void
}) {
  const [error, setError] = useState('')
  const run = async (work: Promise<unknown>) => {
    try {
      await work
      refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成。')
    }
  }
  return (
    <>
      {!!items.length && (
        <div className={styles.drafts} aria-label="待送出附件">
          {items.map((item) => (
            <div className={styles.draft} key={item.requestId}>
              {item.kind === 'record' ? <Mic size={18} /> : <File size={18} />}
              <span className={styles.filename}>
                {item.filename}
                <small>
                  {size(item.size)} ·{' '}
                  {item.problem
                    ? problemText(item.problem)
                    : item.state === 'ready'
                      ? '可送出'
                      : item.state === 'draft'
                        ? '等待上傳'
                        : '上傳狀態未確認'}
                </small>
              </span>
              {item.state !== 'ready' && (
                <Button
                  variant="plain"
                  onClick={() =>
                    void run(window.yuki.client.retryUpload(id, item.requestId).then(unwrap))
                  }
                >
                  {item.state === 'failed' ? '查證' : '查證並重試'}
                </Button>
              )}
              <IconButton
                label={`移除 ${item.filename}`}
                onClick={() =>
                  void run(window.yuki.client.removeUpload(id, item.requestId).then(unwrap))
                }
              >
                <X size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      {error && <Banner status="failed">{error}</Banner>}
    </>
  )
}
export function AttachmentPreview({
  id,
  source,
  close,
}: {
  id: string
  source: AttachmentSource
  close(): void
}) {
  const content = useContent(id, source, true),
    data = content.error ? undefined : content.data,
    url = useBlob(data),
    [problem, setProblem] = useState(''),
    [decodeError, setDecodeError] = useState(false)
  useEffect(() => setDecodeError(false), [url])
  return (
    <div className={styles.preview}>
      <header>
        <strong>{data?.filename ?? '附件預覽'}</strong>
        <IconButton label="關閉預覽" onClick={close}>
          <X size={16} />
        </IconButton>
      </header>
      {content.error && <Banner status="failed">{content.error.message}</Banner>}
      {content.isPending && <p role="status">正在讀取附件…</p>}
      {data && (
        <>
          {data.mime.startsWith('image/') && url ? (
            <img src={url} alt={data.filename} onError={() => setDecodeError(true)} />
          ) : data.mime.startsWith('video/') && url ? (
            <video src={url} controls onError={() => setDecodeError(true)} />
          ) : data.bytes &&
            (data.mime.startsWith('text/') ||
              /\.(txt|md|json|csv|py|js|ts|yaml|yml|log)$/i.test(data.filename)) ? (
            <pre>{new TextDecoder().decode(data.bytes)}</pre>
          ) : (
            <p>此類型的附件可存成檔案後開啟。</p>
          )}
          {decodeError && <p>這台電腦無法預覽此格式，可存成檔案後開啟。</p>}
          <Button
            onClick={() => {
              void window.yuki.client
                .saveContent(id, source)
                .then(unwrap)
                .catch((error) => setProblem(error.message))
            }}
          >
            <Download size={16} />
            存成檔案
          </Button>
        </>
      )}
      {problem && <Banner status="failed">{problem}</Banner>}
    </div>
  )
}
