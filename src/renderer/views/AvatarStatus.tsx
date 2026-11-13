import { useId } from 'react'
import type { Profile } from '../../shared/api'
import { Banner, Button } from '../components/Controls'
import styles from './AvatarStatus.module.css'
import { useTranslation } from '../i18n'

export function AvatarStatus({
  profile,
  status,
  supported,
  editable,
  retry,
  edit,
}: {
  profile: Profile
  status: 'pending' | 'error' | 'success'
  supported: boolean
  editable: boolean
  retry(): void
  edit(): void
}) {
  const heading = useId()
  const { t } = useTranslation(['avatar'])
  return (
    <section className={styles.status} aria-labelledby={heading}>
      <h2 id={heading}>{t('avatar:heading')}</h2>
      <p>{profile.avatar ? t('avatar:serverSet') : t('avatar:serverUnset')}</p>
      <p>{t('avatar:separate', { name: profile.display_name })}</p>
      {status === 'pending' ? (
        <p role="status">{t('avatar:reading')}</p>
      ) : status === 'error' ? (
        <>
          <Banner status="offline">{t('avatar:unavailable')}</Banner>
          <Button onClick={retry}>{t('avatar:reload')}</Button>
        </>
      ) : supported ? (
        <>
          <p>{t('avatar:syncs')}</p>
          {editable && <Button onClick={edit}>{t('avatar:change')}</Button>}
        </>
      ) : (
        <p>{t('avatar:unsupported')}</p>
      )}
    </section>
  )
}
