import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Mic, Plus } from 'lucide-react'
import { IconButton } from './Controls'
import styles from '../App.module.css'

export function Composer({
  name,
  draft,
  onDraft,
  onSubmit,
  onAttach,
  onRecord,
  commandEnter = false,
  children,
}: {
  name: string
  draft: string
  onDraft(value: string): void
  onSubmit(): Promise<void>
  onAttach?: () => void
  onRecord?: () => void
  commandEnter?: boolean
  children?: ReactNode
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = input.current
    if (element) {
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight}px`
    }
  }, [draft])
  const submit = async () => {
    if (sending || !draft.trim()) return
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
    <div className={styles.composer} data-region="composer">
      {children}
      <textarea
        ref={input}
        aria-label={`和 ${name} 說點什麼`}
        placeholder={`和 ${name} 說點什麼…`}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            (!commandEnter || event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <div className={styles.composerBottom}>
        <IconButton label="附加檔案" disabled={!onAttach} onClick={onAttach}>
          <Plus size={18} strokeWidth={1.6} />
        </IconButton>
        <IconButton label="語音輸入" disabled={!onRecord} onClick={onRecord}>
          <Mic size={18} strokeWidth={1.6} />
        </IconButton>
        <small>{error || (commandEnter ? '⌘ / Ctrl ↩ 送出' : '↩ 送出 · ⇧↩ 換行')}</small>
        <IconButton label="送出" disabled={sending || !draft.trim()} onClick={() => void submit()}>
          <ArrowUp size={18} strokeWidth={1.6} />
        </IconButton>
      </div>
    </div>
  )
}
