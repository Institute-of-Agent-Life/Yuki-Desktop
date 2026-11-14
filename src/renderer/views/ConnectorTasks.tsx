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
import { Banner, Button, Segmented, Sheet, TextField } from '../components/Controls'
import { hidesPrivateData, unwrap } from '../queries/client'
import { Row } from './SettingsRow'
import styles from './Settings.module.css'
import { NativeRequest } from './NativeRequest'
import { ConnectorTerminals } from './ConnectorTerminals'
import activityStyles from './LocalComputer.module.css'
import { useTranslation } from '../i18n'

export function ConnectorTasks({
  connection,
  state,
}: {
  connection: Connection
  state: Extract<ConnectorState, { available: true }>
}) {
  const query = useQueryClient()
  const { t } = useTranslation(['connector', 'common'])
  const instances = (state.admission?.instances ?? []).filter((item) =>
    state.instances.some((local) => local.id === item.localId),
  )
  const catalogKnown = state.admission?.matched != null && Array.isArray(state.admission.instances)
  const [activity, setActivity] = useState<'native' | 'terminals'>('native')
  const [instance, setInstance] = useState(() => (instances.length === 1 ? instances[0]!.id : ''))
  const currentInstance = useRef(instance)
  currentInstance.current = instances.some((item) => item.id === instance) ? instance : ''
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
  useEffect(() => {
    if (catalogKnown && instance && !instances.some((item) => item.id === instance)) {
      setInstance('')
      setSession('')
      setSessions([])
      setCursor(undefined)
    }
  }, [catalogKnown, instance, instances])
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
      setError(failure instanceof Error ? failure.message : t('connector:tasks.unconfirmed'))
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
        ? t('connector:tasks.draft', { id: result.requestId })
        : result.state === 'submitted'
          ? t('connector:tasks.submitted', { id: result.requestId })
          : result.problem
            ? t('connector:tasks.ended', { id: result.requestId, problem: result.problem })
            : t('connector:tasks.accepted', { id: result.requestId, name: connection.name }),
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
      const target = instance
      const result = unwrap(
        await window.yuki.connector.sessions(
          connection.characterId,
          target,
          next ? (cursor ?? undefined) : undefined,
        ),
      )
      if (currentInstance.current !== target) return
      setSessions(next ? [...sessions, ...result.sessions] : result.sessions)
      setCursor(result.next_cursor)
    })
  // What a request just made answered: shown where it was made, over the receipt or on the page.
  const outcome = (
    <>
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
          {t('connector:tasks.verify')}
        </Button>
      )}
    </>
  )
  return (
    <>
      <Segmented
        label={t('connector:tasks.activity')}
        items={[
          { value: 'native', label: t('connector:tasks.native') },
          { value: 'terminals', label: t('connector:tasks.terminals') },
        ]}
        value={activity}
        onChange={setActivity}
      />
      <section
        role="tabpanel"
        hidden={activity !== 'native'}
        aria-label={t('connector:tasks.native')}
      >
        <div className={activityStyles.toolbar}>
          <h3>{t('connector:tasks.heading')}</h3>
          <Button
            variant="plain"
            disabled={busy || operations.isFetching || detail.isFetching}
            onClick={() => {
              void operations.refetch()
              if (selectedId) void detail.refetch()
            }}
          >
            {t('connector:refresh')}
          </Button>
        </div>
        <p className={styles.notice}>
          {instances.length
            ? t('connector:tasks.intro')
            : catalogKnown
              ? t('connector:tasks.noAgents')
              : t('connector:tasks.catalogUnknown')}
        </p>
        {!selectedId && outcome}
        {instances.length > 0 && (
          <>
            <Row title={t('connector:tasks.admittedAgents')}>
              <select
                aria-label={t('connector:tasks.agent')}
                value={instance}
                onChange={(event) => {
                  currentInstance.current = event.target.value
                  setInstance(event.target.value)
                  setSessions([])
                  setSession('')
                  setCursor(undefined)
                  setSelectedId(undefined)
                  setCwd('')
                }}
              >
                <option value="">{t('connector:tasks.chooseAgent')}</option>
                {instances.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} · {item.driver}
                  </option>
                ))}
              </select>
            </Row>
            <div className={styles.actions}>
              <Button disabled={busy || !instance} onClick={() => void loadSessions()}>
                {t('connector:tasks.loadSessions')}
              </Button>
              {cursor && (
                <Button disabled={busy} onClick={() => void loadSessions(true)}>
                  {t('connector:tasks.moreSessions')}
                </Button>
              )}
            </div>
            <Row title={t('connector:tasks.session')}>
              <select
                aria-label={t('connector:tasks.sessionLabel')}
                value={session}
                onChange={(event) => setSession(event.target.value)}
              >
                <option value="">{t('connector:tasks.newSession')}</option>
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
                <summary>{t('connector:tasks.cwdSummary')}</summary>
                <p className={styles.notice}>{t('connector:tasks.cwdHint')}</p>
                <Row title={t('connector:tasks.cwd')}>
                  <TextField
                    aria-label={t('connector:tasks.cwd')}
                    value={cwd}
                    onChange={(event) => setCwd(event.target.value)}
                    placeholder={t('connector:tasks.cwdPlaceholder')}
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
                    {t('connector:tasks.chooseFolder')}
                  </Button>
                </Row>
              </details>
            )}
            <Row title={t('connector:tasks.request')}>
              <TextField
                aria-label={t('connector:tasks.requestLabel')}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </Row>
            <div className={styles.actions}>
              <Button
                disabled={busy || !instance || !text.trim()}
                onClick={() => void perform(() => submit('prompt'))}
              >
                {t('connector:tasks.run')}
              </Button>
              <Button
                disabled={busy || !instance || !session}
                onClick={() => void perform(() => submit('watch'))}
              >
                {t('connector:tasks.watch')}
              </Button>
            </div>
          </>
        )}
        {operations.isError && (
          <Banner status="unknown">{t('connector:tasks.operationsUnavailable')}</Banner>
        )}
        <div className={styles.group}>
          {!hidesPrivateData(operations.error) &&
            operations.data?.pages
              .flatMap((page) => page.operations)
              .map((operation) => (
                <Row
                  key={operation.id}
                  title={operation.action ?? operation.id}
                  description={t('connector:tasks.operationDescription', {
                    work: operation.work_id ?? '—',
                    status: operation.status,
                  })}
                >
                  <Button disabled={busy} onClick={() => setSelectedId(operation.id)}>
                    {t('connector:tasks.viewReceipt')}
                  </Button>
                </Row>
              ))}
        </div>
        {!hidesPrivateData(operations.error) && operations.hasNextPage && (
          <Button
            disabled={busy || operations.isFetching}
            onClick={() => void operations.fetchNextPage()}
          >
            {t('connector:tasks.moreOperations')}
          </Button>
        )}
        {/* The original receipt opens over the list, where it was asked for. */}
        <Sheet
          title={t('connector:tasks.operation', { id: selectedId ?? '' })}
          open={!!selectedId}
          width={640}
          onClose={() => setSelectedId(undefined)}
          actions={
            <>
              {selected && (
                <>
                  <Button
                    disabled={busy || !text.trim()}
                    onClick={() => void perform(() => submit('queue', selected))}
                  >
                    {t('connector:tasks.queue')}
                  </Button>
                  <Button
                    disabled={busy || !text.trim()}
                    onClick={() => void perform(() => submit('steer', selected))}
                  >
                    {t('connector:tasks.steer')}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void perform(() => submit('detach', selected))}
                  >
                    {t('connector:tasks.detach')}
                  </Button>
                  <Button
                    disabled={busy}
                    variant="destructive"
                    onClick={() => void perform(() => submit('cancel', selected))}
                  >
                    {t('connector:tasks.cancel')}
                  </Button>
                </>
              )}
              <Button disabled={detail.isFetching} onClick={() => void detail.refetch()}>
                {t('connector:tasks.refreshReceipt')}
              </Button>
              <Button variant="primary" onClick={() => setSelectedId(undefined)}>
                {t('common:action.close')}
              </Button>
            </>
          }
        >
          {detail.isPending && <p role="status">{t('connector:tasks.readingReceipt')}</p>}
          {detail.isError && (
            <Banner status="unknown">{t('connector:tasks.receiptUnavailable')}</Banner>
          )}
          {outcome}
          {selected && (
            <>
              <p className={styles.notice}>
                {t('connector:statusLine', { status: selected.status })}
                {selected.uncertain && t('connector:tasks.resultUnconfirmed')}
                {selected.pending && t('connector:pendingFlag')}
                {' · '}
                {t('connector:tasks.sessionOf', {
                  id: selected.session_id ?? t('connector:tasks.unknownId'),
                })}
                {' · '}
                {t('connector:tasks.executionOf', {
                  id: selected.execution_id ?? t('connector:tasks.unknownId'),
                })}
              </p>
              <p className={styles.notice}>
                {typeof selected.result?.text === 'string' ? selected.result.text : ''}
              </p>
              {selected.result && (
                <details>
                  <summary>{t('connector:tasks.structuredReceipt')}</summary>
                  <pre className={styles.terminalOutput}>
                    {JSON.stringify(selected.result, null, 2)}
                  </pre>
                </details>
              )}
              <Row title={t('connector:tasks.followUp')}>
                <TextField
                  aria-label={t('connector:tasks.followUp')}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
              </Row>
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
                  {t('connector:tasks.moreProgress')}
                </Button>
              )}
            </>
          )}
        </Sheet>
      </section>
      <section
        role="tabpanel"
        hidden={activity !== 'terminals'}
        aria-label={t('connector:tasks.terminals')}
      >
        {state.deviceId && <ConnectorTerminals connection={connection} deviceId={state.deviceId} />}
      </section>
    </>
  )
}
