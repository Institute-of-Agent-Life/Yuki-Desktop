import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type { ConnectorTerminalControl } from '../../shared/connector'
import { Banner, Button, Sheet } from '../components/Controls'
import { hidesPrivateData, unwrap } from '../queries/client'
import { Row } from './SettingsRow'
import styles from './Settings.module.css'
import activityStyles from './LocalComputer.module.css'
import { useTranslation } from '../i18n'

export function ConnectorTerminals({
  connection,
  deviceId,
}: {
  connection: Connection
  deviceId: string
}) {
  const query = useQueryClient()
  const { t } = useTranslation(['connector', 'common'])
  const [runId, setRunId] = useState<string>()
  const [controls, setControls] = useState<Record<string, ConnectorTerminalControl>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const directory = useInfiniteQuery({
    queryKey: ['connector-terminals', connection.characterId, deviceId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      window.yuki.connector.terminals(connection.characterId, deviceId, pageParam).then(unwrap),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    retry: false,
  })
  const detail = useInfiniteQuery({
    queryKey: ['connector-terminal', connection.characterId, runId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      window.yuki.connector.terminal(connection.characterId, runId!, pageParam).then(unwrap),
    getNextPageParam: (page, _pages, cursor) =>
      page.next_cursor !== undefined && page.next_cursor !== cursor ? page.next_cursor : undefined,
    enabled: !!runId,
    retry: false,
  })
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (
          character !== connection.characterId ||
          !['sync', 'refresh', 'work', 'conversation'].includes(kind)
        )
          return
        for (const key of ['connector-terminals', 'connector-terminal']) {
          const filter = { queryKey: [key, character] }
          const refresh = () => query.invalidateQueries(filter, { cancelRefetch: false })
          const pending = query.getQueryCache().find({ ...filter, type: 'active' })?.promise
          if (pending) void pending.then(refresh, () => {})
          else void refresh()
        }
      }),
    [connection.characterId, query],
  )
  const pages = hidesPrivateData(detail.error) ? undefined : detail.data?.pages
  const selected = pages?.at(-1)
  const control = runId ? controls[runId] : undefined
  const controlUnknown =
    control?.uncertain ||
    control?.pending ||
    ['unknown', 'not_found'].includes(control?.status ?? '')
  const act = async (read: boolean) => {
    if (!runId) return
    const requestId = read || controlUnknown ? controls[runId]!.request_id : crypto.randomUUID()
    setBusy(true)
    setError('')
    setControls((current) => ({
      ...current,
      [runId]: { request_id: requestId, run_id: runId, uncertain: true },
    }))
    try {
      const result = unwrap(
        await (read
          ? window.yuki.connector.terminalControl(connection.characterId, runId, requestId)
          : window.yuki.connector.controlTerminal(
              connection.characterId,
              runId,
              requestId,
              'cancel',
            )),
      )
      setControls((current) => ({ ...current, [runId]: result }))
      await detail.refetch()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : t('connector:terminals.cancelUnconfirmed'),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className={activityStyles.toolbar}>
        <h3>{t('connector:terminals.heading')}</h3>
        <Button
          variant="plain"
          disabled={directory.isFetching || detail.isFetching}
          onClick={() => {
            void directory.refetch()
            if (runId) void detail.refetch()
          }}
        >
          {t('connector:refresh')}
        </Button>
      </div>
      <p className={styles.notice}>{t('connector:terminals.intro')}</p>
      {directory.isError && (
        <Banner status="unknown">{t('connector:terminals.directoryUnavailable')}</Banner>
      )}
      <div className={styles.group}>
        {!hidesPrivateData(directory.error) &&
          directory.data?.pages
            .flatMap((page) => page.terminals)
            .map((run) => (
              <Row
                key={run.run_id}
                title={run.command ?? run.run_id}
                description={`${run.run_id} · ${run.status}`}
              >
                <Button
                  onClick={() => {
                    setRunId(run.run_id)
                    setError('')
                  }}
                >
                  {t('connector:terminals.viewReceipt')}
                </Button>
              </Row>
            ))}
      </div>
      {!hidesPrivateData(directory.error) && directory.hasNextPage && (
        <Button disabled={directory.isFetching} onClick={() => void directory.fetchNextPage()}>
          {t('connector:terminals.more')}
        </Button>
      )}
      {/* The terminal's receipt opens over the list, where it was asked for. */}
      <Sheet
        title={t('connector:terminals.run', { id: runId ?? '' })}
        open={!!runId}
        width={680}
        onClose={() => setRunId(undefined)}
        actions={
          <>
            {selected && (
              <>
                {detail.hasNextPage && (
                  <Button disabled={detail.isFetching} onClick={() => void detail.fetchNextPage()}>
                    {t('connector:terminals.moreOutput')}
                  </Button>
                )}
                <Button variant="destructive" disabled={busy} onClick={() => void act(false)}>
                  {controlUnknown
                    ? t('connector:terminals.resendStop')
                    : t('connector:terminals.stop')}
                </Button>
                {control && (
                  <Button disabled={busy} onClick={() => void act(true)}>
                    {t('connector:terminals.verifyStop')}
                  </Button>
                )}
              </>
            )}
            <Button disabled={detail.isFetching} onClick={() => void detail.refetch()}>
              {t('connector:terminals.refreshReceipt')}
            </Button>
            <Button variant="primary" onClick={() => setRunId(undefined)}>
              {t('common:action.close')}
            </Button>
          </>
        }
      >
        {detail.isPending && <p role="status">{t('connector:terminals.readingReceipt')}</p>}
        {detail.isError && (
          <Banner status="unknown">{t('connector:terminals.receiptUnavailable')}</Banner>
        )}
        {selected && (
          <>
            <p className={styles.notice}>
              {t('connector:statusLine', { status: selected.status })}
              {selected.pending && t('connector:pendingFlag')}
              {selected.uncertain && t('connector:terminals.unconfirmedFlag')}
              {selected.exit_code !== undefined &&
                selected.exit_code !== null &&
                ` · ${t('connector:terminals.exitCode', { code: selected.exit_code })}`}
            </p>
            {selected.error && (
              <Banner status={selected.uncertain ? 'unknown' : 'failed'}>
                {typeof selected.error === 'string'
                  ? selected.error
                  : JSON.stringify(selected.error)}
              </Banner>
            )}
            {selected.output_unavailable && (
              <Banner status="unknown">{t('connector:terminals.outputUnavailable')}</Banner>
            )}
            {selected.command && <p className={styles.secret}>{selected.command}</p>}
            {selected.cwd && (
              <p className={styles.notice}>{t('connector:terminals.cwd', { cwd: selected.cwd })}</p>
            )}
            {pages?.some((page) => page.output_lost) && (
              <Banner status="unknown">{t('connector:terminals.outputLost')}</Banner>
            )}
            <pre className={styles.terminalOutput}>
              {pages?.map((page) => page.output ?? '').join('')}
            </pre>
            {selected.completion && (
              <pre className={styles.terminalOutput}>
                {JSON.stringify(selected.completion, null, 2)}
              </pre>
            )}
            {error && <Banner status="unknown">{error}</Banner>}
            {control && (
              <Banner
                status={
                  controlUnknown
                    ? 'unknown'
                    : control.status === 'failed' || control.error
                      ? 'failed'
                      : 'done'
                }
              >
                {control.uncertain || ['unknown', 'not_found'].includes(control.status ?? '')
                  ? t('connector:terminals.stopUnconfirmed', { id: control.request_id })
                  : control.pending
                    ? t('connector:terminals.stopPending', { id: control.request_id })
                    : control.status
                      ? t('connector:terminals.stopReceipt', {
                          id: control.request_id,
                          status: control.status,
                        })
                      : t('connector:terminals.stopReceiptRead', { id: control.request_id })}
              </Banner>
            )}
            {control?.error && (
              <pre className={styles.terminalOutput}>{JSON.stringify(control.error, null, 2)}</pre>
            )}
          </>
        )}
      </Sheet>
    </>
  )
}
