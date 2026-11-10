import { useEffect, useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type {
  ConnectorAvailableState,
  ConnectorCandidate,
  ConnectorDiagnostic,
  ConnectorDriver,
  ConnectorInstance,
  ConnectorPermission,
  ConnectorState,
} from '../../shared/connector'
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
import { ClientProblem, problemText, unwrap } from '../queries/client'
import { Row, SettingsSection } from './SettingsRow'
import styles from './Settings.module.css'

const problems: Record<string, string> = {
  native_daemon_start_failed: '原生服務未能啟動，請檢查所選程式及其原生設定。',
  native_protocol_unsupported: '所選程式回報的協議版本不相容。',
  native_session_error: '原生程式拒絕建立或載入該會話，請查看原程式的設定。',
  connector_reload_required: '原連接器尚不支援即時套用，請在原服務重新載入設定後確認。',
  connector_catalog_unconfirmed: '尚未確認執行中的連接器已套用設定',
  invalid_server: '遠端位址請使用 https://；連向這台電腦時才可使用 http://。',
  unknown: '本機連接器操作未確認，請重新開啟設定確認。',
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
  connector_other_person: '伺服器目前未提供這份原連接。原身份與回執會保留，可以建立新連接。',
  connector_runtime_platform: '這份連接器不適用於目前系統，請安裝對應平台的 Desktop 發行包。',
  connector_not_installed: '連接器原位置已不存在，請重新準備隨附連接器或選用原安裝。',
  connector_existing_runtime_unavailable:
    '已發現原連接器資料，但無法找到它實際使用的執行環境。請在進階設定指定原安裝；原資料與服務會保留。',
  connector_failed: '連接器操作未完成。請確認連線，再繼續處理顯示的步驟。',
  connector_instance_missing:
    '這份原生設定已不存在，請關閉編輯視窗，再選擇「新增 Agent」建立新設定。',
  connector_update_required:
    '原連接器版本尚未支援這項功能，請先更新連接器；原身份與操作記錄會保留。',
  connector_invalid_response:
    '無法解析連接器回傳的資料，請重新開啟設定或更新連接器。原設定會保留。',
}
const driverName = (driver: string) =>
  driver === 'codex'
    ? 'Codex'
    : driver === 'claude'
      ? 'Claude Code'
      : driver === 'acp'
        ? 'ACP'
        : driver
const defaultAgentName = (driver: ConnectorDriver) =>
  driver === 'acp' ? '我的 Agent' : `本機 ${driverName(driver)}`

const summary = (state: ConnectorState | undefined): { text: string; status: Status } => {
  if (!state) return { text: '讀取中', status: 'unknown' }
  const installation = state.available ? state : state.existing?.state
  if (!installation) return { text: '尚未連接', status: 'offline' }
  if (installation.paired && installation.admission?.matched === false)
    return { text: '已連接到其他 Yuki', status: 'failed' }
  if (installation.updateAvailable) return { text: '需要更新', status: 'waiting' }
  if (!state.available) return { text: '發現原有連接', status: 'waiting' }
  if (!installation.paired) return { text: '尚未連接', status: 'offline' }
  const supervision = installation.supervision
  if (supervision?.link === 'authorization_lost') return { text: '授權已撤銷', status: 'failed' }
  if (supervision?.link === 'protocol_unsupported')
    return { text: '連接器協議不相容', status: 'failed' }
  if (supervision?.restartPending) return { text: '連接器重新啟動中', status: 'waiting' }
  if (installation.running === false) return { text: '本機連接已停止', status: 'waiting' }
  if (supervision?.link === 'disconnected')
    return { text: '連線中斷，正在重新連線', status: 'waiting' }
  return installation.admission?.connected
    ? { text: '已連線', status: 'done' }
    : { text: '尚未確認連線', status: 'unknown' }
}
// The Connector's own state lines; older Connectors report none.
const linkText = (installation: ConnectorAvailableState) => {
  const supervision = installation.supervision
  if (supervision?.restartPending) return '等待重新啟動'
  if (installation.running !== true) return '未執行'
  switch (supervision?.link) {
    case 'connected':
      return '已連線'
    case 'disconnected':
      return '連線中斷，正在重新連線'
    case 'authorization_lost':
      return '授權已撤銷'
    case 'protocol_unsupported':
      return '協議不相容'
    default:
      return '執行中，尚未回報連線狀態'
  }
}

// macOS asks for both when the Connector, a child of Yuki.app, looks at or uses the screen.
const macPermissions: { permission: ConnectorPermission; title: string; description: string }[] = [
  { permission: 'screen', title: '螢幕錄製', description: '讓 Yuki 看到這台電腦的畫面。' },
  { permission: 'input', title: '輔助使用', description: '讓 Yuki 操作滑鼠與鍵盤。' },
]

type Feedback = {
  section: 'status' | 'permission' | 'agents' | 'installation' | 'server'
  text: string
}

const stages: Record<string, string> = {
  server: '儲存連接器位址',
  prepare: '準備執行環境',
  authorize: '目前本人授權',
  pair: '電腦配對',
  configure: '保存原生設定',
  read: '讀取連接器狀態',
  discover: '尋找原生程式',
  diagnose: '檢查原生狀態',
  'service-stop': '停止本機連接',
  'service-uninstall': '移除原自啟動服務',
  'service-start': '啟動本機連接',
  'full-access': '本機完整訪問',
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
  const [error, setError] = useState<Feedback>()
  const [notice, setNotice] = useState<Feedback>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [removing, setRemoving] = useState<ConnectorInstance>()
  const editorForm = useId()
  const [serverAddress, setServerAddress] = useState<string>()
  const serverForm = useId()
  const [consent, setConsent] = useState(false)
  const [candidates, setCandidates] = useState<ConnectorCandidate[]>([])
  const [candidateId, setCandidateId] = useState('')
  const [command, setCommand] = useState('')
  const [commandChanged, setCommandChanged] = useState(false)
  const [labelChanged, setLabelChanged] = useState(false)
  const [agentArgs, setAgentArgs] = useState<string[]>([])
  const [argsChanged, setArgsChanged] = useState(false)
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
  const supportsDiscovery = ['codex', 'claude'].includes(original?.driver ?? driver)
  const serverProtocol = available?.admission?.serverProtocol
  const status = summary(state.data)
  const perform = async (
    operation: () => Promise<unknown>,
    section: Feedback['section'] = 'status',
  ) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await operation()
    } catch (failure) {
      setError({
        section,
        text:
          failure instanceof ClientProblem
            ? `${failure.reason && stages[failure.reason] ? stages[failure.reason] + '：' : ''}${problems[failure.code] ?? failure.message}`
            : '操作未確認，請重新開啟設定確認。',
      })
    } finally {
      await query.invalidateQueries({ queryKey: key })
      setBusy(false)
    }
  }
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
      setNotice({
        section: 'agents',
        text: `沒有找到已安裝的 ${driverName(driver)}。請先安裝並登入，或在進階設定選擇實際執行檔。`,
      })
    return found
  }
  const configure = async (discoveredId = candidateId) => {
    const id = instanceId || crypto.randomUUID()
    setInstanceId(id)
    const result = unwrap(
      await window.yuki.connector.configure(
        {
          id,
          create,
          ...(discoveredId
            ? { candidateId: discoveredId }
            : create || commandChanged
              ? { command }
              : {}),
          ...(create ? { driver } : {}),
          ...((create && driver === 'acp') || argsChanged ? { args: agentArgs } : {}),
          ...(create || labelChanged ? { label: instanceLabel } : {}),
        },
        connection?.characterId,
      ),
    )
    setInstanceId(result.instanceId)
    setCreate(false)
    setArgsChanged(false)
    setCommandChanged(false)
    setLabelChanged(false)
    setNotice({
      section: 'agents',
      text: result.catalogProblem
        ? `設定已保存，尚未確認連線套用結果：${problems[result.catalogProblem] ?? result.catalogProblem}。`
        : '設定已保存；原生狀態依實際連線結果確認。',
    })
  }
  const save = () =>
    perform(async () => {
      await configure()
      setEditorOpen(false)
    }, 'agents')
  const remove = () =>
    perform(async () => {
      const result = unwrap(
        await window.yuki.connector.remove(removing!.id, connection?.characterId),
      )
      setRemoving(undefined)
      if (instanceId === result.instanceId) setEditorOpen(false)
      setNotice({
        section: 'agents',
        text: result.catalogProblem
          ? `設定已刪除，尚未確認連線同步：${problems[result.catalogProblem] ?? result.catalogProblem}。`
          : 'Agent 設定已刪除，原生程式與歷史紀錄保留。',
      })
    }, 'agents')
  const feedback = (section: Feedback['section']) => (
    <>
      {error?.section === section && <Banner status="failed">{error.text}</Banner>}
      {notice?.section === section && <Banner status="done">{notice.text}</Banner>}
    </>
  )
  const executableSelection = (
    <>
      <p className={styles.nativePath}>
        {(candidateId ? candidates.find((item) => item.id === candidateId)?.command : command) ||
          '尚未選擇'}
      </p>
      <Button
        type="button"
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            const path = unwrap(await window.yuki.connector.chooseExecutable())
            if (path) {
              setCommand(path)
              setCommandChanged(true)
              setCandidateId('')
            }
          }, 'agents')
        }
      >
        選擇程式
      </Button>
    </>
  )
  return (
    <>
      <p className={styles.notice}>
        讓 {connection?.name ?? 'Yuki'} 使用這台電腦的命令、檔案與已安裝程式。原生 Agent 是可選的。
      </p>
      {available &&
        available.protocol !== undefined &&
        serverProtocol !== undefined &&
        available.protocol !== serverProtocol && (
          <Banner status="unknown">
            {available.protocol < serverProtocol
              ? `這台電腦的連接器協議 ${available.protocol}，伺服器使用 ${serverProtocol}。請更新 Yuki Desktop 與隨附連接器；原身份與回執會保留。`
              : `這台電腦的連接器協議 ${available.protocol}，伺服器使用 ${serverProtocol}。請更新 Yuki 伺服器以支援協議 ${available.protocol}；不需要重新配對。`}
            {available.protocol < serverProtocol && onUpdates && (
              <Button onClick={onUpdates}>前往更新</Button>
            )}
          </Banner>
        )}
      <SettingsSection title="狀態">
        {feedback('status')}
        {state.isError && (
          <Banner status="unknown">
            {state.error instanceof ClientProblem
              ? (problems[state.error.code] ?? problemText(state.error.code))
              : '無法讀取原連接器，請確認執行環境仍在原位置。'}
          </Banner>
        )}
        {available?.admission?.problem && (
          <Banner status="unknown">
            伺服器接納尚未確認：
            {problems[available.admission.problem] ?? problemText(available.admission.problem)}
            請確認伺服器連線；本機連接仍可管理。
          </Banner>
        )}
        <Row
          title={`這台電腦 · ${label}`}
          description={
            installation?.paired && installation.admission?.matched === false
              ? '這台電腦目前連接到另一個 Yuki；一台電腦同一時間只能連接一個 Yuki。'
              : installation?.admission?.matched === true && connection
                ? `目前連接到 ${connection.name}`
                : undefined
          }
        >
          <StatusPill status={status.status}>{status.text}</StatusPill>
          {state.isPending && <Spinner />}
          {installation?.paired && installation.admission?.matched === false ? (
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
          ) : installation &&
            (installation.updateAvailable || (available && installation.managed === false)) ? (
            <Button
              loading={busy}
              onClick={() =>
                void perform(async () => {
                  if (existing)
                    unwrap(await window.yuki.connector.useInstallation(existing.installation))
                  unwrap(
                    installation.managed === false
                      ? await window.yuki.connector.adopt()
                      : await window.yuki.connector.install(),
                  )
                  setNotice({
                    section: 'status',
                    text: '連接器已更新並沿用原身份、設定與操作記錄，隨 Desktop 啟動與結束。',
                  })
                })
              }
            >
              {installation.updateAvailable ? '更新連接器，保留原資料' : '改用隨附版本，保留原資料'}
            </Button>
          ) : existing ? (
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
          ) : null}
        </Row>
        {connection && available?.paired && (
          <Row
            title="連接器伺服器位址"
            description="這份電腦連接使用的位址，與桌面聊天的伺服器位址分開保存。"
          >
            <Button
              disabled={busy}
              onClick={() => {
                setError(undefined)
                setNotice(undefined)
                setServerAddress(available.server ?? '')
              }}
            >
              修改連接器位址
            </Button>
          </Row>
        )}
        {existing && (
          <Row
            title="沿用原有連接"
            description="沿用原安裝、授權與操作記錄，不會重新配對或啟停原服務。"
          />
        )}
        {installation?.updateAvailable && (
          <Row
            title="更新連接器"
            description={`目前連接器 ${installation.version ?? '版本未提供'}，桌面隨附 ${installation.bundledVersion ?? '版本'}。原身份、設定與操作記錄會保留，不需要重新配對。`}
          />
        )}
        {state.data && !existing?.state.paired && !available?.paired && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (connection && consent)
                void perform(async () => {
                  const connected = unwrap(
                    await window.yuki.connector.connect({
                      characterId: connection.characterId,
                      label,
                    }),
                  )
                  if (connected.available && connected.managed !== false && !connected.running)
                    unwrap(await window.yuki.connector.service('start'))
                  setNotice({
                    section: 'status',
                    text: '電腦已配對。完整訪問預設關閉，可在下方開啟；原生 Agent 稍後設定。',
                  })
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
                <Row
                  title="連接授權"
                  description={`允許 ${connection.name}（${connection.baseUrl}）以你目前的本人身份連接這台電腦。通用操作另由完整訪問開關管理，原生 Agent 沿原授權。`}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    我允許這個 Yuki 連接這台電腦
                  </label>
                </Row>
                <Row title="連接這台電腦">
                  <Button type="submit" variant="primary" loading={busy} disabled={!consent}>
                    連接這台電腦
                  </Button>
                </Row>
              </>
            ) : (
              <Row
                title="尚未連接 Yuki"
                description="先連接一位 Yuki，再授權這台電腦。你可以直接離開此頁。"
              />
            )}
          </form>
        )}
        {available?.paired && (
          <Row
            title={available.managed === false ? '獨立連接' : '本機連接'}
            description={
              available.managed === false
                ? '由原安裝管理，不隨 Desktop 啟停。改用隨附版本後，可交由 Desktop 管理。'
                : '隨 Desktop 啟動與結束；關閉視窗留在托盤時保持連接。已啟動任務的結果以原回執為準。'
            }
          >
            {available.managed === false ? (
              <span>
                {available.running === true
                  ? '執行中'
                  : available.running === false
                    ? '已停止'
                    : '狀態未知'}
              </span>
            ) : (
              <Toggle
                label="本機連接"
                checked={available.running === true || !!available.supervision?.restartPending}
                disabled={busy}
                onChange={(enabled) =>
                  void perform(async () => {
                    unwrap(await window.yuki.connector.service(enabled ? 'start' : 'stop'))
                  })
                }
              />
            )}
          </Row>
        )}
        {available?.paired && available.managed !== false && (
          <>
            {available.supervision?.link === 'authorization_lost' && (
              <Banner status="failed">
                授權已撤銷：伺服器拒絕了這台電腦的連接器憑據（例如已在「裝置」中移除）。連接器已停止重新連線，原操作記錄會保留。
              </Banner>
            )}
            {available.supervision?.link === 'protocol_unsupported' && (
              <Banner status="failed">
                連接器與伺服器的協議不相容，已停止重新連線。請更新較舊的一方；原身份與回執會保留。
              </Banner>
            )}
            <Row
              title="連線狀態"
              description={
                available.supervision?.reason
                  ? `最近原因：${available.supervision.reason}`
                  : undefined
              }
            >
              <span>{linkText(available)}</span>
            </Row>
            {available.supervision?.lastExit && (
              <Row
                title="最近一次非預期結束"
                description={new Date(available.supervision.lastExit.at).toLocaleString('zh-TW')}
              >
                <span>
                  {available.supervision.lastExit.code !== null
                    ? `結束代碼 ${available.supervision.lastExit.code}`
                    : `訊號 ${available.supervision.lastExit.signal}`}
                </span>
              </Row>
            )}
            <Row
              title="自動重新啟動"
              description="連接器非預期結束時，Desktop 依次等待 1、2、4… 秒（最長 1 分鐘）後重新啟動；連上伺服器後重新計算。停止連接或結束 App 時不會重新啟動。"
            >
              <span>{available.supervision?.restarts ?? 0} 次</span>
            </Row>
            <Row
              title="匯出診斷"
              description="包含連接狀態與 connector.log、connector-stderr.log 的最後部分，可能含本機路徑；分享前請先檢查內容。"
            >
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    if (unwrap(await window.yuki.connector.exportDiagnostics()))
                      setNotice({ section: 'status', text: '連接器診斷已匯出。' })
                  })
                }
              >
                匯出診斷
              </Button>
            </Row>
          </>
        )}
      </SettingsSection>
      {connection && (
        <Sheet
          title="修改連接器位址"
          open={serverAddress !== undefined}
          onClose={() => {
            if (!busy) setServerAddress(undefined)
          }}
          actions={
            <>
              <Button disabled={busy} onClick={() => setServerAddress(undefined)}>
                取消
              </Button>
              <Button
                type="submit"
                form={serverForm}
                variant="primary"
                loading={busy}
                disabled={!serverAddress?.trim()}
              >
                儲存
              </Button>
            </>
          }
        >
          <form
            id={serverForm}
            onSubmit={(event) => {
              event.preventDefault()
              void perform(async () => {
                unwrap(
                  await window.yuki.connector.server({
                    characterId: connection.characterId,
                    server: serverAddress!,
                  }),
                )
                setServerAddress(undefined)
                setNotice({
                  section: 'status',
                  text: '位址已儲存，下次啟動連接時使用。',
                })
              }, 'server')
            }}
          >
            <p>
              只儲存這份連接器的位址，不修改桌面聊天連線，也不啟停連接器。下次啟動時使用新位址。
            </p>
            <TextField
              aria-label="連接器伺服器位址"
              value={serverAddress ?? ''}
              onChange={(event) => setServerAddress(event.target.value)}
              placeholder="https://"
              autoComplete="url"
              required
            />
          </form>
          {feedback('server')}
        </Sheet>
      )}
      {available?.paired && (
        <>
          <SettingsSection title="權限">
            {feedback('permission')}
            <Row
              title="允許完整訪問本機"
              description={
                available.fullAccess === undefined
                  ? '所選連接器尚未提供完整訪問能力，請更新為本版隨附連接器；原授權範圍不變。'
                  : '允許 Shell、檔案與本機程式操作；關閉後不再接納新的通用操作，原回執和停止仍可用。'
              }
            >
              {available.fullAccess !== undefined && (
                <Toggle
                  label="允許完整訪問本機"
                  checked={available.fullAccess === true}
                  disabled={busy}
                  onChange={(enabled) =>
                    void perform(async () => {
                      const changed = unwrap(
                        await window.yuki.connector.fullAccess(enabled, connection?.characterId),
                      )
                      setNotice({
                        section: 'permission',
                        text:
                          (enabled
                            ? '完整訪問已開啟。使用目前 OS 帳號的權限，不逐命令或逐目錄重複確認。'
                            : '完整訪問已關閉。已啟動任務需按原執行停止；原生 Agent 的獨立授權仍保留。') +
                          (changed.available && changed.catalogProblem
                            ? ` 雲端目錄同步尚未確認：${problemText(changed.catalogProblem)}`
                            : ''),
                      })
                    }, 'permission')
                  }
                />
              )}
            </Row>
            {available.computer?.platform === 'darwin' &&
              available.supervision?.permissions &&
              macPermissions.map(({ permission, title, description }) =>
                available.supervision!.permissions![permission] ? (
                  <Row key={permission} title={title} description={description}>
                    <span>已允許</span>
                  </Row>
                ) : (
                  <Row
                    key={permission}
                    title={title}
                    description={`${description}在系統設定允許 Yuki 後，關閉再開啟「本機連接」重新檢查。`}
                  >
                    <span>未允許</span>
                    <Button
                      onClick={() =>
                        void perform(async () => {
                          unwrap(await window.yuki.connector.permissionSettings(permission))
                        }, 'permission')
                      }
                    >
                      打開系統設定
                    </Button>
                  </Row>
                ),
              )}
          </SettingsSection>
          <SettingsSection title="本機 Agent（可選）">
            {!editorOpen && !removing && feedback('agents')}
            {available.instances.map((instance) => {
              const remote = available.admission?.instances?.find(
                (item) => item.localId === instance.id,
              )
              const statusText = !remote
                ? '伺服器尚未接納此 Agent'
                : remote.status !== 'available'
                  ? `${driverName(instance.driver)} 尚未就緒：${problems[remote.errorType ?? ''] ?? remote.errorType ?? remote.status ?? '未提供原因'}`
                  : remote.online
                    ? instance.driver === 'claude'
                      ? 'Claude Code 程式已找到；登入與任務依原生結果確認'
                      : `${driverName(instance.driver)} 原生連線已建立`
                    : instance.driver === 'claude'
                      ? 'Claude Code 目前離線；上次已找到程式'
                      : `${driverName(instance.driver)} 目前離線；上次已就緒`
              return (
                <Row
                  key={instance.id}
                  title={instance.label}
                  description={`${driverName(instance.driver)} · ${statusText}`}
                >
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setInstanceId(instance.id)
                      setCreate(false)
                      setInstanceLabel(instance.label)
                      setCommand(instance.command ?? '')
                      setCommandChanged(false)
                      setLabelChanged(false)
                      if (['codex', 'claude', 'acp'].includes(instance.driver))
                        setDriver(instance.driver as ConnectorDriver)
                      setAgentArgs(instance.args ?? [])
                      setArgsChanged(false)
                      setDiagnostic(undefined)
                      setCandidateId('')
                      setCandidates([])
                      setError(undefined)
                      setNotice(undefined)
                      setEditorOpen(true)
                    }}
                  >
                    編輯
                  </Button>
                  <Button
                    variant="plain"
                    disabled={busy}
                    aria-label={`刪除 ${instance.label}`}
                    onClick={() => setRemoving(instance)}
                  >
                    刪除…
                  </Button>
                </Row>
              )
            })}
            <Row
              title="新增本機 Agent"
              description="選擇已安裝的 Codex、Claude Code 或支援 ACP 的程式。"
            >
              <Button
                disabled={busy}
                onClick={() => {
                  setInstanceId('')
                  setCreate(true)
                  setInstanceLabel(defaultAgentName(driver))
                  setCommand('')
                  setCommandChanged(false)
                  setLabelChanged(false)
                  setCandidateId('')
                  setAgentArgs([])
                  setArgsChanged(false)
                  setDiagnostic(undefined)
                  setError(undefined)
                  setNotice(undefined)
                  setEditorOpen(true)
                }}
              >
                新增 Agent
              </Button>
            </Row>
          </SettingsSection>
          <Sheet
            title={create ? '新增本機 Agent' : `編輯 ${original?.label ?? instanceLabel}`}
            width={560}
            open={editorOpen}
            onClose={() => {
              if (!busy) setEditorOpen(false)
            }}
            actions={
              <>
                <Button disabled={busy} onClick={() => setEditorOpen(false)}>
                  取消
                </Button>
                <Button
                  form={editorForm}
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={busy || (!candidateId && !command)}
                >
                  儲存
                </Button>
              </>
            }
          >
            {editorOpen && feedback('agents')}
            {diagnostic && (
              <Banner status={diagnostic.available ? 'done' : 'unknown'}>
                {diagnostic.available
                  ? available.instances.find((item) => item.id === diagnostic.id)?.driver ===
                    'claude'
                    ? 'Claude Code 登入檢查完成；尚未執行模型任務。'
                    : '原生握手與帳戶檢查完成；尚未執行模型任務。'
                  : (problems[diagnostic.problem ?? ''] ?? `尚未就緒（${diagnostic.problem}）。`)}
              </Banner>
            )}
            {original && (
              <Row title="程式">
                {supportsDiscovery && (
                  <Button
                    variant="plain"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        setDiagnostic(unwrap(await window.yuki.connector.diagnose(original.id)))
                      }, 'agents')
                    }
                  >
                    檢查就緒
                  </Button>
                )}
                <Button
                  variant="plain"
                  disabled={busy || !original.command}
                  onClick={() =>
                    void perform(async () => {
                      unwrap(await window.yuki.connector.revealNative(original.id))
                    }, 'agents')
                  }
                >
                  開啟程式位置
                </Button>
              </Row>
            )}
            <form
              id={editorForm}
              onSubmit={(event) => {
                event.preventDefault()
                void save()
              }}
            >
              <Row title="Agent 類型">
                <select
                  aria-label="Agent 類型"
                  value={original?.driver ?? driver}
                  disabled={busy || !!original}
                  onChange={(event) => {
                    const next = event.target.value as ConnectorDriver
                    if (instanceLabel === defaultAgentName(driver))
                      setInstanceLabel(defaultAgentName(next))
                    setDriver(next)
                    setCandidates([])
                    setCandidateId('')
                    setCommand('')
                    setCommandChanged(false)
                    setAgentArgs([])
                    setArgsChanged(false)
                    setDiagnostic(undefined)
                  }}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                  <option value="acp">支援 ACP 的 Agent</option>
                  {original && !['codex', 'claude', 'acp'].includes(original.driver) && (
                    <option value={original.driver}>{driverName(original.driver)}（原設定）</option>
                  )}
                </select>
              </Row>
              {supportsDiscovery && (
                <div className={styles.actions}>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void perform(discoverCandidates, 'agents')}
                  >
                    尋找已安裝的 {nativeName}
                  </Button>
                </div>
              )}
              {candidates.length > 1 && (
                <Row title="程式來源">
                  <select
                    aria-label="程式來源"
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
                  onChange={(event) => {
                    setInstanceLabel(event.target.value)
                    setLabelChanged(true)
                  }}
                  required
                />
              </Row>
              {(original?.driver ?? driver) === 'acp' ? (
                <Row title="程式">{executableSelection}</Row>
              ) : (
                <details>
                  <summary>進階：手動選擇原生程式</summary>
                  {executableSelection}
                </details>
              )}
              {(original?.driver ?? driver) === 'acp' && (
                <div className={styles.nativeArguments}>
                  <p className={styles.notice}>請選擇支援 ACP 的程式。</p>
                  <h4>啟動參數（選填）</h4>
                  <p className={styles.notice}>
                    依程式說明逐欄填寫；空欄也會傳入，不需要時請移除。
                  </p>
                  {agentArgs.map((value, index) => (
                    <Row key={index} title={`啟動參數 ${index + 1}`}>
                      <TextField
                        aria-label={`ACP 啟動參數 ${index + 1}`}
                        disabled={busy}
                        value={value}
                        onChange={(event) => {
                          setAgentArgs(
                            agentArgs.map((argument, item) =>
                              item === index ? event.target.value : argument,
                            ),
                          )
                          setArgsChanged(true)
                        }}
                      />
                      <Button
                        type="button"
                        disabled={busy}
                        aria-label={`移除 ACP 啟動參數 ${index + 1}`}
                        onClick={() => {
                          setAgentArgs(agentArgs.filter((_, item) => item !== index))
                          setArgsChanged(true)
                        }}
                      >
                        移除
                      </Button>
                    </Row>
                  ))}
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setAgentArgs([...agentArgs, ''])
                      setArgsChanged(true)
                    }}
                  >
                    新增參數
                  </Button>
                </div>
              )}
            </form>
          </Sheet>
          <Sheet
            title="刪除 Agent 設定？"
            open={!!removing}
            onClose={() => {
              if (!busy) setRemoving(undefined)
            }}
            actions={
              <>
                <Button disabled={busy} onClick={() => setRemoving(undefined)}>
                  取消
                </Button>
                <Button variant="destructive" loading={busy} onClick={() => void remove()}>
                  刪除設定
                </Button>
              </>
            }
          >
            {removing && feedback('agents')}
            <p>刪除「{removing?.label}」的本機設定及新任務選項，保留原生程式、檔案與歷史紀錄。</p>
          </Sheet>
        </>
      )}
      <details>
        <summary>疑難排解</summary>
        <SettingsSection title="技術資訊">
          {feedback('installation')}
          {existing && (
            <>
              <Row title="原連接器版本">
                <span>{existing.state.version ?? '未提供'}</span>
              </Row>
              <Row title="原獨立連接">
                <span>
                  {existing.state.running === true
                    ? '執行中'
                    : existing.state.running === false
                      ? '已停止'
                      : '狀態未知'}
                </span>
              </Row>
              <Row title="原伺服器連線">
                <span>{existing.state.admission?.connected ? '已連線' : '尚未確認連線'}</span>
              </Row>
            </>
          )}
          {available && (
            <>
              <Row title="連接器版本" description={available.runtime}>
                <span>
                  {available.version} · 協議 {available.protocol ?? '未提供'}
                </span>
              </Row>
              <Row title="原安裝資料" description={available.dataDirectory}>
                <span>{available.deviceId ?? '尚未配對'}</span>
              </Row>
              <Row title="伺服器連接器協議">
                <span>{serverProtocol ?? '尚未提供；可更新 Yuki 後重新開啟設定。'}</span>
              </Row>
              {available.paired && (
                <Row title="授權來源" description={available.server}>
                  <span>{available.admission?.matched ? '目前本人' : '尚未確認目前本人'}</span>
                </Row>
              )}
              <Row title="伺服器接納">
                <span>{available.admission?.connected ? '已連線' : '尚未確認連線'}</span>
              </Row>
              {available.computer && (
                <Row title="本機執行環境">
                  <span>
                    {available.computer.platform} · {available.computer.shell ?? '未提供預設 Shell'}
                  </span>
                </Row>
              )}
            </>
          )}
        </SettingsSection>
        <details>
          <summary>進階：安裝與原有連接</summary>
          <SettingsSection description="選擇原連接器使用的 Python 和資料目錄。保留原身份、設定與 journal，不複製憑據，也不替換此安裝的 Python。">
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
            <Row title="選用原有安裝">
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
                  }, 'installation')
                }
              >
                讀取並選用原安裝
              </Button>
            </Row>
          </SettingsSection>
        </details>
        {available && !available.paired && (
          <details>
            <summary>進階：手動專用授權碼</summary>
            <SettingsSection description="僅接受 connector 用途的電腦授權碼；聊天配對碼不能使用。提交後立即清除輸入。">
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
              <Row title="使用專用授權碼">
                <Button
                  disabled={busy || !manualServer || !manualCode}
                  onClick={() => {
                    const code = manualCode
                    setManualCode('')
                    void perform(async () => {
                      unwrap(
                        await window.yuki.connector.pair({ server: manualServer, label, code }),
                      )
                    }, 'installation')
                  }}
                >
                  使用專用碼連接
                </Button>
              </Row>
            </SettingsSection>
          </details>
        )}
        {driver !== 'acp' && (
          <SettingsSection>
            <Row title="安裝說明">
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
                  }, 'installation')
                }
              >
                {driverName(driver)} 安裝說明
              </Button>
            </Row>
          </SettingsSection>
        )}
      </details>
    </>
  )
}
