import type { ReactNode } from 'react'
import styles from './Settings.module.css'

export function Row({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
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
