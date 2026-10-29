import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type { ConnectorTerminalControl } from '../../shared/connector'
import { Banner, Button } from '../components/Controls'
import { hidesPrivateData, unwrap } from '../queries/client'
import { Row } from './SettingsRow'
import styles from './Settings.module.css'

export function ConnectorTerminals({
  connection,
  deviceId,
}: {
  connection: Connection
  deviceId: string
}) {
  const query = useQueryClient()
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
      setError(failure instanceof Error ? failure.message : '取消回執尚未確認。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h3>這台電腦的終端任務</h3>
      <p className={styles.notice}>
        查看 Yuki 在這台電腦啟動的原執行、輸出與完成回執。關閉完整訪問後仍可讀取與停止原執行。
      </p>
      <Button
        disabled={directory.isFetching || detail.isFetching}
        onClick={() => {
          void directory.refetch()
          if (runId) void detail.refetch()
        }}
      >
        重新讀取終端任務
      </Button>
      {directory.isError && <Banner status="unknown">終端目錄暫時無法讀取。</Banner>}
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
                  查看終端回執
                </Button>
              </Row>
            ))}
      </div>
      {!hidesPrivateData(directory.error) && directory.hasNextPage && (
        <Button disabled={directory.isFetching} onClick={() => void directory.fetchNextPage()}>
          更多終端任務
        </Button>
      )}
      {detail.isError && <Banner status="unknown">原終端回執暫時無法讀取。</Banner>}
      {selected && (
        <>
          <h3>原終端執行 {selected.run_id}</h3>
          <p className={styles.notice}>
            狀態：{selected.status}
            {selected.pending ? '（等待後續回執）' : ''}
            {selected.uncertain ? '（尚未確認）' : ''}
            {selected.exit_code !== undefined && selected.exit_code !== null
              ? ` · 退出碼 ${selected.exit_code}`
              : ''}
          </p>
          {selected.error && (
            <Banner status={selected.uncertain ? 'unknown' : 'failed'}>
              {typeof selected.error === 'string' ? selected.error : JSON.stringify(selected.error)}
            </Banner>
          )}
          {selected.output_unavailable && (
            <Banner status="unknown">原執行狀態已保留，當前無法讀取本機輸出。</Banner>
          )}
          {selected.command && <p className={styles.secret}>{selected.command}</p>}
          {selected.cwd && <p className={styles.notice}>工作位置：{selected.cwd}</p>}
          {pages?.some((page) => page.output_lost) && (
            <Banner status="unknown">
              部分輸出已超出本機保留範圍；原執行狀態與完成回執仍保留。
            </Banner>
          )}
          <pre className={styles.terminalOutput}>
            {pages?.map((page) => page.output ?? '').join('')}
          </pre>
          {selected.completion && (
            <pre className={styles.terminalOutput}>
              {JSON.stringify(selected.completion, null, 2)}
            </pre>
          )}
          <div className={styles.actions}>
            {detail.hasNextPage && (
              <Button disabled={detail.isFetching} onClick={() => void detail.fetchNextPage()}>
                讀取後續終端輸出
              </Button>
            )}
            <Button variant="destructive" disabled={busy} onClick={() => void act(false)}>
              {controlUnknown ? '重送原停止請求' : '停止原終端執行'}
            </Button>
            {control && (
              <Button disabled={busy} onClick={() => void act(true)}>
                查證原停止請求
              </Button>
            )}
          </div>
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
              停止請求 {control.request_id}：
              {control.uncertain || ['unknown', 'not_found'].includes(control.status ?? '')
                ? '結果尚未確認，請查證原請求。'
                : control.pending
                  ? '已接納，等待原停止回執。'
                  : `原回執 ${control.status ?? '已讀取'}`}
              。進程是否結束以原終端狀態為準。
            </Banner>
          )}
          {control?.error && (
            <pre className={styles.terminalOutput}>{JSON.stringify(control.error, null, 2)}</pre>
          )}
        </>
      )}
    </>
  )
}
