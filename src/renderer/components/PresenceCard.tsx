import type { ReactNode } from 'react'
import { Avatar } from './Controls'
import styles from '../App.module.css'

export function PresenceCard({
  name,
  status,
  color = 'offline',
  avatar,
  open,
}: {
  name: string
  status: string
  color?: 'running' | 'waiting' | 'done' | 'offline'
  avatar?: ReactNode
  open?: () => void
}) {
  const content = (
    <>
      <span className={styles.presenceAvatar}>
        {avatar ?? <Avatar name={name} />}
        <span className={styles.presenceDot} style={{ background: `var(--status-${color})` }} />
      </span>
      <span className={styles.presenceText}>
        <strong title={name}>{name}</strong>
        <small title={status}>{status}</small>
      </span>
    </>
  )
  return open ? (
    <button className={styles.presence} onClick={open}>
      {content}
    </button>
  ) : (
    <div className={styles.presence}>{content}</div>
  )
}
