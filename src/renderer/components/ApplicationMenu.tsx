import { useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { IconButton } from './Controls'
import styles from './ApplicationMenu.module.css'

export function ApplicationMenu({
  platform,
  overlay = false,
  className = '',
}: {
  platform: string
  overlay?: boolean
  className?: string
}) {
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
      <IconButton
        type="button"
        label="更多命令"
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
      {error && (
        <span role="alert" className={styles.error}>
          選單暫時無法開啟，請再試一次。
        </span>
      )}
    </span>
  )
}
