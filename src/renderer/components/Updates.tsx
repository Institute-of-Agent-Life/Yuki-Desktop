import { useState } from 'react'
import type { Preferences } from '../../shared/desktop'
import { useUpdates } from '../state/updates'
import { unwrap } from '../queries/client'
import { Banner, Button, Capsule, Segmented, Sheet, Spinner } from './Controls'
import { Row } from '../views/SettingsRow'
import { useTranslation } from '../i18n'

export function UpdateReadyButton() {
  const { t } = useTranslation(['updates'])
  const { state } = useUpdates()
  const [error, setError] = useState('')
  if (state?.phase !== 'downloaded') return null
  return (
    <>
      {error && <span role="alert">{error}</span>}
      <Capsule>
        <Button
          variant="plain"
          onClick={() => {
            setError('')
            void window.yuki.updates
              .install()
              .then(unwrap)
              .catch(() => setError(t('updates:installFailed')))
          }}
        >
          {t('updates:restart')}
        </Button>
      </Capsule>
    </>
  )
}
export function UpdatePanel({
  preferences,
  save,
}: {
  preferences: Preferences
  save(patch: Partial<Preferences>): Promise<void>
}) {
  const { t } = useTranslation(['updates', 'common'])
  const { state, failed: loadFailed, reload } = useUpdates()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch {
      setError(t('updates:actionFailed'))
    } finally {
      setBusy(false)
    }
  }
  const checking = state?.phase === 'checking',
    downloading = state?.phase === 'downloading'
  return (
    <>
      <Row title={t('updates:channel')} description={t('updates:channelDescription')}>
        <Segmented
          kind="radio"
          disabled={busy || state?.phase === 'installing' || state?.phase === 'preparing'}
          label={t('updates:channel')}
          value={preferences.updateChannel}
          items={[
            { value: 'stable' as const, label: t('updates:stable') },
            { value: 'beta' as const, label: t('updates:beta') },
          ]}
          onChange={(updateChannel) => void run(() => save({ updateChannel }))}
        />
      </Row>
      <Row
        title={t('updates:appUpdates')}
        description={
          state ? t('updates:currentVersion', { version: state.currentVersion }) : undefined
        }
      >
        {!state ? (
          loadFailed ? (
            <Button onClick={() => void reload()}>{t('common:action.reload')}</Button>
          ) : (
            <Spinner />
          )
        ) : (
          <Button
            disabled={busy || checking || downloading || state.mode === 'development'}
            loading={checking}
            onClick={() => void run(() => window.yuki.updates.check().then(unwrap))}
          >
            {t('updates:check')}
          </Button>
        )}
      </Row>
      {state?.mode === 'development' && (
        <Row title={t('updates:development')} description={t('updates:developmentDescription')} />
      )}
      {state?.phase === 'current' && (
        <Row title={t('updates:status')}>
          <span role="status">{t('updates:upToDate')}</span>
        </Row>
      )}
      {state?.phase === 'available' && (
        <Row
          title={t('updates:available', { version: state.version! })}
          description={state.mode === 'manual' ? t('updates:manual') : t('updates:managed')}
        >
          {state.mode === 'manual' ? (
            <Button
              onClick={() =>
                void run(() => window.yuki.client.external(state.releaseUrl).then(unwrap))
              }
            >
              {t('updates:releasePage')}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void run(() => window.yuki.updates.download().then(unwrap))}
            >
              {t('updates:download')}
            </Button>
          )}
        </Row>
      )}
      {downloading && (
        <Row title={t('updates:downloading')}>
          <progress
            aria-label={t('updates:progress')}
            max={100}
            value={state.progress?.total ? state.progress.percent : undefined}
          />
          <Button onClick={() => void run(() => window.yuki.updates.cancel().then(unwrap))}>
            {t('updates:cancelDownload')}
          </Button>
        </Row>
      )}
      {state?.phase === 'downloaded' && (
        <Row
          title={t('updates:downloaded', { version: state.version! })}
          description={t('updates:downloadedDescription')}
        >
          <UpdateReadyButton />
        </Row>
      )}
      {(error || loadFailed || state?.problem) && (
        <Banner status="failed">
          {error ||
            (loadFailed
              ? t('updates:unreadable')
              : state?.problem && t(`updates:problem.${state.problem}`))}
        </Banner>
      )}
    </>
  )
}

export function UpdatePending() {
  const { t } = useTranslation(['updates'])
  const { state } = useUpdates()
  return (
    <Sheet
      title={t('updates:preparing')}
      open={state?.phase === 'installing' || state?.phase === 'preparing'}
      onClose={() => {}}
      actions={<Spinner />}
    >
      <p>{state?.phase === 'preparing' ? t('updates:waiting') : t('updates:restartSoon')}</p>
    </Sheet>
  )
}
