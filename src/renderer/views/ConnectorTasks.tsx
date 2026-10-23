import { useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type {
  ConnectorOperation,
  ConnectorSession,
  ConnectorState,
  ConnectorTarget,
  ConnectorSubmission,
} from '../../shared/connector'
import { Banner, Button, TextField } from '../components/Controls'
import { unwrap } from '../queries/client'
import { Row } from './Settings'
import styles from './Settings.module.css'
import { NativeRequest } from './NativeRequest'

export function ConnectorTasks({
  connection,
  state,
}: {
  connection: Connection
  state: Extract<ConnectorState, { available: true }>
}) {
  const [instance, setInstance] = useState('')
  const [sessions, setSessions] = useState<ConnectorSession[]>([])
  const [cursor, setCursor] = useState<string | null>()
  const [session, setSession] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<ConnectorOperation>()
  const [receipt, setReceipt] = useState<ConnectorSubmission>()
  const submittedPayload = useRef('')
  const submittedText = useRef('')
  const operations = useInfiniteQuery({
    queryKey: ['connector-operations', connection.characterId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      window.yuki.connector.operations(connection.characterId, undefined, pageParam).then(unwrap),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    retry: false,
  })
  const instances = state.admission?.instances ?? []
  const local = state.instances.find(
    (item) => item.id === instances.find((item) => item.id === instance)?.localId,
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
      ...(!operation && !session && local?.cwd ? { cwd: local.cwd } : {}),
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
      <h3>原生任務</h3>
      <p className={styles.notice}>
        要求仍由這位 Yuki 的 Main / Work
        處理。原生任務、持續觀察、停止觀察與取消是不同操作；原始狀態可能仍待確認。
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
      <Row title="伺服器已接納的 Agent">
        <select
          aria-label="任務 Agent"
          value={instance}
          onChange={(event) => {
            setInstance(event.target.value)
            setSessions([])
            setSession('')
            setCursor(undefined)
            setSelected(undefined)
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
          <option value="">在設定的專案建立新會話</option>
          {sessions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label ?? item.id}
              {item.status ? ` · ${item.status}` : ''}
            </option>
          ))}
        </select>
      </Row>
      {!session && (
        <p className={styles.link}>
          {local?.cwd ?? '請先設定此 Agent 的專案資料夾，或選擇原有會話。'}
        </p>
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
          disabled={busy || !instance || !text.trim() || (!session && !local?.cwd)}
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
      <div className={styles.actions}>
        <Button disabled={busy || operations.isFetching} onClick={() => void operations.refetch()}>
          重新讀取原操作
        </Button>
      </div>
      {operations.isError && <Banner status="unknown">原操作目錄暫時無法讀取。</Banner>}
      <div className={styles.group}>
        {operations.data?.pages
          .flatMap((page) => page.operations)
          .filter((operation) => instances.some((item) => item.id === operation.instance_id))
          .map((operation) => (
            <Row
              key={operation.id}
              title={operation.action ?? operation.id}
              description={`Work ${operation.work_id ?? '—'} · ${operation.status}`}
            >
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    setSelected(
                      unwrap(
                        await window.yuki.connector.operation(connection.characterId, operation.id),
                      ),
                    )
                  })
                }
              >
                查看原回執
              </Button>
            </Row>
          ))}
      </div>
      {operations.hasNextPage && (
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
          {selected.next_cursor !== undefined && (
            <Button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const next = unwrap(
                    await window.yuki.connector.operation(
                      connection.characterId,
                      selected.id,
                      selected.next_cursor,
                    ),
                  )
                  setSelected({
                    ...next,
                    events: [...(selected.events ?? []), ...(next.events ?? [])],
                  })
                })
              }
            >
              讀取後續進度
            </Button>
          )}
        </>
      )}
    </>
  )
}
