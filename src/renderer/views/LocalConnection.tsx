import { useCallback, useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, Laptop, RefreshCw, Trash2 } from 'lucide-react'
import type { Connection } from '../../shared/api'
import type {
  ExecutorAction,
  ExecutorGrant,
  ExecutorHistory,
  ExecutorOperation,
  ExecutorView,
} from '../../shared/executor'
import {
  Banner,
  Button,
  Sheet,
  Spinner,
  StatusPill,
  TextField,
  Toggle,
  type Status,
} from '../components/Controls'
import { ClientProblem, hidesPrivateData, problemText, unwrap } from '../queries/client'
import { useDisplayTime } from '../state/time'
import { Row } from './Settings'
import styles from './Settings.module.css'
import localStyles from './LocalConnection.module.css'

const digest = (value?: string) => value?.replace(/^sha256:/, '')
const same = (left: ExecutorGrant, right: ExecutorGrant) =>
  left.capability === right.capability &&
  left.scope?.alias === right.scope?.alias &&
  digest(left.scope?.digest) === digest(right.scope?.digest)
const label = (capability: string) =>
  ({
    'folder.read': '讀取檔案',
    'folder.write': '寫入檔案',
    'open.url': '開啟網址',
    'open.file': '開啟檔案',
    notify: '顯示通知',
  })[capability] ?? capability
function completion(operation: ExecutorOperation): { status: Status; text: string } {
  if (operation.state === 'unknown') return { status: 'unknown', text: '結果未確認' }
  if (operation.state === 'failed') return { status: 'failed', text: '未完成' }
  if (operation.state === 'awaiting_user')
    return { status: 'waiting', text: '等你在這台電腦上回應' }
  if (operation.state === 'succeeded')
    return operation.level === 'submitted'
      ? { status: 'running', text: '已交給系統' }
      : { status: 'done', text: operation.level === 'confirmed' ? '已確認' : '已完成' }
  return {
    status: 'running',
    text: operation.state === 'acknowledged' ? '進行中' : '等待此電腦接收',
  }
}
const failures: Record<string, string> = {
  scope_unavailable: '此資料夾的本機授權已失效。',
  permission_denied: '沒有這項本機授權。',
  already_exists: '檔案已存在，沒有覆寫。',
  not_found: '找不到指定位置。',
  read_only: '此位置目前只能讀取。',
  too_large: '內容超過讀取環境可接受的大小。',
  unsupported_url: '無法交給系統開啟這個網址。',
  not_a_file: '指定的位置不是一般檔案。',
  content_mismatch: '內容版本未能核對，沒有寫入。',
  open_failed: '系統未接受開啟要求。',
  notification_failed: '系統未接受通知要求。',
  unsupported_capability: '這個執行器尚不支援這項能力。',
  io_error: '本機讀寫未能完成。',
}

