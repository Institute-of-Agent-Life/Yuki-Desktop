import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import { Banner, Button, EmptyState, Spinner } from '../components/Controls'
import { unwrap } from '../queries/client'
import { ConnectorTasks } from './ConnectorTasks'
import styles from './LocalComputer.module.css'

export function LocalComputer({
  connection,
  openSettings,
}: {
  connection: Connection
  openSettings(): void
}) {
  const query = useQueryClient()
  const state = useQuery({
    queryKey: ['desktop', 'agent-connector', connection.characterId],
    queryFn: () => window.yuki.connector.state(connection.characterId).then(unwrap),
    retry: false,
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
  if (state.isPending)
    return (
      <EmptyState title="這台電腦">
        <Spinner />
      </EmptyState>
    )
  if (!available?.paired || available.admission?.matched !== true)
    return (
      <EmptyState
        title={
          state.isError ? '無法確認這台電腦的連線狀態' : `這台電腦尚未連接到 ${connection.name}`
        }
        action={
          <Button variant="primary" onClick={openSettings}>
            前往設定
          </Button>
        }
      >
        {state.isError
          ? state.error.message
          : `連接後，${connection.name} 可以在這台電腦執行命令、使用 Codex、Claude 或 ACP Agent。`}
      </EmptyState>
    )
  return (
    <div className={styles.page}>
      {state.error && <Banner status="unknown">{state.error.message}</Banner>}
      <ConnectorTasks connection={connection} state={available} />
    </div>
  )
}
