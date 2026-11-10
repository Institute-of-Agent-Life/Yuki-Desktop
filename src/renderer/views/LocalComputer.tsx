import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type { ConnectorHolder } from '../../shared/connector'
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
      <EmptyState title="這台電腦">
        <Spinner />
      </EmptyState>
    )
  if (!available?.deviceId)
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
          : `連接後，${connection.name} 可以在這台電腦執行命令、使用 Codex、Claude Code 或支援 ACP 的 Agent。`}
      </EmptyState>
    )
  return (
    <div className={styles.page}>
      {state.error && <Banner status="unknown">{state.error.message}</Banner>}
      {available.admission?.matched !== true && (
        <Banner status="unknown">目前尚未接納這份電腦連線；已保存的本人紀錄仍可查詢。</Banner>
      )}
      {available.supervision?.link === 'authorization_lost' && (
        <Banner status="failed">
          授權已撤銷：伺服器拒絕了這台電腦的連接器憑據。已保存的本人紀錄仍可查詢。
          <Button onClick={openSettings}>前往設定</Button>
        </Banner>
      )}
      {available.supervision?.restartPending && (
        <Banner status="waiting">
          本機連接器非預期結束，正在重新啟動（已重新啟動 {available.supervision.restarts} 次）。
          <Button onClick={openSettings}>查看診斷</Button>
        </Banner>
      )}
      {control.error && <Banner status="failed">{control.error.message}</Banner>}
      {supervision?.control?.holder === 'owner' ? (
        <Banner status="waiting">
          已按「停止」叫停。Yuki 不會操作滑鼠、鍵盤或瀏覽器；在聊天裡請 Yuki 繼續，或按「繼續」。
          <Button disabled={control.isPending} onClick={() => control.mutate('none')}>
            繼續
          </Button>
        </Banner>
      ) : (
        supervision?.activity && (
          <Banner status="running">
            {supervision.activity.tool === 'browser'
              ? 'Yuki 正在操作瀏覽器。'
              : supervision.activity.background
                ? 'Yuki 正在背景操作一個視窗，不動你的滑鼠和前台視窗；你在同一個 App 裡操作時它會暫停。'
                : 'Yuki 正在操作電腦；你操作時它會暫停，停手後繼續。'}
            <Button disabled={control.isPending} onClick={() => control.mutate('owner')}>
              停止
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
