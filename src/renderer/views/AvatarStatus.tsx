import { useId } from 'react'
import type { Profile } from '../../shared/api'
import { Banner, Button } from '../components/Controls'
import styles from './AvatarStatus.module.css'

export function AvatarStatus({
  profile,
  status,
  supported,
  retry,
  edit,
}: {
  profile: Profile
  status: 'pending' | 'error' | 'success'
  supported: boolean
  retry(): void
  edit(): void
}) {
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
      {status === 'pending' ? (
        <p role="status">正在讀取頭像設定…</p>
      ) : status === 'error' ? (
        <>
          <Banner status="offline">目前無法取得頭像設定，請確認連線後重新讀取。</Banner>
          <Button onClick={retry}>重新讀取頭像設定</Button>
        </>
      ) : supported ? (
        <>
          <p>更換後，連接這個 Yuki 的裝置會同步顯示新的角色頭像。</p>
          <Button onClick={edit}>更換頭像</Button>
        </>
      ) : (
        <p>這個 Yuki 目前尚未提供更換角色頭像的功能。</p>
      )}
    </section>
  )
}
