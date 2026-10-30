import type { ReactNode } from 'react'
import { Avatar } from './Controls'
import styles from '../App.module.css'

export function PresenceCard({
  name,
  status,
  color = 'offline',
  avatar,
}: {
  name: string
  status: string
  color?: 'running' | 'waiting' | 'done' | 'offline'
  avatar?: ReactNode
}) {
  return (
    <div className={styles.presence}>
      <span className={styles.presenceAvatar} aria-hidden="true">
        {avatar ?? <Avatar name={name} />}
        <span className={styles.presenceDot} style={{ background: `var(--status-${color})` }} />
      </span>
      <span className={styles.presenceText}>
        <strong title={name}>{name}</strong>
        <small title={status}>{status}</small>
      </span>
    </div>
  )
}
