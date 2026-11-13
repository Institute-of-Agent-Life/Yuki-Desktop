import type { ReactNode } from 'react'
import { Button } from '../components/Controls'
import { useTranslation } from '../i18n'
import styles from './Settings.module.css'

export function Row({
  title,
  description,
  group = false,
  children,
}: {
  title: string
  description?: string
  /** A row that stands for one thing (a platform) is named by its title. */
  group?: boolean
  children?: ReactNode
}) {
  return (
    <div
      className={styles.row}
      data-settings-row
      role={group ? 'group' : undefined}
      aria-label={group ? title : undefined}
    >
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
  const { t } = useTranslation(['connection'])
  return (
    <Row title={text} description={t('connection:pending.description')}>
      <Button loading={busy} onClick={onVerify}>
        {t('connection:pending.verify')}
      </Button>
    </Row>
  )
}
