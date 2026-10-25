import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type {
  ConnectorCandidate,
  ConnectorDiagnostic,
  ConnectorDriver,
  ConnectorServiceAction,
} from '../../shared/connector'
import { Banner, Button, Spinner, TextField } from '../components/Controls'
import { ClientProblem, problemText, unwrap } from '../queries/client'
import { Row } from './SettingsRow'
import { ConnectorTasks } from './ConnectorTasks'
import styles from './Settings.module.css'

const problems: Record<string, string> = {
  unknown: '本機連接器操作未確認，請重新讀取狀態。',
  connector_runtime_invalid: '隨附連接器的檔案不完整，請重新安裝完整的 Yuki Desktop 發行包。',
  connector_owner_mismatch:
    '這個連接器屬於其他伺服器或本人。原授權不會被覆寫；可以建立另一份獨立安裝。',
  native_login_required: '請先在原生 Agent 完成登入，再重新檢查。',
  native_not_installed: '原安裝位置已不存在，請重新選擇原生程式。',
  FileNotFoundError: '原生程式或原會話的工作位置已不存在，請核對原安裝或會話。',
  native_owner_unavailable: '無法接通原生 Agent，請開啟它並重試。',
  native_diagnostic_failed:
    '原生診斷命令未完成或此版本不支援，登入狀態尚未確認。請查看原生程式的診斷結果。',
  connector_server_unreachable: '無法連到 Yuki 伺服器。請確認連線後重試。',
  connector_runtime_unavailable: '這個版本沒有附帶執行環境，請安裝完整的 Yuki Desktop 發行包。',
  connector_configuration_failed: '設定未保存，請重新選擇實際的原生程式。',
  connector_authorization_failed: '電腦授權未完成，請確認目前的 Yuki 連線後重新授權。',
  connector_server_error:
    '伺服器未接納連接器，請確認同一個 Yuki 網址已提供 /agents/v1/ HTTPS 與 WebSocket 入口。',
  connector_other_server:
    '這份安裝連接另一個 Yuki 網址。請保留原安裝，為目前的 Yuki 建立獨立安裝。',
  connector_other_person: '伺服器目前未提供這份原連接。原身份與回執會保留，可以建立新連接。',
  connector_runtime_platform: '這份連接器不適用於目前系統，請安裝對應平台的 Desktop 發行包。',
  connector_not_installed: '連接器原位置已不存在，請重新準備隨附連接器或選用原安裝。',
  connector_existing_runtime_unavailable:
    '已發現原連接器資料，但無法找到它實際使用的執行環境。請在進階設定指定原安裝；原資料與服務會保留。',
  connector_failed: '連接器操作未完成。請重新讀取原狀態，再繼續處理顯示的步驟。',
  connector_instance_missing:
    '這份原生設定已不存在，請重新讀取原設定；新增請明確選擇「改為新增」。',
  connector_update_required:
    '原連接器版本尚未支援這項原生工具功能，請先更新連接器；原身份與操作記錄會保留。',
}
const driverName = (driver: string) =>
  driver === 'codex' ? 'Codex' : driver === 'claude' ? 'Claude' : driver

