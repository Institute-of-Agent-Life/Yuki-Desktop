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
import { useTranslation } from '../i18n'

type Attachment = PublicEvent['attachments'][number]
export function MessageAttachment({
  id,
  event,
  attachment,
  open,
  artifact,
  sticker,
}: {
  id: string
  event: PublicEvent
  attachment: Attachment
  open(source: AttachmentSource): void
  artifact?(source: ArtifactSource): void
  /** The sticker's name: shown as a sticker, with no card around it. */
  sticker?: string
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
  // Loaded as it first comes near the view, then kept: one scrolled away and back shows as it was.
  // A slow frame can bring several crossings at once; any of them in view is enough.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setVisible(true)
        observer.disconnect()
      },
      { rootMargin: '120px' },
    )
    observer.observe(element.current!)
    return () => observer.disconnect()
  }, [])
  const resource =
    attachment.artifact_id && attachment.version
      ? { artifactId: attachment.artifact_id, version: attachment.version }
      : source
  const { t } = useTranslation(['media', 'errors'])
  const content = useMediaContent(id, resource, image && visible),
    url = content.data?.preview?.url
  const [menuError, setMenuError] = useState('')
  const status = content.error?.message
  // A sticker keeps its waiting square until its picture has loaded, so its row never shrinks.
  const [shown, setShown] = useState<string>()
  const waiting = !!sticker && (!url || shown !== url)
  return (
    <button
      ref={element}
      className={sticker ? styles.sticker : `${styles.attachment} ${image ? styles.image : ''}`}
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
            text: attachment.filename ?? t('media:attachment'),
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
          .catch((error) =>
            setMenuError(error instanceof Error ? error.message : t('errors:notCompleted')),
          )
      }}
    >
      {image && url && (
        <img
          src={url}
          alt={sticker ?? attachment.filename ?? t('media:imageAttachment')}
          hidden={waiting}
          onLoad={() => setShown(url)}
        />
      )}
      {waiting ? (
        <span className={styles.stickerWaiting} role="img" aria-label={sticker} />
      ) : image && url ? null : (
        <div className={styles.file}>
          <span>
            {image ? <ImageIcon size={20} /> : voice ? <Mic size={20} /> : <File size={20} />}
          </span>
          <span className={styles.filename}>
            {attachment.filename ??
              t(image ? 'media:image' : voice ? 'media:voiceMessage' : 'media:file')}
          </span>
          {attachment.size !== null && attachment.size !== undefined && (
            <small>{size(attachment.size)}</small>
          )}
          {!image && status && <small>{status}</small>}
        </div>
      )}
      {image && status && <small>{status}</small>}
      {menuError && <small role="alert">{menuError}</small>}
      {attachment.artifact_id && !sticker && <small>{t('media:artifactFile')}</small>}
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
  const { t } = useTranslation(['media', 'errors'])
  const [error, setError] = useState('')
  const run = async (work: Promise<unknown>) => {
    try {
      await work
      refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : t('errors:notCompleted'))
    }
  }
  return (
    <>
      {!!items.length && (
        <div className={styles.drafts} aria-label={t('media:drafts')}>
          {items.map((item) => (
            <div className={styles.draft} key={item.requestId}>
              {item.kind === 'record' ? <Mic size={18} /> : <File size={18} />}
              <span className={styles.filename}>
                {item.filename}
                <small>
                  {size(item.size)} ·{' '}
                  {item.problem
                    ? problemText(item.problem)
                    : t(
                        item.state === 'ready'
                          ? 'media:upload.ready'
                          : item.state === 'draft'
                            ? 'media:upload.draft'
                            : 'media:upload.unknown',
                      )}
                </small>
              </span>
              {item.state !== 'ready' && (
                <Button
                  variant="plain"
                  onClick={() =>
                    void run(window.yuki.client.retryUpload(id, item.requestId).then(unwrap))
                  }
                >
                  {t(item.state === 'failed' ? 'media:verify' : 'media:verifyAndRetry')}
                </Button>
              )}
              <IconButton
                label={t('media:removeItem', { name: item.filename })}
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
  const { t } = useTranslation(['media'])
  const content = useMediaContent(id, source),
    data = content.error ? undefined : content.data,
    [problem, setProblem] = useState('')
  return (
    <div className={styles.preview}>
      <header>
        <strong>{data?.filename ?? t('media:preview')}</strong>
        <IconButton label={t('media:closePreview')} onClick={close}>
          <X size={16} />
        </IconButton>
      </header>
      {content.error && <Banner status="failed">{content.error.message}</Banner>}
      {content.isPending && <p role="status">{t('media:readingAttachment')}</p>}
      {data && (
        <>
          {data.preview ? (
            <MediaBody content={data} />
          ) : data.bytes &&
            (data.mime.startsWith('text/') ||
              /\.(txt|md|json|csv|py|js|ts|yaml|yml|log)$/i.test(data.filename)) ? (
            <pre>{new TextDecoder().decode(data.bytes)}</pre>
          ) : (
            <p>{t('media:saveToOpen')}</p>
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
            {t('media:saveAsFile')}
          </Button>
        </>
      )}
      {problem && <Banner status="failed">{problem}</Banner>}
    </div>
  )
}

/** Both event attachments and versioned artifacts use the same player. */
export function MediaBody({ content }: { content: CachedContent }) {
  const { t } = useTranslation(['media'])
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
        <iframe src={url} title={t('media:pdfPreview', { name: content.filename })} />
      ) : null}
      {failed && <p>{t('media:cannotPreview')}</p>}
    </div>
  )
}
