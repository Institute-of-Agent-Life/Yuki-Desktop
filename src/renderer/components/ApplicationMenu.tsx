import { useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { Capsule, IconButton } from './Controls'
import styles from './ApplicationMenu.module.css'
import { useTranslation } from '../i18n'

export function ApplicationMenu({
  platform,
  overlay = false,
  className = '',
}: {
  platform: string
  overlay?: boolean
  className?: string
}) {
  const { t } = useTranslation(['workspace'])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  if (platform === 'darwin') return null
  const show = async (button: HTMLButtonElement) => {
    if (open) return
    setOpen(true)
    setError(false)
    try {
      const rect = button.getBoundingClientRect()
      const result = await window.yuki.applicationMenu({ x: rect.left, y: rect.bottom + 4 })
      setError(!result.ok || !result.value)
    } catch {
      setError(true)
    } finally {
      setOpen(false)
    }
  }
  return (
    <span
      data-platform={platform}
      className={`${styles.container} ${overlay ? styles.overlay : ''} ${className}`}
    >
      <Capsule>
        <IconButton
          type="button"
          label={t('workspace:moreCommands')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => void show(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              void show(event.currentTarget)
            }
            if (event.key === 'Escape') setError(false)
          }}
        >
          <Ellipsis size={16} strokeWidth={1.5} />
        </IconButton>
      </Capsule>
      {error && (
        <span role="alert" className={styles.error}>
          {t('workspace:menuFailed')}
        </span>
      )}
    </span>
  )
}
