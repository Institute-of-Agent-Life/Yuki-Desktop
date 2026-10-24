import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type {
  ConnectorCandidate,
  ConnectorDiagnostic,
  ConnectorServiceAction,
} from '../../shared/connector'
import { Banner, Button, Spinner, TextField } from '../components/Controls'
import { ClientProblem, unwrap } from '../queries/client'
import { Row } from './Settings'
import { ConnectorTasks } from './ConnectorTasks'
import styles from './Settings.module.css'

const problems: Record<string, string> = {
  connector_owner_mismatch:
    '這個連接器屬於其他伺服器或本人。原授權不會被覆寫；可以建立另一份獨立安裝。',
  native_login_required: '請先在原生 Codex 完成登入，再重新檢查。',
  native_not_installed: '原安裝位置已不存在，請重新選擇原生程式。',
  FileNotFoundError: '原生程式或專案路徑已不存在，請重新尋找 Codex，並檢查原專案資料夾。',
  native_owner_unavailable: '無法接通原生 Codex，請開啟它並重試。',
  connector_server_unreachable: '無法連到 Yuki 伺服器。請確認連線後重試。',
  connector_runtime_unavailable: '這個版本沒有附帶執行環境，請安裝完整的 Yuki Desktop 發行包。',
  connector_configuration_failed: '設定未保存，請重新選擇實際 Codex 程式與專案資料夾。',
  connector_authorization_failed: '電腦授權未完成，請確認目前的 Yuki 連線後重新授權。',
  connector_server_error:
    '伺服器未接納連接器，請確認同一個 Yuki 網址已提供 /agents/v1/ HTTPS 與 WebSocket 入口。',
  connector_other_server: '這份安裝連接另一個 Yuki 網址。請保留原安裝，為目前角色建立獨立安裝。',
  connector_other_person: '這份安裝屬於另一位本人。請保留原身份與回執，建立獨立安裝。',
  connector_runtime_platform: '這份連接器不適用於目前系統，請安裝對應平台的 Desktop 發行包。',
  connector_not_installed: '連接器原位置已不存在，請重新準備隨附連接器或選用原安裝。',
  connector_failed: '連接器操作未完成。請重新讀取原狀態，再繼續處理顯示的步驟。',
  connector_instance_missing:
    '這份原生設定已不存在，請重新讀取原設定；新增請明確選擇「改為新增」。',
}
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
  const [cwd, setCwd] = useState('')
  const [instanceId, setInstanceId] = useState('')
  const [create, setCreate] = useState(true)
  const [instanceLabel, setInstanceLabel] = useState('本機 Codex')
  const [diagnostic, setDiagnostic] = useState<ConnectorDiagnostic>()
  const [externalPython, setExternalPython] = useState('')
  const [externalData, setExternalData] = useState('')
  const [manualServer, setManualServer] = useState('')
  const [manualCode, setManualCode] = useState('')
  const available = state.data?.available ? state.data : undefined
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
    const found = unwrap(await window.yuki.connector.discover())
    setCandidates(found)
    setCandidateId(found.length === 1 ? found[0]!.id : '')
    if (!found.length)
      setNotice('沒有找到已安裝的 Codex。請先開啟原生 Codex，或選擇它的實際執行檔。')
  }
  const save = (start: boolean, existingSession = false) => {
    const id = instanceId || crypto.randomUUID()
    setInstanceId(id)
    return perform(async () => {
      const result = unwrap(
        await window.yuki.connector.configure(
          {
            id,
            create,
            ...(candidateId ? { candidateId } : { command }),
            label: instanceLabel,
            ...(!existingSession && cwd ? { cwd } : {}),
          },
          start,
        ),
      )
      setInstanceId(result.instanceId)
      setCreate(false)
      setNotice(
        start
          ? existingSession
            ? '原設定已保存，背景連接已啟動。請在下方讀取並選擇原生會話。'
            : '原設定已保存，背景連接已啟動。伺服器與 Codex 狀態以實際接納結果為準。'
          : '原設定已保存。啟動背景連接即可套用；不會重新派發原任務。',
      )
    })
  }
  return (
    <>
      <p className={styles.notice}>
        連接器使用你已安裝、已登入的原生 Agent。登入、會話和原生權限仍由原程式管理；關閉 Desktop
        不會停止獨立連接器。
      </p>
      {error && <Banner status="failed">{error}</Banner>}
      {notice && <Banner status="done">{notice}</Banner>}
      {state.isError && (
        <Banner status="unknown">無法讀取原連接器，請確認執行環境仍在原位置。</Banner>
      )}
      {state.isPending && <Spinner />}
      {state.data &&
        (!available?.paired || (available.admission?.matched && !available.instances.length)) && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (connection && (authorized || consent))
                void perform(async () => {
                  unwrap(
                    await window.yuki.connector.connect({
                      characterId: connection.characterId,
                      label,
                    }),
                  )
                  await discoverCandidates()
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
                    連接本機 Codex
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
              伺服器接納尚未確認（{available.admission.problem}）。本機服務狀態仍可讀取與管理。
            </Banner>
          )}
          <div className={styles.group}>
            <Row title="連接器版本" description={available.runtime}>
              <span>
                {available.version} · 協議 {available.protocol ?? '未提供'}
              </span>
            </Row>
            <Row title="原安裝資料" description={available.dataDirectory}>
              <span>{available.deviceId ?? '尚未配對'}</span>
            </Row>
            {available.paired && (
              <Row title="授權來源" description={available.server}>
                <span>{available.admission?.matched ? '目前本人' : '尚未確認目前本人'}</span>
              </Row>
            )}
            <Row title="背景服務" description={available.service.executable}>
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
            <Row title="伺服器連接器協議">
              <span>{serverProtocol ?? '尚未提供；可更新 Yuki 後重新讀取。'}</span>
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
              <p className={styles.notice}>
                可明確改用隨附版本，沿用原資料、身份和回執；原 Python 安裝不會被修改。
              </p>
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
          {available.paired && available.admission?.matched === false && (
            <>
              <Banner status="unknown">原安裝屬於另一個授權來源，原身份及回執會保留。</Banner>
              <Button
                loading={busy}
                onClick={() =>
                  void perform(async () => {
                    unwrap(await window.yuki.connector.install(true))
                  })
                }
              >
                建立另一份獨立安裝
              </Button>
            </>
          )}
          {available.paired && (
            <>
              <h3>本機 Agent 與專案</h3>
              <div className={styles.group}>
                {available.instances.map((instance) => {
                  const remote = available.admission?.instances?.find(
                    (item) => item.localId === instance.id,
                  )
                  return (
                    <Row
                      key={instance.id}
                      title={instance.label}
                      description={`${instance.command ?? instance.driver} · ${instance.cwd ?? ''}`}
                    >
                      <span>
                        {!remote
                          ? '伺服器尚未接納此 Codex'
                          : remote.status !== 'available'
                            ? `Codex 尚未就緒：${problems[remote.errorType ?? ''] ?? remote.errorType ?? remote.status ?? '未提供原因'}`
                            : remote.online
                              ? 'Codex 原生連線已建立'
                              : 'Codex 目前離線；上次已就緒'}
                      </span>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setInstanceId(instance.id)
                          setCreate(false)
                          setInstanceLabel(instance.label)
                          setCommand(instance.command ?? '')
                          setCwd(instance.cwd ?? '')
                          setCandidateId('')
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
                <div className={styles.actions}>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void perform(discoverCandidates)}
                  >
                    尋找已安裝的 Codex
                  </Button>
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
                </div>
                {candidates.length > 1 && (
                  <Row title="Codex 安裝">
                    <select
                      aria-label="Codex 安裝"
                      value={candidateId}
                      onChange={(event) => setCandidateId(event.target.value)}
                    >
                      <option value="">自行選擇執行檔</option>
                      {candidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label} · {item.command}
                        </option>
                      ))}
                    </select>
                  </Row>
                )}
                {candidates.length === 1 && candidateId && (
                  <Row title="已找到 Codex" description={candidates[0]!.command}>
                    <span>{candidates[0]!.label}</span>
                  </Row>
                )}
                {!candidateId && <p className={styles.link}>{command || '尚未選擇程式'}</p>}
                <Row title="顯示名稱">
                  <TextField
                    aria-label="Agent 顯示名稱"
                    value={instanceLabel}
                    onChange={(event) => setInstanceLabel(event.target.value)}
                    required
                  />
                </Row>
                <Row title="專案資料夾" description={cwd || '尚未選擇'}>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const path = unwrap(await window.yuki.connector.chooseProject())
                        if (path) setCwd(path)
                      })
                    }
                  >
                    選擇資料夾
                  </Button>
                </Row>
                <div className={styles.actions}>
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={!cwd || (!candidateId && !command)}
                  >
                    {instanceId ? '保存並重新連接' : '使用此專案並啟動背景連接'}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy || (!candidateId && !command)}
                    onClick={() => void save(true, true)}
                  >
                    使用已有 Codex 會話
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
                        setInstanceLabel('本機 Codex')
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
                後繼續工作。停止或移除連接器只中斷遠端連線，不等於取消原生任務。
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
        <summary>進階：接入原有安裝</summary>
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
              unwrap(await window.yuki.client.external('https://developers.openai.com/codex/cli/'))
            })
          }
        >
          Codex 安裝說明
        </Button>
        {onUpdates && <Button onClick={onUpdates}>Desktop 更新與安裝包</Button>}
      </div>
    </>
  )
}
