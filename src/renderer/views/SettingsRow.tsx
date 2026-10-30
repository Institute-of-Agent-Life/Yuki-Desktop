import type { ReactNode } from 'react'
import { Button } from '../components/Controls'
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

export function PendingRequest({
  text,
  busy,
  onVerify,
}: {
  text: string
  busy: boolean
  onVerify(): void
}) {
  return (
    <Row title={text} description="結果尚未確認，會以原請求查詢，不會建立新請求。">
      <Button loading={busy} onClick={onVerify}>
        重新確認
      </Button>
    </Row>
  )
}