export function LocalConnection({
  connection,
  folderRequest = false,
  onFolderRequested,
}: {
  connection: Connection
  folderRequest?: boolean
  onFolderRequested?(): void
}) {
  const id = connection.characterId,
    query = useQueryClient(),
    { date } = useDisplayTime()
  const local = useQuery({
    queryKey: [id, 'executor-local'],
    queryFn: () => window.yuki.client.executorState(id).then(unwrap),
  })
  const executors = useQuery({
    queryKey: [id, 'executors'],
    retry: false,
    queryFn: () => window.yuki.client.read<ExecutorView[]>(id, { kind: 'executors' }).then(unwrap),
  })
  const requests = useQuery({
    queryKey: [id, 'executor-commands'],
    queryFn: () => window.yuki.client.executorCommands(id).then(unwrap),
  })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [folder, setFolder] = useState(folderRequest),
    [alias, setAlias] = useState('')
  const [remove, setRemove] = useState<ExecutorView>(),
    [history, setHistory] = useState<ExecutorView>()
  useEffect(() => {
    if (folderRequest) onFolderRequested?.()
  }, [folderRequest, onFolderRequested])
  const lost = hidesPrivateData(executors.error),
    rows = lost ? [] : (executors.data ?? [])
  const installation = local.data?.installation,
    current = rows.find((row) => row.executor_id === installation?.executorId)
  const pending = requests.data?.filter((item) => item.state !== 'result') ?? []
  const refresh = useCallback(
    () =>
      Promise.all(
        ['executor-local', 'executors', 'executor-commands'].map((key) =>
          query.invalidateQueries({ queryKey: [id, key] }),
        ),
      ),
    [id, query],
  )
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (character === id && ['executor', 'executor-local', 'sync', 'connection'].includes(kind))
          void refresh()
      }),
    [id, refresh],
  )
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof ClientProblem ? failure.message : problemText('internal_failure'))
    } finally {
      await refresh()
      setBusy(false)
    }
  }
  const act = async (action: ExecutorAction) => {
    const result = unwrap(await window.yuki.client.executorAction(id, action))
    if (result.problem) throw new ClientProblem(result.problem)
    if (result.state !== 'result') throw new ClientProblem('unknown')
  }
  const effective =
    current?.grants.filter((grant) =>
      installation?.consents.some((allowed) => same(grant, allowed)),
    ) ?? []
  const grant = (capability: string, enabled: boolean, scope?: { alias: string; digest: string }) =>
    run(async () => {
      const all = unwrap(await window.yuki.client.read<ExecutorView[]>(id, { kind: 'executors' }))
      const mine = all.find((row) => row.executor_id === installation?.executorId)
      if (!mine) throw new ClientProblem('not_found')
      const state = unwrap(await window.yuki.client.executorState(id))
      const item = { capability, ...(scope ? { scope } : {}) }
      const grants = mine.grants.filter(
        (allowed) =>
          !same(item, allowed) &&
          state.installation?.consents.some((consent) => same(allowed, consent)),
      )
      if (enabled) grants.push(item)
      await act({
        kind: 'grants',
        executorId: mine.executor_id,
        expectedRevision: mine.revision,
        grants,
      })
    })
  const addFolder = () =>
    run(async () => {
      const selected = unwrap(await window.yuki.client.pickExecutorFolder(id, alias))
      if (!selected) return
      const all = unwrap(await window.yuki.client.read<ExecutorView[]>(id, { kind: 'executors' }))
      const mine = all.find((row) => row.executor_id === installation?.executorId)
      if (!mine) return
      const state = unwrap(await window.yuki.client.executorState(id))
      const grants = mine.grants.filter((item) =>
        state.installation?.consents.some((allowed) => same(item, allowed)),
      )
      const reading = { capability: 'folder.read', scope: selected }
      if (!grants.some((item) => same(item, reading))) grants.push(reading)
      await act({
        kind: 'grants',
        executorId: mine.executor_id,
        expectedRevision: mine.revision,
        grants,
      })
      setFolder(false)
      setAlias('')
    })
  const removeFolder = (scope: { alias: string; digest: string }) =>
    run(async () => {
      if (!current) return
      unwrap(await window.yuki.client.removeExecutorFolder(id, scope.digest))
      await act({
        kind: 'grants',
        executorId: current.executor_id,
        expectedRevision: current.revision,
        grants: effective.filter((item) => digest(item.scope?.digest) !== digest(scope.digest)),
      })
    })
  const ownState: Status =
    local.data?.state === 'online'
      ? installation?.paused || current?.paused
        ? 'waiting'
        : 'done'
      : 'offline'
  return (
    <>
      {error && <Banner status="failed">{error}</Banner>}
      {(executors.isError || local.isError) && (
        <Banner status="offline">
          {lost ? '目前無法讀取本人的電腦資料。' : '暫時無法確認連線狀態。'}
        </Banner>
      )}
      <p className={styles.notice}>
        {connection.name}{' '}
        只會使用你允許的能力與資料夾。她不能透過這個連接觀看螢幕，檔案讀寫也不能超出所選範圍；你可隨時暫停。
      </p>
      {local.isPending || executors.isPending ? (
        <Spinner />
      ) : !installation ? (
        <div className={styles.group}>
          <Row
            title="連接這台電腦"
            description="App 執行時保持連線；關閉 App 後，新的操作會被告知離線。"
          >
            <Button
              variant="primary"
              loading={busy}
              disabled={busy || lost}
              onClick={() =>
                void run(async () => {
                  unwrap(await window.yuki.client.enableExecutor(id))
                })
              }
            >
              允許 {connection.name} 使用這台電腦
            </Button>
          </Row>
        </div>
      ) : (
        <>
          <div className={styles.group}>
            <Row
              title={current?.label ?? '這台電腦'}
              description={
                current?.last_seen_at
                  ? `最後連線 ${date(current.last_seen_at)}`
                  : '正在完成連線設定'
              }
            >
              <StatusPill status={ownState}>
                {installation.paused || current?.paused
                  ? '暫停'
                  : local.data?.state === 'online'
                    ? '可用'
                    : local.data?.state === 'connecting'
                      ? '連線中'
                      : '離線'}
              </StatusPill>
            </Row>
            <Row
              title="暫停本機連接"
              description="暫停期間不開始新的操作；已開始的會沿原操作收尾。"
            >
              <Toggle
                label="暫停本機連接"
                checked={installation.paused || current?.paused || false}
                disabled={busy || !current}
                onChange={(paused) =>
                  void run(() =>
                    act({ kind: paused ? 'pause' : 'resume', executorId: installation.executorId }),
                  )
                }
              />
            </Row>
          </div>
          {!installation.persistent && (
            <Banner status="waiting">
              系統憑據儲存目前不可用，只能在這次 App 執行期間使用。關閉後需移除舊紀錄，再重新允許。
            </Banner>
          )}
          {local.data?.problem && (
            <Banner status="offline">{problemText(local.data.problem)}</Banner>
          )}
          <h3>授權資料夾</h3>
          <div className={styles.group}>
            {!installation.scopes.length && (
              <p className={localStyles.empty}>尚未允許讀寫任何本機資料夾。</p>
            )}
            {installation.scopes.map((scope) => (
              <div className={localStyles.folder} key={`${scope.alias}/${scope.digest}`}>
                <div className={localStyles.folderName}>
                  <Folder size={16} strokeWidth={1.5} />
                  <span>{scope.alias}</span>
                </div>
                <div className={localStyles.permissions}>
                  {(['folder.read', 'folder.write', 'open.file'] as const).map((capability) => (
                    <label key={capability}>
                      <span>
                        {capability === 'folder.read'
                          ? '讀取'
                          : capability === 'folder.write'
                            ? '寫入'
                            : '開啟'}
                      </span>
                      <Toggle
                        label={`${label(capability)}：${scope.alias}`}
                        checked={effective.some((item) => same(item, { capability, scope }))}
                        disabled={busy || !current}
                        onChange={(enabled) => void grant(capability, enabled, scope)}
                      />
                    </label>
                  ))}
                  <Button
                    variant="plain"
                    aria-label={`移除資料夾授權：${scope.alias}`}
                    disabled={busy}
                    onClick={() => void removeFolder(scope)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button
            disabled={busy || !current}
            onClick={() => {
              setAlias('')
              setFolder(true)
            }}
          >
            新增資料夾…
          </Button>
          <h3>系統能力</h3>
          <div className={styles.group}>
            {(['open.url', 'notify'] as const).map((capability) => (
              <Row
                key={capability}
                title={label(capability)}
                description={
                  capability === 'open.url'
                    ? '交給預設瀏覽器；只回報已交給系統。'
                    : '使用系統通知；專注模式可能攔截。'
                }
              >
                <Toggle
                  label={`允許${label(capability)}`}
                  checked={effective.some((item) => same(item, { capability }))}
                  disabled={busy || !current}
                  onChange={(enabled) => void grant(capability, enabled)}
                />
              </Row>
            ))}
          </div>
          {current && (
            <div className={styles.actions}>
              <Button onClick={() => setHistory(current)}>操作紀錄</Button>
              <Button variant="destructive" disabled={busy} onClick={() => setRemove(current)}>
                移除此電腦…
              </Button>
            </div>
          )}
          {!current && executors.isSuccess && !executors.isError && (
            <>
              <Banner status="waiting">這台電腦的伺服器紀錄已移除，連線憑據無法再使用。</Banner>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => window.yuki.client.clearUnavailableExecutor(id).then(unwrap))
                }
              >
                清除此電腦的失效設定
              </Button>
            </>
          )}
        </>
      )}
      {pending.length > 0 && (
        <div className={styles.group}>
          {pending.map((item) => (
            <Row
              key={item.requestId}
              title="等伺服器確認這次變更"
              description="會以原請求查證，不另建相同操作。"
            >
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const value = unwrap(
                      await window.yuki.client.verifyExecutorCommand(id, item.requestId),
                    )
                    if (value.problem) throw new ClientProblem(value.problem)
                  })
                }
              >
                查證
              </Button>
            </Row>
          ))}
        </div>
      )}
      {rows.filter((row) => row.executor_id !== installation?.executorId).length > 0 && (
        <>
          <h3>本人的其他電腦</h3>
          <div className={styles.group}>
            {rows
              .filter((row) => row.executor_id !== installation?.executorId)
              .map((row) => (
                <div className={localStyles.other} key={row.executor_id}>
                  <div className={localStyles.otherHeading}>
                    <Laptop size={17} strokeWidth={1.5} />
                    <strong>{row.claimed ? row.label : '未完成設定的電腦'}</strong>
                    <StatusPill
                      status={
                        executors.isError
                          ? 'unknown'
                          : row.paused
                            ? 'waiting'
                            : row.online
                              ? 'done'
                              : 'offline'
                      }
                    >
                      {executors.isError
                        ? '無法確認'
                        : row.paused
                          ? '暫停'
                          : row.online
                            ? '可用'
                            : '離線'}
                    </StatusPill>
                  </div>
                  <p>
                    {row.claimed
                      ? `${row.platform === 'darwin' ? 'macOS' : row.platform === 'win32' ? 'Windows' : row.platform === 'linux' ? 'Linux' : row.platform} · ${row.last_seen_at ? `最後連線 ${date(row.last_seen_at)}` : '尚未連線'}`
                      : '尚未完成連線設定；離線時不接收新操作。'}
                  </p>
                  {!!row.grants.length && (
                    <p>
                      已授權：
                      {row.grants
                        .map((item) => item.scope?.alias ?? label(item.capability))
                        .filter((value, index, list) => list.indexOf(value) === index)
                        .join('、')}
                    </p>
                  )}
                  <div className={styles.actions}>
                    <Button onClick={() => setHistory(row)}>操作紀錄</Button>
                    <Button
                      disabled={busy || row.paused}
                      onClick={() =>
                        void run(() => act({ kind: 'pause', executorId: row.executor_id }))
                      }
                    >
                      暫停
                    </Button>
                    <Button variant="plain" disabled={busy} onClick={() => setRemove(row)}>
                      移除…
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
      <div className={styles.actions}>
        <Button
          variant="plain"
          disabled={busy || executors.isFetching}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          重新整理
        </Button>
      </div>
      <Sheet
        title="新增資料夾授權"
        open={folder && !!installation}
        onClose={() => {
          if (!busy) setFolder(false)
        }}
        actions={
          <>
            <Button disabled={busy} onClick={() => setFolder(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={busy}
              onClick={() => void addFolder()}
            >
              選擇資料夾…
            </Button>
          </>
        }
      >
        <p className={styles.notice}>
          選擇後先允許讀取；你可再開啟寫入與開啟檔案。真正位置只留在這台電腦，{connection.name}{' '}
          只會知道別名。
        </p>
        <label className={localStyles.alias}>
          資料夾別名（可選）
          <TextField
            value={alias}
            placeholder="使用資料夾名稱"
            onChange={(event) => setAlias(event.target.value)}
          />
        </label>
      </Sheet>
      <Sheet
        title={`移除 ${remove?.label ?? '電腦'}`}
        open={!!remove}
        onClose={() => {
          if (!busy) setRemove(undefined)
        }}
        actions={
          <>
            <Button disabled={busy} onClick={() => setRemove(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (remove) await act({ kind: 'delete', executorId: remove.executor_id })
                  setRemove(undefined)
                })
              }
            >
              移除
            </Button>
          </>
        }
      >
        <p>
          移除後將撤銷這個執行器的連線憑據。已開始的操作不會因此撤回，尚未傳回的結果可能無法確認。
        </p>
      </Sheet>
      {history && (
        <OperationHistory
          connection={connection}
          executor={history}
          close={() => setHistory(undefined)}
        />
      )}
    </>
  )
}

function OperationHistory({
  connection,
  executor,
  close,
}: {
  connection: Connection
  executor: ExecutorView
  close(): void
}) {
  const { date } = useDisplayTime(),
    query = useQueryClient(),
    id = connection.characterId
  const history = useInfiniteQuery({
    queryKey: [id, 'executor-history', executor.executor_id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      window.yuki.client
        .read<ExecutorHistory>(id, {
          kind: 'executor-operations',
          executorId: executor.executor_id,
          cursor: pageParam,
        })
        .then(unwrap),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
  })
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (character === id && ['executor', 'executor-local', 'sync'].includes(kind))
          void query.invalidateQueries({ queryKey: [id, 'executor-history', executor.executor_id] })
      }),
    [id, executor.executor_id, query],
  )
  const rows = hidesPrivateData(history.error)
    ? []
    : (history.data?.pages.flatMap((page) => page.items) ?? [])
  return (
    <Sheet
      title={`${executor.label} 的操作紀錄`}
      open
      onClose={close}
      width={640}
      actions={
        <Button variant="primary" onClick={close}>
          完成
        </Button>
      }
    >
      <div className={localStyles.history}>
        {history.isPending && <Spinner />}
        {history.isError && <Banner status="offline">暫時無法確認最新操作紀錄。</Banner>}
        {!history.isPending && !rows.length && <p className={styles.notice}>尚無操作紀錄。</p>}
        {rows.map((operation) => {
          const status = completion(operation),
            reason = operation.result.reason
          return (
            <article className={localStyles.operation} key={operation.op_id}>
              <div>
                <strong>{label(operation.capability)}</strong>
                <StatusPill status={status.status}>{status.text}</StatusPill>
              </div>
              {typeof operation.params.path === 'string' && <p>{operation.params.path}</p>}
              {typeof reason === 'string' && <p>{failures[reason] ?? '操作未能完成。'}</p>}
              {operation.state === 'unknown' &&
                operation.observation?.matches_intended === true && (
                  <p>目前檔案與要求內容相同；無法確認是這次操作寫入。</p>
                )}
              {operation.state === 'unknown' && operation.observation?.exists === false && (
                <p>目前沒有觀察到目標檔案。</p>
              )}
              <small>
                {date(operation.settled_at ?? operation.acknowledged_at ?? operation.created_at)}
              </small>
            </article>
          )
        })}
        {history.hasNextPage && (
          <Button
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            載入更早紀錄
          </Button>
        )}
      </div>
    </Sheet>
  )
}
