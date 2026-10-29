import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type {
  ConnectorOperation,
  ConnectorSession,
  ConnectorState,
  ConnectorTarget,
  ConnectorSubmission,
} from '../../shared/connector'
import { Banner, Button, TextField } from '../components/Controls'
import { hidesPrivateData, unwrap } from '../queries/client'
import { Row } from './SettingsRow'
import styles from './Settings.module.css'
import { NativeRequest } from './NativeRequest'
import { ConnectorTerminals } from './ConnectorTerminals'

export function ConnectorTasks({
  connection,
  state,
}: {
  connection: Connection
  state: Extract<ConnectorState, { available: true }>
}) {
  const query = useQueryClient()
  const [instance, setInstance] = useState('')
  const [sessions, setSessions] = useState<ConnectorSession[]>([])
  const [cursor, setCursor] = useState<string | null>()
  const [session, setSession] = useState('')
  const [text, setText] = useState('')
  const [cwd, setCwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string>()
  const [receipt, setReceipt] = useState<ConnectorSubmission>()
  const submittedPayload = useRef('')
  const submittedText = useRef('')
  const operations = useInfiniteQuery({
    queryKey: ['connector-operations', connection.characterId, state.deviceId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      window.yuki.connector
        .operations(connection.characterId, undefined, pageParam, state.deviceId)
        .then(unwrap),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    retry: false,
  })
  const detail = useInfiniteQuery({
    queryKey: ['connector-operation', connection.characterId, selectedId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      window.yuki.connector.operation(connection.characterId, selectedId!, pageParam).then(unwrap),
    getNextPageParam: (page, _pages, cursor) =>
      page.next_cursor !== cursor ? page.next_cursor : undefined,
    enabled: !!selectedId,
    retry: false,
  })
  const pages = hidesPrivateData(detail.error) ? undefined : detail.data?.pages
  const latest = pages?.at(-1)
  const selected = latest
    ? { ...latest, events: pages!.flatMap((page) => page.events ?? []) }
    : undefined
  const instances = state.admission?.instances ?? []
  useEffect(() => {
    if (!instance && instances.length === 1) setInstance(instances[0]!.id)
  }, [instance, instances])
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (
          character === connection.characterId &&
          ['sync', 'refresh', 'work', 'conversation'].includes(kind)
        ) {
          for (const key of ['connector-operations', 'connector-operation']) {
            const filter = { queryKey: [key, character] }
            const refresh = () => query.invalidateQueries(filter, { cancelRefetch: false })
            const pending = query.getQueryCache().find({ ...filter, type: 'active' })?.promise
            if (pending) void pending.then(refresh, () => {})
            else void refresh()
          }
        }
      }),
    [connection.characterId, query],
  )
  const perform = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作未確認，請重新查詢原紀錄。')
    } finally {
      setBusy(false)
    }
  }
  const showReceipt = (result: ConnectorSubmission) => {
    setReceipt(result)
    if (
      (result.state === 'accepted' || result.state === 'result') &&
      !result.problem &&
      text === submittedText.current
    )
      setText('')
    setMessage(
      result.state === 'draft'
        ? `要求只保存在本機（${result.requestId}），尚未提交。`
        : result.state === 'submitted'
          ? `要求已送出，接納尚待查證（${result.requestId}）。`
          : result.problem
            ? `原請求已結束（${result.requestId}）：${result.problem}`
            : `要求已交給 ${connection.name}（請求 ${result.requestId}）；原生執行結果請查看原操作回執。`,
    )
  }
  const verify = () =>
    perform(async () => {
      if (receipt)
        showReceipt(
          unwrap(await window.yuki.client.verify(connection.characterId, receipt.requestId)),
        )
    })
  const submit = async (
    intent: ConnectorTarget['intent'],
    operation?: ConnectorOperation,
    extra: Partial<ConnectorTarget> = {},
  ) => {
    const target: ConnectorTarget = {
      device_id: state.deviceId!,
      instance_id: operation?.instance_id ?? instance,
      intent,
      ...(operation?.session_id
        ? { session_id: operation.session_id }
        : session
          ? { session_id: session }
          : {}),
      ...(operation?.execution_id ? { execution_id: operation.execution_id } : {}),
      ...(operation ? { operation_id: operation.id } : {}),
      ...(!operation && !session && cwd ? { cwd } : {}),
      ...extra,
    }
    const input = {
      text:
        text.trim() ||
        `請${intent === 'detach' ? '停止觀察' : intent === 'cancel' ? '取消' : '繼續處理'}原生任務`,
      agentTarget: target,
    }
    const payload = JSON.stringify(input)
    if (
      receipt &&
      (receipt.state === 'draft' || receipt.state === 'submitted') &&
      submittedPayload.current === payload
    ) {
      showReceipt(
        unwrap(await window.yuki.client.verify(connection.characterId, receipt.requestId)),
      )
      return
    }
    const result = unwrap(await window.yuki.connector.submit(connection.characterId, input))
    submittedPayload.current = payload
    submittedText.current = text
    showReceipt(result)
    if (
      (result.state === 'accepted' || result.state === 'result') &&
      !result.problem &&
      (intent === 'prompt' || intent === 'queue' || intent === 'steer')
    )
      setText('')
    await operations.refetch()
  }
  const loadSessions = (next = false) =>
    perform(async () => {
      const result = unwrap(
        await window.yuki.connector.sessions(
          connection.characterId,
          instance,
          next ? (cursor ?? undefined) : undefined,
        ),
      )
      setSessions(next ? [...sessions, ...result.sessions] : result.sessions)
      setCursor(result.next_cursor)
    })
  return (
    <>
      {state.deviceId && <ConnectorTerminals connection={connection} deviceId={state.deviceId} />}
      <h3>原生任務</h3>
      <p className={styles.notice}>
        {instances.length
          ? '直接交代任務，或選擇已有會話繼續處理。工作位置可以省略，權限沿用原生設定。停止觀察會保留原任務；取消會向原生 Agent 請求中止本次執行，已啟動的獨立背景程式可能繼續運行。結果以原生回執為準。'
          : '尚未設定原生 Agent，可在上方選配 Codex、Claude 或 ACP。這不影響已開啟完整訪問的 Shell、檔案與本機程式操作；原有操作回執仍保留在下方。'}
      </p>
      {error && <Banner status="failed">{error}</Banner>}
      {message && (
        <Banner
          status={
            receipt?.state === 'draft' || receipt?.state === 'submitted'
              ? 'unknown'
              : receipt?.problem
                ? 'failed'
                : 'done'
          }
        >
          {message}
        </Banner>
      )}
      {receipt && (receipt.state === 'draft' || receipt.state === 'submitted') && (
        <Button disabled={busy} onClick={() => void verify()}>
          查證原請求
        </Button>
      )}
      {instances.length > 0 && (
        <>
          <Row title="伺服器已接納的 Agent">
            <select
              aria-label="任務 Agent"
              value={instance}
              onChange={(event) => {
                setInstance(event.target.value)
                setSessions([])
                setSession('')
                setCursor(undefined)
                setSelectedId(undefined)
                setCwd('')
              }}
            >
              <option value="">選擇 Agent</option>
              {instances.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.driver}
                </option>
              ))}
            </select>
          </Row>
          <div className={styles.actions}>
            <Button disabled={busy || !instance} onClick={() => void loadSessions()}>
              讀取原生會話
            </Button>
            {cursor && (
              <Button disabled={busy} onClick={() => void loadSessions(true)}>
                更多會話
              </Button>
            )}
          </div>
          <Row title="會話">
            <select
              aria-label="原生會話"
              value={session}
              onChange={(event) => setSession(event.target.value)}
            >
              <option value="">建立新會話（使用原生預設）</option>
              {sessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label ?? item.id}
                  {item.status ? ` · ${item.status}` : ''}
                </option>
              ))}
            </select>
          </Row>
          {!session && (
            <details>
              <summary>工作位置（可選）</summary>
              <p className={styles.notice}>
                省略時使用原生預設。選擇已有會話時，保留該會話原本的工作位置。
              </p>
              <Row title="本次任務工作位置">
                <TextField
                  aria-label="本次任務工作位置"
                  value={cwd}
                  onChange={(event) => setCwd(event.target.value)}
                  placeholder="可省略"
                />
                <Button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const selected = unwrap(await window.yuki.connector.chooseProject())
                      if (selected) setCwd(selected)
                    })
                  }
                >
                  選擇資料夾
                </Button>
              </Row>
            </details>
          )}
          <Row title="給 Yuki 的要求">
            <TextField
              aria-label="原生任務要求"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Row>
          <div className={styles.actions}>
            <Button
              disabled={busy || !instance || !text.trim()}
              onClick={() => void perform(() => submit('prompt'))}
            >
              交給 Yuki 執行
            </Button>
            <Button
              disabled={busy || !instance || !session}
              onClick={() => void perform(() => submit('watch'))}
            >
              接續觀察此會話
            </Button>
          </div>
        </>
      )}
      <div className={styles.actions}>
        <Button
          disabled={busy || operations.isFetching || detail.isFetching}
          onClick={() => {
            void operations.refetch()
            if (selectedId) void detail.refetch()
          }}
        >
          重新讀取原操作
        </Button>
      </div>
      {operations.isError && <Banner status="unknown">原操作目錄暫時無法讀取。</Banner>}
      {detail.isError && <Banner status="unknown">原回執尚未讀取完成，請重新讀取原操作。</Banner>}
      <div className={styles.group}>
        {!hidesPrivateData(operations.error) &&
          operations.data?.pages
            .flatMap((page) => page.operations)
            .map((operation) => (
              <Row
                key={operation.id}
                title={operation.action ?? operation.id}
                description={`Work ${operation.work_id ?? '—'} · ${operation.status}`}
              >
                <Button disabled={busy} onClick={() => setSelectedId(operation.id)}>
                  查看原回執
                </Button>
              </Row>
            ))}
      </div>
      {!hidesPrivateData(operations.error) && operations.hasNextPage && (
        <Button
          disabled={busy || operations.isFetching}
          onClick={() => void operations.fetchNextPage()}
        >
          更多原操作
        </Button>
      )}
      {selected && (
        <>
          <h3>原操作 {selected.id}</h3>
          <p className={styles.notice}>
            狀態：{selected.status}
            {selected.uncertain ? '（結果尚未確認）' : ''}
            {selected.pending ? '（等待後續回執）' : ''} · 會話 {selected.session_id ?? '未知'} ·
            執行 {selected.execution_id ?? '未知'}
          </p>
          <p className={styles.notice}>
            {typeof selected.result?.text === 'string' ? selected.result.text : ''}
          </p>
          {selected.result && (
            <details>
              <summary>原結構化回執</summary>
              <pre className={styles.terminalOutput}>
                {JSON.stringify(selected.result, null, 2)}
              </pre>
            </details>
          )}
          <div className={styles.actions}>
            <Button
              disabled={busy || !text.trim()}
              onClick={() => void perform(() => submit('queue', selected))}
            >
              排入原會話
            </Button>
            <Button
              disabled={busy || !text.trim()}
              onClick={() => void perform(() => submit('steer', selected))}
            >
              調整原任務
            </Button>
            <Button disabled={busy} onClick={() => void perform(() => submit('detach', selected))}>
              停止觀察
            </Button>
            <Button
              disabled={busy}
              variant="destructive"
              onClick={() => void perform(() => submit('cancel', selected))}
            >
              請求取消原生執行
            </Button>
          </div>
          {selected.events?.map((event) => (
            <NativeRequest
              key={event.cursor}
              event={event}
              busy={busy}
              onRespond={(extra) => perform(() => submit('respond', selected, extra))}
            />
          ))}
          {detail.hasNextPage && (
            <Button
              disabled={busy || detail.isFetching}
              onClick={() => void detail.fetchNextPage()}
            >
              讀取後續進度
            </Button>
          )}
        </>
      )}
    </>
  )
}
