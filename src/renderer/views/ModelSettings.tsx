import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type { ModelApplyInput, ModelDocument } from '../../shared/models'
import { Banner, Button, Segmented, Spinner } from '../components/Controls'
import { ClientProblem, unwrap, useMe } from '../queries/client'
import { useTranslation } from '../i18n'
import { PendingRequest } from './SettingsRow'
import { ModelConnections } from './ModelConnections'
import { ModelPurposes } from './ModelPurposes'
import { ModelUsage } from './ModelUsage'
import styles from './ModelSettings.module.css'

export function useModelConfiguration(id: string) {
  const { t } = useTranslation(['models'])
  const cache = useQueryClient()
  const key = ['desktop', 'models', id]
  const bundle = useQuery({
    queryKey: key,
    queryFn: () => window.yuki.client.models.read(id).then(unwrap),
    retry: false,
  })
  const [pending, setPending] = useState<{ input: ModelApplyInput; saved?(): void }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const run = async (request: NonNullable<typeof pending>) => {
    setBusy(true)
    setError('')
    setConflict(false)
    try {
      const result = unwrap(await window.yuki.client.models.apply(id, request.input))
      setPending(undefined)
      if (result.success) {
        request.saved?.()
        await cache.invalidateQueries({ queryKey: key })
      } else setError(t('models:applyFailed'))
    } catch (failure) {
      if (failure instanceof ClientProblem && failure.code === 'version_conflict') {
        setPending(undefined)
        setConflict(true)
      } else {
        setError((failure as Error).message)
        if (
          failure instanceof ClientProblem &&
          !['transport_unknown', 'unknown'].includes(failure.code)
        )
          setPending(undefined)
        if (failure instanceof ClientProblem && failure.code === 'capability_denied')
          await cache.invalidateQueries({ queryKey: key })
      }
    } finally {
      setBusy(false)
    }
  }
  const save = (document: ModelDocument, apiKeys?: Record<string, string>, saved?: () => void) => {
    const request = {
      input: {
        requestId: crypto.randomUUID(),
        expectedRevision: bundle.data!.revision,
        document,
        apiKeys,
      },
      saved,
    }
    setPending(request)
    void run(request)
  }
  const reload = async () => {
    const result = await bundle.refetch()
    if (!result.isError) setConflict(false)
  }
  return { bundle, save, busy, error, conflict, pending, reload, verify: () => void run(pending!) }
}

export type ModelPage = 'connections' | 'purposes' | 'usage'

export function ModelSettings({
  connection,
  page: tab,
  onPage,
}: {
  connection: Connection
  page: ModelPage
  onPage(page: ModelPage): void
}) {
  const { t } = useTranslation(['models'])
  const model = useModelConfiguration(connection.characterId)
  const authority = useMe(connection.characterId)
  const data = model.bundle.data
  if (
    authority.data?.is_superuser === false ||
    (model.bundle.error instanceof ClientProblem && model.bundle.error.code === 'capability_denied')
  )
    return <Banner>{t('models:adminOnly')}</Banner>
  if (authority.error) return <Banner status="failed">{authority.error.message}</Banner>
  if (authority.isPending || model.bundle.isPending) return <Spinner />
  if (model.bundle.error) return <Banner status="failed">{model.bundle.error.message}</Banner>
  if (!data!.valid) return <Banner status="failed">{t('models:invalidDocument')}</Banner>
  const feedback = (
    <>
      {model.error && <Banner status="failed">{model.error}</Banner>}
      {model.conflict && (
        <Banner status="failed">
          {t('models:conflict')}{' '}
          <Button loading={model.bundle.isFetching} onClick={() => void model.reload()}>
            {t('models:reload')}
          </Button>
        </Banner>
      )}
      {model.pending && !model.busy && (
        <PendingRequest
          text={t('models:pendingConfirm')}
          busy={model.busy}
          onVerify={model.verify}
        />
      )}
    </>
  )
  return (
    <div className={styles.settings}>
      <div className={styles.toolbar}>
        <Segmented
          label={t('models:pages')}
          value={tab}
          items={[
            { value: 'connections', label: t('models:page.connections') },
            { value: 'purposes', label: t('models:page.purposes') },
            { value: 'usage', label: t('models:page.usage') },
          ]}
          onChange={(value) => onPage(value as ModelPage)}
        />
        {tab !== 'usage' && (
          <small>
            {t(
              data!.apply_mode === 'hot_reload'
                ? 'models:appliesNow'
                : 'models:appliesAfterRestart',
            )}
          </small>
        )}
      </div>
      {feedback}
      {tab === 'connections' ? (
        <ModelConnections
          data={data!}
          busy={model.busy}
          pending={!!model.pending}
          save={model.save}
          feedback={feedback}
          characterId={connection.characterId}
        />
      ) : tab === 'purposes' ? (
        <ModelPurposes
          data={data!}
          busy={model.busy}
          pending={!!model.pending}
          save={model.save}
          feedback={feedback}
        />
      ) : (
        <ModelUsage
          key={connection.characterId}
          characterId={connection.characterId}
          tasks={data!.tasks}
        />
      )}
    </div>
  )
}
