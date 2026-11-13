import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type { ConnectorHolder } from '../../shared/connector'
import { Banner, Button, EmptyState, Spinner } from '../components/Controls'
import { unwrap } from '../queries/client'
import { ConnectorTasks } from './ConnectorTasks'
import styles from './LocalComputer.module.css'
import { useTranslation } from '../i18n'

export function LocalComputer({
  connection,
  openSettings,
}: {
  connection: Connection
  openSettings(): void
}) {
  const query = useQueryClient()
  const { t } = useTranslation(['connector', 'common'])
  const state = useQuery({
    queryKey: ['desktop', 'agent-connector', connection.characterId],
    queryFn: () => window.yuki.connector.state(connection.characterId).then(unwrap),
    retry: false,
  })
  // 「停止」 is the only stop: the owner's own input just makes Yuki pause that step and retry.
  // Yuki resumes on 「繼續」 or when the owner says so in chat.
  const control = useMutation({
    mutationFn: (holder: ConnectorHolder) =>
      window.yuki.connector.control(holder, connection.characterId).then(unwrap),
    onSuccess: (value) =>
      query.setQueryData(['desktop', 'agent-connector', connection.characterId], value),
  })
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (
          character === connection.characterId &&
          ['sync', 'refresh', 'work', 'conversation'].includes(kind)
        ) {
          const filter = { queryKey: ['desktop', 'agent-connector', character], exact: true }
          const refresh = () => query.invalidateQueries(filter, { cancelRefetch: false })
          const pending = query.getQueryCache().find(filter)?.promise
          if (pending) void pending.then(refresh, () => {})
          else void refresh()
        }
      }),
    [connection.characterId, query],
  )
  const available = state.data?.available ? state.data : undefined
  const supervision = available?.supervision
  if (state.isPending)
    return (
      <EmptyState title={t('connector:local.title')}>
        <Spinner />
      </EmptyState>
    )
  if (!available?.deviceId)
    return (
      <EmptyState
        title={
          state.isError
            ? t('connector:local.unknownState')
            : t('connector:local.notConnected', { name: connection.name })
        }
        action={
          <Button variant="primary" onClick={openSettings}>
            {t('connector:local.goSettings')}
          </Button>
        }
      >
        {state.isError
          ? state.error.message
          : t('connector:local.emptyDescription', { name: connection.name })}
      </EmptyState>
    )
  return (
    <div className={styles.page}>
      {state.error && <Banner status="unknown">{state.error.message}</Banner>}
      {available.admission?.matched !== true && (
        <Banner status="unknown">{t('connector:local.notAdmitted')}</Banner>
      )}
      {available.supervision?.link === 'authorization_lost' && (
        <Banner status="failed">
          {t('connector:local.authorizationLost')}
          <Button onClick={openSettings}>{t('connector:local.goSettings')}</Button>
        </Banner>
      )}
      {available.supervision?.restartPending && (
        <Banner status="waiting">
          {t('connector:local.restarting', { count: available.supervision.restarts })}
          <Button onClick={openSettings}>{t('connector:local.viewDiagnostics')}</Button>
        </Banner>
      )}
      {control.error && <Banner status="failed">{control.error.message}</Banner>}
      {supervision?.control?.holder === 'owner' ? (
        <Banner status="waiting">
          {t('connector:local.ownerStopped')}
          <Button disabled={control.isPending} onClick={() => control.mutate('none')}>
            {t('common:action.continue')}
          </Button>
        </Banner>
      ) : (
        supervision?.activity && (
          <Banner status="running">
            {supervision.activity.tool === 'browser'
              ? t('connector:local.browser')
              : supervision.activity.background
                ? t('connector:local.background')
                : t('connector:local.computer')}
            <Button disabled={control.isPending} onClick={() => control.mutate('owner')}>
              {t('connector:local.stop')}
            </Button>
          </Banner>
        )
      )}
      <ConnectorTasks
        key={connection.characterId + available.deviceId}
        connection={connection}
        state={available}
      />
    </div>
  )
}
