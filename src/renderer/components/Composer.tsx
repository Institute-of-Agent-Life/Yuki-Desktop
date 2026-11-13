import { useId, useState, type ReactNode } from 'react'
import { ArrowUp, Mic, Plus } from 'lucide-react'
import { useGlass } from '../materials/glass'
import { IconButton } from './Controls'
import styles from '../App.module.css'
import { normalizeMessageText } from '../../shared/message'
import { unwrap } from '../queries/client'

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
  const glass = useGlass<HTMLDivElement>('composer')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const feedbackId = useId()
  const shortcutId = `${feedbackId}-shortcut`
  const shortcut =
    platform === 'darwin'
      ? commandEnter
        ? '⌘↩ 送出'
        : '↩ 送出 · ⇧↩ 換行'
      : commandEnter
        ? 'Ctrl+Enter 送出'
        : 'Enter 送出 · Shift+Enter 換行'
  const submit = async () => {
    if (sending || blocked || (!normalizeMessageText(draft) && !hasContent)) return
    setSending(true)
    setError('')
    try {
      await onSubmit()
    } catch {
      setError('尚未送出，已保留內容。')
    } finally {
      setSending(false)
    }
  }
  return (
    <div ref={glass.ref} data-glass="composer" className={styles.composer} data-region="composer">
      <div className={styles.composerExtras}>{children}</div>
      <div className={styles.composerRow}>
        <IconButton label="附加檔案" disabled={!onAttach} onClick={onAttach}>
          <Plus size={18} strokeWidth={1.6} />
        </IconButton>
        <IconButton label="語音輸入" disabled={!onRecord} onClick={onRecord}>
          <Mic size={18} strokeWidth={1.6} />
        </IconButton>
        <textarea
          rows={1}
          aria-label={`和 ${name} 說點什麼`}
          aria-describedby={error ? feedbackId : shortcutId}
          aria-invalid={!!error}
          placeholder={`和 ${name} 說點什麼…`}
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
          label="送出"
          variant="send"
          aria-busy={sending}
          disabled={sending || blocked || (!normalizeMessageText(draft) && !hasContent)}
          onClick={() => void submit()}
        >
          <ArrowUp size={18} strokeWidth={1.6} />
        </IconButton>
      </div>
      <p className={styles.composerError} id={feedbackId} aria-live="polite">
        {error}
      </p>
    </div>
  )
}
