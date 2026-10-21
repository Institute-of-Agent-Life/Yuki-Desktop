import { usePress } from '../motion/hooks'
import { useSessionActive } from '../state/workspace'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type ClipboardEventHandler,
  type DragEventHandler,
  type KeyboardEventHandler,
} from 'react'
import { Snowflake } from 'lucide-react'
import styles from './Controls.module.css'

export type Status = 'running' | 'waiting' | 'done' | 'failed' | 'unknown' | 'offline'
const statusStyle = (status: Status) => ({ '--status': `var(--status-${status})` }) as CSSProperties

export function Spinner() {
  return <span className={styles.spinner} aria-label="載入中" role="status" />
}
export function Button({
  variant = 'secondary',
  large = false,
  loading = false,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'plain' | 'destructive'
  large?: boolean
  loading?: boolean
}) {
  const press = usePress<HTMLButtonElement>()
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!loading) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [loading])
  return (
    <button
      {...props}
      ref={press}
      data-press="button"
      disabled={props.disabled || loading}
      aria-busy={loading}
      className={`${styles.button} ${styles[variant]} ${large ? styles.large : ''} ${className}`}
    >
      {visible && <Spinner />}
      {children}
    </button>
  )
}
export function IconButton({
  label,
  children,
  className = '',
  variant = 'plain',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: 'plain' | 'send' }) {
  const press = usePress<HTMLButtonElement>()
  return (
    <button
      {...props}
      ref={press}
      data-press="icon"
      aria-label={label}
      title={label}
      className={`${styles.icon} ${variant === 'send' ? styles.send : ''} ${className}`}
    >
      {children}
    </button>
  )
}
export function TextField(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${styles.field} ${props.className ?? ''}`} />
}
export function Avatar({
  name,
  size = 36,
  src,
  loading = false,
  accent,
}: {
  name: string
  size?: number
  src?: string | null
  loading?: boolean
  accent?: { light: string; dark: string }
}) {
  return (
    <span
      className={`${styles.avatar} ${src ? styles.photo : ''}`}
      style={
        {
          width: size,
          height: size,
          fontSize: size * 0.42,
          '--avatar-accent-light': accent?.light,
          '--avatar-accent-dark': accent?.dark,
        } as React.CSSProperties
      }
      aria-label={name}
      role="img"
      aria-busy={loading}
    >
      {src ? (
        <img key={src} src={src} alt="" />
      ) : (
        [
          ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name.trim()),
        ][0]?.segment.toLocaleUpperCase()
      )}
      {loading && (
        <span className={styles.avatarLoading}>
          <Spinner />
        </span>
      )}
    </span>
  )
}
export function StatusPill({ status, children }: { status: Status; children: ReactNode }) {
  return (
    <span className={styles.pill} style={statusStyle(status)}>
      <span className={styles.dot} />
      {children}
    </span>
  )
}
export function Banner({ status = 'offline', children }: { status?: Status; children: ReactNode }) {
  return (
    <div role="status" className={styles.banner} style={statusStyle(status)}>
      {children}
    </div>
  )
}
export { Toggle, Segmented, Slider, SelectionPill } from './InteractiveControls'
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={styles.empty}>
      <Snowflake size={48} strokeWidth={1.5} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  )
}
export function Sheet({
  title,
  open,
  onClose,
  children,
  actions,
  width,
  onPaste,
  onDrop,
  onDragOver,
  onKeyDown,
}: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  actions: ReactNode
  width?: number
  onPaste?: ClipboardEventHandler<HTMLDialogElement>
  onDrop?: DragEventHandler<HTMLDialogElement>
  onDragOver?: DragEventHandler<HTMLDialogElement>
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>
}) {
  const active = useSessionActive()
  const titleId = useId()
  const ref = useRef<HTMLDialogElement>(null)
  const previous = useRef<Element | null>(null)
  const requested = useRef(false)
  useEffect(() => {
    if (open && active) {
      if (!requested.current) previous.current = document.activeElement
      requested.current = true
      ref.current?.showModal()
    } else {
      ref.current?.close()
      if (!open) {
        if (requested.current && active && previous.current instanceof HTMLElement)
          previous.current.focus()
        requested.current = false
      }
    }
  }, [open, active])
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
      aria-labelledby={titleId}
      onPaste={onPaste}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className={styles.dialogInner}>
        <header className={styles.dialogHeader}>
          <h2 id={titleId}>{title}</h2>
        </header>
        <div className={styles.dialogBody}>{children}</div>
        <footer className={styles.dialogFooter}>{actions}</footer>
      </div>
    </dialog>
  )
}