const stages: Record<string, string> = {
  prepare: '準備執行環境',
  authorize: '目前本人授權',
  pair: '電腦配對',
  configure: '保存原生設定',
  'service-stop': '停止原背景連接',
  'service-install': '安裝背景連接',
  'service-start': '啟動背景連接',
}
export function AgentConnector({
  connection,
  deviceLabel,
  onUpdates,
}: {
  connection?: Connection
  deviceLabel: string
  onUpdates?(): void
}) {
  const query = useQueryClient()
  const key = ['desktop', 'agent-connector', connection?.characterId]
  const state = useQuery({
    queryKey: key,
    queryFn: () => window.yuki.connector.state(connection?.characterId).then(unwrap),
    retry: false,
  })
  const [label, setLabel] = useState(deviceLabel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [consent, setConsent] = useState(false)
  const [candidates, setCandidates] = useState<ConnectorCandidate[]>([])
  const [candidateId, setCandidateId] = useState('')
  const [command, setCommand] = useState('')
  const [driver, setDriver] = useState<ConnectorDriver>('codex')
  const [instanceId, setInstanceId] = useState('')
  const [create, setCreate] = useState(true)
  const [instanceLabel, setInstanceLabel] = useState('本機 Codex')
  const [diagnostic, setDiagnostic] = useState<ConnectorDiagnostic>()
  const [externalPython, setExternalPython] = useState('')
  const [externalData, setExternalData] = useState('')
  const [manualServer, setManualServer] = useState('')
  const [manualCode, setManualCode] = useState('')
  const available = state.data?.available ? state.data : undefined
  const existing = state.data?.available === false ? state.data.existing : undefined
  const installation = available ?? existing?.state
  const original = available?.instances.find((item) => item.id === instanceId)
  const nativeName = driverName(original?.driver ?? driver)
  const supportsDiscovery = !original || ['codex', 'claude'].includes(original.driver)
  const authorized = available?.paired && available.admission?.matched === true
  const serverProtocol = available?.admission?.serverProtocol
  const perform = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (failure) {
      setError(
        failure instanceof ClientProblem
          ? `${failure.reason && stages[failure.reason] ? stages[failure.reason] + '：' : ''}${problems[failure.code] ?? failure.message}`
          : '操作未確認，請重新讀取原狀態。',
      )
    } finally {
      await query.invalidateQueries({ queryKey: key })
      setBusy(false)
    }
  }
  const service = (action: ConnectorServiceAction) =>
    perform(async () => {
      unwrap(await window.yuki.connector.service(action))
    })
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (
          character === connection?.characterId &&
          ['sync', 'refresh', 'work', 'conversation'].includes(kind)
        ) {
          const filter = { queryKey: ['desktop', 'agent-connector', character], exact: true }
          const refresh = () => query.invalidateQueries(filter, { cancelRefetch: false })
          const pending = query.getQueryCache().find(filter)?.promise
          if (pending) void pending.then(refresh, () => {})
          else void refresh()
        }
      }),
    [connection?.characterId, query],
  )
  const discoverCandidates = async () => {
    const found = unwrap(await window.yuki.connector.discover(driver))
    setCandidates(found)
    setCandidateId(found.length === 1 ? found[0]!.id : '')
    if (!found.length)
      setNotice(
        `沒有找到已安裝的 ${driverName(driver)}。請先安裝並登入，或在進階設定選擇實際執行檔。`,
      )
    return found
  }
  const configure = async (start: boolean, discoveredId = candidateId) => {
    const id = instanceId || crypto.randomUUID()
    setInstanceId(id)
    const result = unwrap(
      await window.yuki.connector.configure(
        {
          id,
          create,
          ...(discoveredId ? { candidateId: discoveredId } : { command }),
          ...(create ? { driver } : {}),
          label: instanceLabel,
        },
        start,
      ),
    )
    setInstanceId(result.instanceId)
    setCreate(false)
    setNotice(
      start
        ? '原設定已保存，背景連接已啟動。你可以交代任務，或讀取已有會話。'
        : '原設定已保存。啟動背景連接即可套用；不會重新派發原任務。',
    )
  }
  const save = (start: boolean) => perform(() => configure(start))
  return (
    <>
      <p className={styles.notice}>
        讓 {connection?.name ?? 'Yuki'} 使用這台電腦上已登入的 Codex 或
        Claude。先建立連接即可交代任務， 不需要預先選專案；原生帳號、會話與權限仍由原程式管理。
      </p>
      <Row title="原生工具">
        <select
          aria-label="原生工具類型"
          value={original?.driver ?? driver}
          disabled={busy || !!original}
          onChange={(event) => {
            const next = event.target.value as ConnectorDriver
            if (instanceLabel === `本機 ${driverName(driver)}`)
              setInstanceLabel(`本機 ${driverName(next)}`)
            setDriver(next)
            setCandidates([])
            setCandidateId('')
            setCommand('')
          }}
        >
          <option value="codex">Codex</option>
          <option value="claude">Claude</option>
          {original && original.driver !== 'codex' && original.driver !== 'claude' && (
            <option value={original.driver}>{driverName(original.driver)}（原設定）</option>
          )}
        </select>
      </Row>
      {error && <Banner status="failed">{error}</Banner>}
      {notice && <Banner status="done">{notice}</Banner>}
      {state.isError && (
        <Banner status="unknown">
          {state.error instanceof ClientProblem
            ? (problems[state.error.code] ?? problemText(state.error.code))
            : '無法讀取原連接器，請確認執行環境仍在原位置。'}
        </Banner>
      )}
      {state.isPending && <Spinner />}
      {existing && (
        <div className={styles.group}>
          <Row title="已發現原有 Agent 連接" description={existing.state.server}>
            <Button
              loading={busy}
              onClick={() =>
                void perform(async () => {
                  unwrap(await window.yuki.connector.useInstallation(existing.installation))
                })
              }
            >
              使用已有連接
            </Button>
          </Row>
          <p className={styles.notice}>沿用原安裝、授權與操作記錄，不會重新配對或啟停原服務。</p>
        </div>
      )}
      {installation?.paired && installation.admission?.matched === false && (
        <>
          <Banner status="unknown">目前的 Yuki 未接納原連接，原身份與回執會保留。</Banner>
          <Button
            loading={busy}
            onClick={() =>
              void perform(async () => {
                unwrap(await window.yuki.connector.install(true))
              })
            }
          >
            建立新連接
          </Button>
        </>
      )}
      {state.data &&
        !existing?.state.paired &&
        (!available?.paired || (available.admission?.matched && !available.instances.length)) && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (connection && (authorized || consent))
                void perform(async () => {
                  const connected = unwrap(
                    await window.yuki.connector.connect({
                      characterId: connection.characterId,
                      label,
                    }),
                  )
                  const found = await discoverCandidates()
                  if (connected.available && !connected.instances.length && found.length === 1)
                    await configure(true, found[0]!.id)
                })
            }}
          >
            <Row title="這台電腦的名稱">
              <TextField
                aria-label="電腦名稱"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                required
              />
            </Row>
            {connection ? (
              <>
                <p className={styles.notice}>
                  允許 {connection.name}（{connection.baseUrl}
                  ）以你目前的本人身份連接這台電腦。之後的 Agent 操作依原生權限處理。
                </p>
                {!authorized && (
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    我允許這個 Yuki 連接本機 Agent
                  </label>
                )}
                <div className={styles.actions}>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    disabled={!authorized && !consent}
                  >
                    連接本機 {driverName(driver)}
                  </Button>
                </div>
              </>
            ) : (
              <p className={styles.notice}>先連接一位 Yuki，再授權這台電腦。你可以直接離開此頁。</p>
            )}
          </form>
        )}
      {available && (
        <>
          {available.admission?.problem && (
            <Banner status="unknown">
              伺服器接納尚未確認：
              {problems[available.admission.problem] ?? problemText(available.admission.problem)}
              可按「重新讀取狀態」再確認；本機服務仍可管理。
            </Banner>
          )}
          <div className={styles.group}>
            {available.paired && (
              <Row title="授權來源" description={available.server}>
                <span>{available.admission?.matched ? '目前本人' : '尚未確認目前本人'}</span>
              </Row>
            )}
            <Row title="背景服務">
              <span>
                {!available.service.installed
                  ? '尚未安裝'
                  : available.service.running === true
                    ? '執行中'
                    : available.service.running === false
                      ? '已停止'
                      : '狀態未知'}
              </span>
            </Row>
            <Row title="伺服器接納">
              <span>{available.admission?.connected ? '已連線' : '尚未確認連線'}</span>
            </Row>
          </div>
          {available.protocol !== undefined &&
            serverProtocol !== undefined &&
            available.protocol !== serverProtocol && (
              <Banner status="unknown">
                {available.protocol < serverProtocol
                  ? `這台電腦的連接器協議 ${available.protocol}，伺服器使用 ${serverProtocol}。請更新 Yuki Desktop 與隨附連接器；原身份與回執會保留。`
                  : `這台電腦的連接器協議 ${available.protocol}，伺服器使用 ${serverProtocol}。請更新 Yuki 伺服器以支援協議 ${available.protocol}；不需要重新配對。`}
                {available.protocol < serverProtocol && onUpdates && (
                  <Button onClick={onUpdates}>查看 Desktop 更新</Button>
                )}
              </Banner>
            )}
          {available.updateAvailable && (
            <Button
              loading={busy}
              onClick={() =>
                void perform(async () => {
                  unwrap(await window.yuki.connector.install())
                })
              }
            >
              更新連接器並保留原身份與回執
            </Button>
          )}
          {available.managed === false && (
            <>
              <p className={styles.notice}>可改用桌面隨附的版本，沿用原安裝的授權與操作記錄。</p>
              <Button
                loading={busy}
                onClick={() =>
                  void perform(async () => {
                    unwrap(await window.yuki.connector.adopt())
                  })
                }
              >
                改用隨附版本，保留原資料
              </Button>
            </>
          )}
          {available.paired && (
            <>
              <h3>已連接的原生工具</h3>
              <div className={styles.group}>
                {available.instances.map((instance) => {
                  const remote = available.admission?.instances?.find(
                    (item) => item.localId === instance.id,
                  )
                  return (
                    <Row
                      key={instance.id}
                      title={instance.label}
                      description={driverName(instance.driver)}
                    >
                      <span>
                        {!remote
                          ? '伺服器尚未接納此 Agent'
                          : remote.status !== 'available'
                            ? `${driverName(instance.driver)} 尚未就緒：${problems[remote.errorType ?? ''] ?? remote.errorType ?? remote.status ?? '未提供原因'}`
                            : remote.online
                              ? `${driverName(instance.driver)} 原生連線已建立`
                              : `${driverName(instance.driver)} 目前離線；上次已就緒`}
                      </span>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setInstanceId(instance.id)
                          setCreate(false)
                          setInstanceLabel(instance.label)
                          setCommand(instance.command ?? '')
                          if (instance.driver === 'codex' || instance.driver === 'claude')
                            setDriver(instance.driver)
                          setCandidateId('')
                          setCandidates([])
                        }}
                      >
                        修改原設定
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            setDiagnostic(unwrap(await window.yuki.connector.diagnose(instance.id)))
                          })
                        }
                      >
                        檢查原生就緒
                      </Button>
                      <Button
                        disabled={busy || !instance.command}
                        onClick={() =>
                          void perform(async () => {
                            unwrap(await window.yuki.connector.revealNative(instance.id))
                          })
                        }
                      >
                        開啟原生程式位置
                      </Button>
                    </Row>
                  )
                })}
              </div>
              {diagnostic && (
                <Banner status={diagnostic.available ? 'done' : 'unknown'}>
                  {diagnostic.available
                    ? '原生握手與帳戶檢查完成；尚未執行模型任務。'
                    : (problems[diagnostic.problem ?? ''] ?? `尚未就緒（${diagnostic.problem}）。`)}
                </Banner>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void save(true)
                }}
              >
                {supportsDiscovery && (
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => void perform(discoverCandidates)}
                    >
                      尋找已安裝的 {nativeName}
                    </Button>
                  </div>
                )}
                {candidates.length > 1 && (
                  <Row title={`${nativeName} 安裝`}>
                    <select
                      aria-label={`${nativeName} 安裝`}
                      value={candidateId}
                      onChange={(event) => setCandidateId(event.target.value)}
                    >
                      <option value="">自行選擇執行檔</option>
                      {candidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Row>
                )}
                {candidates.length === 1 && candidateId && (
                  <Row title={`已找到 ${nativeName}`}>
                    <span>{candidates[0]!.label}</span>
                  </Row>
                )}
                <Row title="顯示名稱">
                  <TextField
                    aria-label="Agent 顯示名稱"
                    value={instanceLabel}
                    onChange={(event) => setInstanceLabel(event.target.value)}
                    required
                  />
                </Row>
                <details>
                  <summary>進階：手動選擇原生程式</summary>
                  <p className={styles.link}>{command || '尚未手動選擇程式'}</p>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const path = unwrap(await window.yuki.connector.chooseExecutable())
                        if (path) {
                          setCommand(path)
                          setCandidateId('')
                        }
                      })
                    }
                  >
                    選擇原生執行檔
                  </Button>
                </details>
                <div className={styles.actions}>
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={busy || (!candidateId && !command)}
                  >
                    {instanceId ? '保存並重新連接' : `連接此 ${nativeName} 並啟動背景連接`}
                  </Button>
                  {instanceId && (
                    <Button type="button" disabled={busy} onClick={() => void save(false)}>
                      只保存原設定
                    </Button>
                  )}
                  {instanceId && (
                    <Button
                      type="button"
                      onClick={() => {
                        setInstanceId('')
                        setCreate(true)
                        setInstanceLabel(`本機 ${driverName(driver)}`)
                        setCommand('')
                        setCandidateId('')
                      }}
                    >
                      改為新增
                    </Button>
                  )}
                </div>
              </form>
              <div className={styles.actions}>
                {!available.service.installed && (
                  <Button disabled={busy} onClick={() => void service('install')}>
                    安裝目前使用者的背景服務
                  </Button>
                )}
                <Button
                  disabled={busy || !available.service.installed}
                  onClick={() => void service('start')}
                >
                  啟動連接器
                </Button>
                <Button
                  disabled={busy || !available.service.installed}
                  onClick={() => void service('stop')}
                >
                  停止連接器
                </Button>
              </div>
              <p className={styles.notice}>
                背景連接在關閉 Desktop
                後繼續工作。停止連接器會中斷連線；原生執行是否持續依各工具生命週期處理，停止前請查看原任務狀態。
              </p>
              {connection && available.admission?.matched && (
                <ConnectorTasks
                  key={connection.characterId + available.deviceId}
                  connection={connection}
                  state={available}
                />
              )}
            </>
          )}
        </>
      )}
      <details>
        <summary>進階：安裝與原有連接</summary>
        {available && (
          <div className={styles.group}>
            <Row title="連接器版本" description={available.runtime}>
              <span>
                {available.version} · 協議 {available.protocol ?? '未提供'}
              </span>
            </Row>
            <Row title="原安裝資料" description={available.dataDirectory}>
              <span>{available.deviceId ?? '尚未配對'}</span>
            </Row>
            <Row title="伺服器連接器協議">
              <span>{serverProtocol ?? '尚未提供；可更新 Yuki 後重新讀取。'}</span>
            </Row>
          </div>
        )}
        <p className={styles.notice}>
          選擇原連接器使用的 Python 和資料目錄。保留原身份、設定與
          journal，不複製憑據，也不替換此安裝的 Python。
        </p>
        <Row title="原 Python 絕對路徑">
          <TextField
            aria-label="原 Python 絕對路徑"
            value={externalPython}
            onChange={(event) => setExternalPython(event.target.value)}
          />
        </Row>
        <Row title="原資料目錄">
          <TextField
            aria-label="原資料目錄"
            value={externalData}
            onChange={(event) => setExternalData(event.target.value)}
          />
        </Row>
        <Button
          disabled={busy || !externalPython || !externalData}
          onClick={() =>
            void perform(async () => {
              unwrap(
                await window.yuki.connector.useInstallation({
                  executable: externalPython,
                  dataDirectory: externalData,
                }),
              )
            })
          }
        >
          讀取並選用原安裝
        </Button>
        {available?.service.installed && (
          <Button disabled={busy} onClick={() => void service('uninstall')}>
            移除所選安裝的使用者服務
          </Button>
        )}
      </details>
      {available && !available.paired && (
        <details>
          <summary>進階：手動專用授權碼</summary>
          <p className={styles.notice}>
            僅接受 connector 用途的電腦授權碼；聊天配對碼不能使用。提交後立即清除輸入。
          </p>
          <Row title="原伺服器位址">
            <TextField
              aria-label="手動 Connector 伺服器"
              type="url"
              value={manualServer}
              onChange={(event) => setManualServer(event.target.value)}
            />
          </Row>
          <Row title="電腦授權碼">
            <TextField
              aria-label="手動 Connector 授權碼"
              type="password"
              autoComplete="off"
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
            />
          </Row>
          <Button
            disabled={busy || !manualServer || !manualCode}
            onClick={() => {
              const code = manualCode
              setManualCode('')
              void perform(async () => {
                unwrap(await window.yuki.connector.pair({ server: manualServer, label, code }))
              })
            }}
          >
            使用專用碼連接
          </Button>
        </details>
      )}
      <div className={styles.actions}>
        <Button disabled={busy || state.isFetching} onClick={() => void state.refetch()}>
          重新讀取狀態
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              unwrap(
                await window.yuki.client.external(
                  driver === 'claude'
                    ? 'https://code.claude.com/docs/en/setup'
                    : 'https://developers.openai.com/codex/cli/',
                ),
              )
            })
          }
        >
          {driverName(driver)} 安裝說明
        </Button>
        {onUpdates && <Button onClick={onUpdates}>Desktop 更新與安裝包</Button>}
      </div>
    </>
  )
}
