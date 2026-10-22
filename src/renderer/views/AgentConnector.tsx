import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectorServiceAction } from '../../shared/connector'
import { Banner, Button, Spinner, TextField } from '../components/Controls'
import { ClientProblem, unwrap } from '../queries/client'
import { Row } from './Settings'
import styles from './Settings.module.css'

export function AgentConnector({
  server: initialServer = '',
  deviceLabel,
}: {
  server?: string
  deviceLabel: string
}) {
  const query = useQueryClient()
  const state = useQuery({
    queryKey: ['desktop', 'agent-connector'],
    queryFn: () => window.yuki.connector.state().then(unwrap),
    retry: false,
  })
  const [server, setServer] = useState(initialServer)
  const [label, setLabel] = useState(deviceLabel)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const available = state.data?.available ? state.data : undefined
  const perform = async (operation: () => ReturnType<typeof window.yuki.connector.state>) => {
    setBusy(true)
    setError('')
    try {
      query.setQueryData(['desktop', 'agent-connector'], unwrap(await operation()))
    } catch (failure) {
      setError(
        failure instanceof ClientProblem && failure.code === 'invalid_server'
          ? '請輸入完整的伺服器位址。'
          : '操作未確認，請重新讀取連接器狀態。',
      )
    } finally {
      setBusy(false)
    }
  }
  const service = (action: ConnectorServiceAction) =>
    perform(() => window.yuki.connector.service(action))
  return (
    <>
      <p className={styles.notice}>
        讓伺服器上的 Yuki 使用這台電腦已安裝的 Codex、Claude Code 或 ACP Agent。
        連接器由目前系統使用者獨立執行，關閉 Desktop 仍可繼續工作。
      </p>
      {error && <Banner status="failed">{error}</Banner>}
      {state.isError && <Banner status="unknown">無法讀取連接器狀態。</Banner>}
      {state.isPending ? (
        <Spinner />
      ) : state.data?.available === false ? (
        <div className={styles.group}>
          <Row
            title="安裝獨立連接器"
            description="在目前使用者的終端安裝，並讓 Desktop 能找到 CLI。"
          >
            <code>uv tool install &lt;下載的連接器 wheel 路徑&gt;</code>
          </Row>
        </div>
      ) : state.data?.available === true ? (
        <>
          <div className={styles.group}>
            <Row title="電腦授權" description={available?.deviceId}>
              <span>{available?.paired ? '已配對' : '尚未配對'}</span>
            </Row>
            <Row
              title="使用者服務"
              description="停止服務會中斷遠端連線；各 Agent 的執行與恢復依原生能力處理。"
            >
              <span>
                {!available?.service.installed
                  ? '尚未安裝'
                  : available.service.running === true
                    ? '執行中'
                    : available.service.running === false
                      ? '已停止'
                      : '狀態未確認'}
              </span>
            </Row>
          </div>
          {!available?.paired && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const oneTimeCode = code
                setCode('')
                void perform(() => window.yuki.connector.pair({ server, label, code: oneTimeCode }))
              }}
            >
              <p className={styles.notice}>
                請取得用途為 connector 的一次性電腦授權碼；聊天配對碼無法用於此處。
              </p>
              <div className={styles.group}>
                <Row title="伺服器位址">
                  <TextField
                    aria-label="Agent 伺服器位址"
                    type="url"
                    value={server}
                    onChange={(event) => setServer(event.target.value)}
                    required
                  />
                </Row>
                <Row title="這台電腦的名稱">
                  <TextField
                    aria-label="Agent 電腦名稱"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    required
                  />
                </Row>
                <Row title="電腦授權碼">
                  <TextField
                    aria-label="Agent 電腦授權碼"
                    type="password"
                    autoComplete="off"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                </Row>
              </div>
              <Button type="submit" loading={busy}>
                配對這台電腦
              </Button>
            </form>
          )}
          {available?.paired && (
            <>
              <div className={styles.actions}>
                <Button disabled={busy} onClick={() => void service('install')}>
                  安裝使用者服務
                </Button>
                <Button disabled={busy} onClick={() => void service('start')}>
                  啟動
                </Button>
                <Button disabled={busy} onClick={() => void service('stop')}>
                  停止
                </Button>
                <Button disabled={busy} onClick={() => void service('uninstall')}>
                  移除使用者服務
                </Button>
              </div>
              <h3>本機 Agent</h3>
              {available.instances.length ? (
                <div className={styles.group}>
                  {available.instances.map((instance) => (
                    <Row key={instance.id} title={instance.label}>
                      <span>{instance.driver}</span>
                    </Row>
                  ))}
                </div>
              ) : (
                <p className={styles.notice}>
                  尚未加入原生 Agent。請在終端用{' '}
                  <code>yuki-agent-connector instance add --help</code> 設定實際安裝與 profile。
                </p>
              )}
            </>
          )}
        </>
      ) : null}
      <div className={styles.actions}>
        <Button disabled={busy || state.isFetching} onClick={() => void state.refetch()}>
          重新讀取
        </Button>
      </div>
    </>
  )
}
