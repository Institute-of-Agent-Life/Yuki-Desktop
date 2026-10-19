import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
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
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...props} aria-label={label} title={label} className={styles.icon}>
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
}: {
  name: string
  size?: number
  src?: string | null
}) {
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-label={name}
    >
      {src ? <img src={src} alt="" /> : name.trim().slice(0, 1).toLocaleUpperCase()}
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
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      role="switch"
      aria-checked={checked}
      className={styles.toggle}
      onClick={() => onChange(!checked)}
    />
  )
}
export function Segmented<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string
  items: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className={styles.segment} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const next =
              items[(index + (event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length]!
            onChange(next.value)
            ;(
              event.currentTarget.parentElement?.children[
                (index + (event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length
              ] as HTMLElement
            )?.focus()
          }}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
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
}: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  actions: ReactNode
}) {
  const titleId = useId()
  const ref = useRef<HTMLDialogElement>(null)
  const previous = useRef<Element | null>(null)
  useEffect(() => {
    if (open) {
      previous.current = document.activeElement
      ref.current?.showModal()
    } else {
      ref.current?.close()
      if (previous.current instanceof HTMLElement) previous.current.focus()
    }
  }, [open])
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
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
