import { Check, Circle, CircleHelp, File, X } from 'lucide-react'
import type { DragEventHandler, ReactNode } from 'react'
import { Button, StatusPill, type Status } from './Controls'
import styles from './Content.module.css'

export function WorkCard({
  title,
  status,
  statusLabel,
  detail,
  question,
  onOpen,
  onReply,
  onCancel,
  children,
}: {
  title: string
  status: Status
  statusLabel: string
  detail?: string
  question?: string
  onOpen: () => void
  onReply?: () => void
  onCancel?: () => void
  children?: ReactNode
}) {
  return (
    <article className={styles.work}>
      <div className={styles.workTitle}>
        <StatusPill status={status}>{statusLabel}</StatusPill>
        <h3 title={title}>{title}</h3>
      </div>
      {detail && <div className={styles.workMeta}>{detail}</div>}
      {question && (
        <div className={styles.question}>
          {question}
          <div>
            <Button variant="plain" onClick={onReply}>
              回覆
            </Button>
          </div>
        </div>
      )}
      {children}
      <footer className={styles.workActions}>
        <Button variant="plain" onClick={onOpen}>
          查看詳情
        </Button>
        {onCancel && (
          <Button variant="destructive" onClick={onCancel}>
            取消工作
          </Button>
        )}
      </footer>
    </article>
  )
}
export function StepRow({ label, status, time }: { label: string; status: Status; time?: string }) {
  const Icon =
    status === 'done' ? Check : status === 'failed' ? X : status === 'unknown' ? CircleHelp : Circle
  return (
    <div className={styles.step}>
      <Icon size={14} strokeWidth={1.4} color={`var(--status-${status})`} />
      <span>{label}</span>
      {time && <time>{time}</time>}
    </div>
  )
}
export function middleTruncate(name: string, units = 32) {
  const characters = [...name]
  const weight = (char: string) => (char.codePointAt(0)! > 255 ? 2 : 1)
  if (characters.reduce((sum, char) => sum + weight(char), 0) <= units) return name
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot) : ''
  const suffix = [...extension].slice(-Math.max(4, Math.floor(units / 3))).join('')
  let prefix = '',
    remaining = units - [...suffix].reduce((sum, char) => sum + weight(char), 0) - 1
  for (const char of characters) {
    if (remaining < weight(char)) break
    prefix += char
    remaining -= weight(char)
  }
  return `${prefix}…${suffix}`
}
export function FileName({ name, compact = true }: { name: string; compact?: boolean }) {
  const shortened = compact ? middleTruncate(name) : name,
    dot = shortened.lastIndexOf('.')
  const stem = dot > 0 ? shortened.slice(0, dot) : shortened
  const extension = dot > 0 ? shortened.slice(dot) : ''
  return (
    <span className={styles.fileName}>
      <span className={styles.fileStem}>{stem}</span>
      {extension && <span className={styles.fileExtension}>{extension}</span>}
    </span>
  )
}

export function FileRow({
  name,
  identity,
  detail,
  size,
  onOpen,
  onDragStart,
  selected,
}: {
  name: string
  identity: string
  detail: string
  size?: string
  onOpen: () => void
  onDragStart?: DragEventHandler<HTMLButtonElement>
  selected?: boolean
}) {
  return (
    <button
      className={styles.file}
      onClick={onOpen}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      title={name}
      aria-current={selected ? 'true' : undefined}
    >
      <File size={20} strokeWidth={1.5} />
      <span className={styles.fileText}>
        <FileName name={name} />
        <small title={`${identity} · ${detail}`}>
          <span className={styles.fileIdentity}>{identity}</span>
          <span aria-hidden="true">·</span>
          <span className={styles.fileDetail}>{detail}</span>
        </small>
      </span>
      {size && <span className={styles.fileSize}>{size}</span>}
    </button>
  )
}
