import { useId, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react'
import { ArrowUp, Mic, Plus } from 'lucide-react'
import { useGlass } from '../materials/glass'
import { IconButton } from './Controls'
import styles from '../App.module.css'
import { normalizeMessageText } from '../../shared/message'
import { unwrap } from '../queries/client'
import { useTranslation } from '../i18n'

/** Pasted text past either limit becomes a Markdown attachment instead of filling the field. */
export const pastedTextLimit = { characters: 4000, lines: 80 }
const pastesAsFile = (text: string) =>
  [...text].length > pastedTextLimit.characters || text.split('\n').length > pastedTextLimit.lines

export function Composer({
  name,
  platform,
  draft,
  onDraft,
  onSubmit,
  onAttach,
  onPasteFiles,
  onPasteText,
  onRecord,
  commandEnter = false,
  hasContent = false,
  blocked = false,
  children,
}: {
  name: string
  platform: string
  draft: string
  onDraft(value: string): void
  onSubmit(): Promise<void>
  onAttach?: () => void
  onPasteFiles?: (files: File[]) => void
  onPasteText?: (text: string) => void
  onRecord?: () => void
  commandEnter?: boolean
  hasContent?: boolean
  blocked?: boolean
  children?: ReactNode
}) {
  const { t } = useTranslation(['conversation'])
  const glass = useGlass<HTMLDivElement>('composer')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const feedbackId = useId()
  const shortcutId = `${feedbackId}-shortcut`
  const shortcut = t(
    platform === 'darwin'
      ? commandEnter
        ? 'conversation:composer.shortcut.macCommand'
        : 'conversation:composer.shortcut.mac'
      : commandEnter
        ? 'conversation:composer.shortcut.command'
        : 'conversation:composer.shortcut.enter',
  )
  const submit = async () => {
    if (sending || blocked || (!normalizeMessageText(draft) && !hasContent)) return
    setSending(true)
    setError('')
    try {
      await onSubmit()
    } catch {
      setError(t('conversation:composer.notSent'))
    } finally {
      setSending(false)
    }
  }
  const box = (
    <div ref={glass.ref} data-glass="composer" className={styles.composer} data-region="composer">
      <div className={styles.composerExtras}>{children}</div>
      <div className={styles.composerRow}>
        <IconButton
          label={t('conversation:composer.attach')}
          disabled={!onAttach}
          onClick={onAttach}
        >
          <Plus size={18} />
        </IconButton>
        <IconButton
          label={t('conversation:composer.voice')}
          disabled={!onRecord}
          onClick={onRecord}
        >
          <Mic size={18} />
        </IconButton>
        <textarea
          rows={1}
          aria-label={t('conversation:composer.prompt', { name })}
          aria-describedby={error ? feedbackId : shortcutId}
          aria-invalid={!!error}
          placeholder={t('conversation:composer.placeholder', { name })}
          value={draft}
          onChange={(event) => {
            setError('')
            onDraft(event.target.value)
          }}
          onPaste={(event) => {
            const { files, types } = event.clipboardData
            // Files and pictures attach (a screenshot is a file without a path; some sources expose none).
            if (onPasteFiles && (files.length || !types.length)) {
              event.preventDefault()
              onPasteFiles([...files])
              return
            }
            const text = event.clipboardData.getData('text/plain')
            if (onPasteText && pastesAsFile(text)) {
              event.preventDefault()
              onPasteText(text)
            }
          }}
          onKeyDown={(event) => {
            // ⌘⇧V / Ctrl+Shift+V always pastes the clipboard's text as it is, however long.
            if (
              (platform === 'darwin' ? event.metaKey : event.ctrlKey) &&
              event.shiftKey &&
              event.key.toLowerCase() === 'v'
            ) {
              event.preventDefault()
              void window.yuki.client
                .paste()
                .then(unwrap)
                .then((text) => document.execCommand('insertText', false, text))
              return
            }
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229 &&
              (!commandEnter || event.metaKey || event.ctrlKey)
            ) {
              event.preventDefault()
              if (!event.repeat) void submit()
            }
          }}
        />
        <small id={shortcutId} title={shortcut}>
          {shortcut}
        </small>
        <IconButton
          label={t('conversation:composer.send')}
          variant="send"
          data-send=""
          aria-busy={sending}
          disabled={sending || blocked || (!normalizeMessageText(draft) && !hasContent)}
          onClick={() => void submit()}
        >
          <ArrowUp size={18} />
        </IconButton>
      </div>
      <p className={styles.composerError} id={feedbackId} aria-live="polite">
        {error}
      </p>
    </div>
  )
  return (
    <>
      {box}
      <SendGlass composer={glass.ref} />
    </>
  )
}

/*
 * The send button's glass: a circle of the Dock's glass with its own lens and rim, nested in the
 * composer's. It lies beside the composer, over the button, not inside it: a backdrop filter sees
 * only what lies within the nearest glass around it, and inside the composer's that is nothing (the
 * composer's own glass is its backdrop, not its content). The button beneath takes the pointer and
 * the keyboard; this follows its place, its press and whether there is something to send.
 */
function SendGlass({ composer }: { composer: RefObject<HTMLDivElement | null> }) {
  const glass = useGlass<HTMLSpanElement>('send')
  useLayoutEffect(() => {
    const host = composer.current,
      circle = glass.ref.current
    if (!host || !circle) return
    const button = host.querySelector<HTMLElement>('[data-send]')!
    const place = () => {
      let left = host.offsetLeft,
        top = host.offsetTop
      for (let node: HTMLElement | null = button; node && node !== host;) {
        left += node.offsetLeft
        top += node.offsetTop
        node = node.offsetParent as HTMLElement | null
      }
      circle.style.left = `${left}px`
      circle.style.top = `${top}px`
      circle.style.width = `${button.offsetWidth}px`
      circle.style.height = `${button.offsetHeight}px`
      circle.style.scale = button.style.scale
      circle.style.translate = button.style.translate
      circle.dataset.active = String(!button.matches(':disabled') || button.dataset.held === 'true')
    }
    const sizes = new ResizeObserver(place),
      changes = new MutationObserver(place)
    sizes.observe(host)
    sizes.observe(button)
    changes.observe(button, {
      attributes: true,
      attributeFilter: ['disabled', 'data-held', 'style', 'aria-busy'],
    })
    addEventListener('resize', place)
    place()
    return () => {
      sizes.disconnect()
      changes.disconnect()
      removeEventListener('resize', place)
    }
  })
  return (
    <span ref={glass.ref} data-glass="send" className={styles.sendGlass} aria-hidden="true">
      <ArrowUp size={18} />
    </span>
  )
}
