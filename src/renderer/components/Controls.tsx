import { reducedMotion, usePress } from '../motion/hooks'
import { sampleSpring, springs } from '../motion/spring'
import { followPointer, useGlass } from '../materials/glass'
import { emerge, withdraw } from '../motion/emerge'
import { useSessionActive } from '../state/workspace'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
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
import { useTranslation } from '../i18n'

export type Status = 'running' | 'waiting' | 'done' | 'failed' | 'unknown' | 'offline'
const statusStyle = (status: Status) => ({ '--status': `var(--status-${status})` }) as CSSProperties

export function Spinner() {
  const { t } = useTranslation(['common'])
  return <span className={styles.spinner} aria-label={t('common:loading')} role="status" />
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
  const { t } = useTranslation(['common'])
  const press = usePress<HTMLButtonElement>()
  // Tinted glass glows in its own colour where the pointer's light falls.
  useEffect(
    () => (variant === 'primary' ? followPointer(press.current!) : undefined),
    [variant, press],
  )
  const [visible, setVisible] = useState(false)
  const busy = useRef<HTMLSpanElement>(null),
    shown = useRef(false)
  useEffect(() => {
    if (!loading) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), 300)
    return () => clearTimeout(timer)
  }, [loading])
  // The spinner's place opens and closes on a springy, slightly overshooting curve, so the
  // button swells out from both edges like liquid and settles.
  useLayoutEffect(() => {
    const slot = busy.current
    if (!slot || shown.current === visible) return
    shown.current = visible
    if (reducedMotion()) return
    const samples = sampleSpring(springs.busy),
      last = samples.length - 1
    slot.animate(
      samples.map(({ value }, index) => ({
        offset: index / last,
        '--busy': String(visible ? value : 1 - value),
      })),
      { duration: (last * 1000) / 60, easing: 'linear' },
    )
  }, [visible])
  return (
    <button
      {...props}
      ref={press}
      data-press="button"
      // A secondary button is lit glass at rest: its rim catches the light, with no filter.
      data-glass={variant === 'secondary' ? 'button' : undefined}
      disabled={props.disabled || loading}
      aria-busy={loading}
      className={`${styles.button} ${styles[variant]} ${large ? styles.large : ''} ${className}`}
    >
      <span ref={busy} className={styles.busy} data-shown={visible}>
        <span
          className={styles.spinner}
          {...(visible
            ? { role: 'status', 'aria-label': t('common:loading') }
            : { 'aria-hidden': true })}
        />
      </span>
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
  const press = usePress<HTMLButtonElement>('compact')
  useEffect(
    () => (variant === 'send' ? followPointer(press.current!) : undefined),
    [variant, press],
  )
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
// Toolbar controls in their own clear glass capsule.
export function Capsule({ children, className = '' }: { children: ReactNode; className?: string }) {
  const glass = useGlass<HTMLDivElement>('toolbar')
  return (
    <div ref={glass.ref} data-glass="toolbar" className={`${styles.capsule} ${className}`}>
      {children}
    </div>
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
  // Removed while open, it still withdraws: before its glass is taken down, so the copy keeps it.
  useLayoutEffect(() => {
    const dialog = ref.current!
    return () => {
      if (dialog.open) withdraw(dialog)
    }
  }, [])
  const glass = useGlass<HTMLDialogElement>('sheet')
  // A closing sheet keeps what it showed until it has withdrawn, so its glass shrinks from the
  // size it had, not from what its owner shows once it is closed.
  const shown = useRef({ title, children, actions })
  if (open) shown.current = { title, children, actions }
  const [, settle] = useReducer((count: number) => count + 1, 0)
  const content = open || ref.current?.open ? shown.current : { title, children, actions }
  const previous = useRef<Element | null>(null)
  const requested = useRef(false)
  useEffect(() => {
    if (open && active) {
      if (!requested.current) previous.current = document.activeElement
      requested.current = true
      const opening = ref.current?.open === false
      ref.current?.showModal()
      if (opening) emerge(ref.current!)
    } else {
      const closing = ref.current?.open
      if (!open && active && closing) withdraw(ref.current!)
      ref.current?.close()
      if (closing) settle()
      if (!open) {
        if (requested.current && active && previous.current instanceof HTMLElement)
          previous.current.focus()
        requested.current = false
      }
    }
  }, [open, active])
  return (
    <dialog
      ref={(node) => {
        ref.current = node
        glass.ref.current = node
      }}
      data-glass="sheet"
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
          <h2 id={titleId}>{content.title}</h2>
        </header>
        <div className={styles.dialogBody}>{content.children}</div>
        <footer className={styles.dialogFooter}>{content.actions}</footer>
      </div>
    </dialog>
  )
}
