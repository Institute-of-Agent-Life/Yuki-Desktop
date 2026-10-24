import { useId } from 'react'
import type { Profile } from '../../shared/api'
import styles from './AvatarStatus.module.css'

export function AvatarStatus({ profile }: { profile: Profile }) {
  const heading = useId()
  return (
    <section className={styles.status} aria-labelledby={heading}>
      <h2 id={heading}>角色頭像</h2>
      <p>
        {profile.avatar
          ? '伺服器已設定角色頭像。'
          : '伺服器尚未提供角色頭像，目前使用名稱字首顯示。'}
      </p>
      <p>這是 {profile.display_name} 的角色頭像，與你的 QQ 或其他平台帳號頭像分開。</p>
      <p>目前桌面尚未提供更換角色頭像的功能。</p>
    </section>
  )
}
