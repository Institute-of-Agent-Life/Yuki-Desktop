import { useState } from 'react'
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
  native_owner_unavailable: '無法接通原生 Codex，請開啟它並重試。',
  connector_server_unreachable: '無法連到 Yuki 伺服器。請確認連線後重試。',
  connector_runtime_unavailable: '此開發版本沒有附帶執行環境，請使用完整發行包。',
}
export function AgentConnector({
  connection,
  deviceLabel,
}: {
  connection?: Connection
  deviceLabel: string
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
  const [instanceLabel, setInstanceLabel] = useState('本機 Codex')
  const [diagnostic, setDiagnostic] = useState<ConnectorDiagnostic>()
  const [externalPython, setExternalPython] = useState('')
  const [externalData, setExternalData] = useState('')
  const [manualServer, setManualServer] = useState('')
  const [manualCode, setManualCode] = useState('')
  const available = state.data?.available ? state.data : undefined
  const perform = async (operation: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await operation()
      await query.invalidateQueries({ queryKey: key })
    } catch (failure) {
      setError(
        failure instanceof ClientProblem
          ? (problems[failure.code] ?? failure.message)
          : '操作未確認，請重新讀取原狀態。',
      )
    } finally {
      setBusy(false)
    }
  }
  const service = (action: ConnectorServiceAction) =>
    perform(async () => {
      unwrap(await window.yuki.connector.service(action))
    })
  const discover = () =>
    perform(async () => {
      const found = unwrap(await window.yuki.connector.discover())
      setCandidates(found)
      setCandidateId(found.length === 1 ? found[0]!.id : '')
      if (!found.length)
        setNotice('沒有找到已安裝的 Codex。請先安裝原生 Codex，或選擇它的實際執行檔。')
    })
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
      {state.data?.available === false && (
        <Button
          loading={busy}
          onClick={() =>
            void perform(async () => {
              unwrap(await window.yuki.connector.install())
            })
          }
        >
          準備本機連接器
        </Button>
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
          </div>
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
                圖形化設定需要新版連接器。可明確改用隨附版本，沿用原資料、身份和回執；原 Python
                安裝不會被修改。
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
          {!available.paired && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (connection)
                  void perform(async () => {
                    unwrap(
                      await window.yuki.connector.connect({
                        characterId: connection.characterId,
                        label,
                      }),
                    )
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
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    我允許這個 Yuki 連接本機 Agent
                  </label>
                  <div className={styles.actions}>
                    <Button type="submit" variant="primary" loading={busy} disabled={!consent}>
                      連接目前的 Yuki
                    </Button>
                  </div>
                </>
              ) : (
                <p className={styles.notice}>
                  先連接一位 Yuki，再授權這台電腦。你可以直接離開此頁。
                </p>
              )}
            </form>
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
                {available.instances.map((instance) => (
                  <Row
                    key={instance.id}
                    title={instance.label}
                    description={`${instance.command ?? instance.driver} · ${instance.cwd ?? ''}`}
                  >
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setInstanceId(instance.id)
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
                  </Row>
                ))}
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
                  void perform(async () => {
                    unwrap(
                      await window.yuki.connector.configure({
                        ...(instanceId ? { id: instanceId } : {}),
                        ...(candidateId ? { candidateId } : { command }),
                        label: instanceLabel,
                        cwd,
                      }),
                    )
                    setNotice(
                      '原設定已保存。請啟動背景服務；若服務正在執行，停止後再啟動即可套用。',
                    )
                  })
                }}
              >
                <div className={styles.actions}>
                  <Button type="button" disabled={busy} onClick={() => void discover()}>
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
                {!!candidates.length && (
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
                    {instanceId ? '保存原 Agent 設定' : '加入本機 Codex'}
                  </Button>
                  {instanceId && (
                    <Button
                      type="button"
                      onClick={() => {
                        setInstanceId('')
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
              <p className={styles.notice}>停止或移除連接器只中斷遠端連線，不等於取消原生任務。</p>
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
      </div>
    </>
  )
}
