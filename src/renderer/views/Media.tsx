import { useEffect, useRef, useState } from 'react'
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
import { formatBytes as size } from '../../shared/media'
import { useMediaContent } from './media-content'

type Attachment = PublicEvent['attachments'][number]
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
    image = attachment.kind === 'image'
  const element = useRef<HTMLButtonElement>(null),
    [visible, setVisible] = useState(false)
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      rootMargin: '120px',
    })
    observer.observe(element.current!)
    return () => observer.disconnect()
  }, [])
  const resource =
    attachment.artifact_id && attachment.version
      ? { artifactId: attachment.artifact_id, version: attachment.version }
      : source
  const content = useMediaContent(id, resource, image && visible),
    url = content.data?.preview?.url
  const [menuError, setMenuError] = useState('')
  const status = content.error?.message
  return (
    <button
      ref={element}
      className={`${styles.attachment} ${image ? styles.image : ''}`}
      disabled={attachment.artifact_id ? !attachment.version || !artifact : false}
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
            save: true,
          })
          .then(unwrap)
          .then((action) => {
            if (action === 'save')
              return (
                'artifactId' in resource
                  ? window.yuki.client.saveArtifact(id, resource)
                  : window.yuki.client.saveContent(id, resource)
              ).then(unwrap)
          })
          .catch((error) => setMenuError(error instanceof Error ? error.message : '操作未完成。'))
      }}
    >
      {image && url ? (
        <img src={url} loading="lazy" alt={attachment.filename ?? '圖片附件'} />
      ) : (
        <div className={styles.file}>
          <span>
            {image ? <ImageIcon size={20} /> : voice ? <Mic size={20} /> : <File size={20} />}
          </span>
          <span className={styles.filename}>
            {attachment.filename ?? (image ? '圖片' : voice ? '語音訊息' : '檔案')}
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
  const content = useMediaContent(id, source),
    data = content.error ? undefined : content.data,
    [problem, setProblem] = useState('')
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
          {data.preview ? (
            <MediaBody content={data} />
          ) : data.bytes &&
            (data.mime.startsWith('text/') ||
              /\.(txt|md|json|csv|py|js|ts|yaml|yml|log)$/i.test(data.filename)) ? (
            <pre>{new TextDecoder().decode(data.bytes)}</pre>
          ) : (
            <p>此類型的附件可存成檔案後開啟。</p>
          )}
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

/** Both event attachments and versioned artifacts use the same player. */
export function MediaBody({ content }: { content: CachedContent }) {
  const [failed, setFailed] = useState(false),
    url = content.preview?.url
  useEffect(() => setFailed(false), [url])
  const error = () => setFailed(true)
  return (
    <div className={styles.media}>
      {content.mime.startsWith('image/') ? (
        <img src={url} alt={content.filename} onError={error} />
      ) : content.mime.startsWith('audio/') ? (
        <audio src={url} controls preload="metadata" onError={error} />
      ) : content.mime.startsWith('video/') ? (
        <video src={url} controls preload="metadata" onError={error} />
      ) : content.mime === 'application/pdf' ? (
        <iframe src={url} title={`PDF 預覽：${content.filename}`} />
      ) : null}
      {failed && <p>這台電腦無法預覽此格式，可存成檔案後開啟。</p>}
    </div>
  )
}
