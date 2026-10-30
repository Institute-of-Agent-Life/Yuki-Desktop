import type { ReactNode } from 'react'
import styles from './Settings.module.css'

export function Row({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className={styles.row}>
      <div className={styles.label}>
        {title}
        {description && <small>{description}</small>}
      </div>
      <div className={styles.rowValue}>{children}</div>
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  danger = false,
  children,
}: {
  title?: string
  description?: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section className={`${styles.section} ${danger ? styles.danger : ''}`}>
      {title && <h3>{title}</h3>}
      {description && <p className={styles.notice}>{description}</p>}
      <div className={styles.group}>{children}</div>
    </section>
  )
}
