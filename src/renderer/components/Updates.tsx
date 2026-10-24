import { useState } from 'react'
import type { Preferences } from '../../shared/desktop'
import { useUpdates } from '../state/updates'
import { unwrap } from '../queries/client'
import { Banner, Button, Segmented, Sheet, Spinner } from './Controls'
import { Row } from '../views/Settings'

const failures = {
  'no-release': '目前還沒有可用的更新發布。',
  network: '無法檢查更新，請稍後再試。',
  integrity: '下載內容或簽章未通過核對，請重新檢查更新。',
  download: '更新下載未完成，請重新檢查。',
  installation: '更新未能安裝，原有資料與連線仍保留。請重新檢查或到下載頁安裝。',
}
export function UpdateReadyButton() {
  const { state } = useUpdates()
  const [error, setError] = useState('')
  if (state?.phase !== 'downloaded') return null
  return (
    <>
      {error && <span role="alert">{error}</span>}
      <Button
        variant="plain"
        onClick={() => {
          setError('')
          void window.yuki.updates
            .install()
            .then(unwrap)
            .catch(() => setError('更新尚未開始，請重新嘗試。'))
        }}
      >
        重新啟動以更新
      </Button>
    </>
  )
}
export function UpdatePanel({
  preferences,
  save,
}: {
  preferences: Preferences
  save(patch: Partial<Preferences>): Promise<void>
}) {
  const { state, error: loadError, reload } = useUpdates()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch {
      setError('操作未完成，請重新嘗試。')
    } finally {
      setBusy(false)
    }
  }
  const checking = state?.phase === 'checking',
    downloading = state?.phase === 'downloading'
  return (
    <>
      <Row title="更新通道" description="一般版本適合日常使用；測試版本會提供尚在驗證的新功能。">
        <Segmented
          disabled={busy || state?.phase === 'installing' || state?.phase === 'preparing'}
          label="更新通道"
          value={preferences.updateChannel}
          items={[
            { value: 'stable' as const, label: '一般版本' },
            { value: 'beta' as const, label: '測試版本' },
          ]}
          onChange={(updateChannel) => void run(() => save({ updateChannel }))}
        />
      </Row>
      <Row title="App 更新" description={state ? `目前版本 ${state.currentVersion}` : undefined}>
        {!state ? (
          loadError ? (
            <Button onClick={() => void reload()}>重新讀取</Button>
          ) : (
            <Spinner />
          )
        ) : (
          <Button
            disabled={busy || checking || downloading || state.mode === 'development'}
            loading={checking}
            onClick={() => void run(() => window.yuki.updates.check().then(unwrap))}
          >
            檢查更新
          </Button>
        )}
      </Row>
      {state?.mode === 'development' && <p>開發模式不檢查或安裝更新。</p>}
      {state?.phase === 'current' && <p role="status">此通道目前沒有可用的更新。</p>}
      {state?.phase === 'available' && (
        <Row
          title={`有新版本 ${state.version}`}
          description={
            state.mode === 'manual'
              ? '這種安裝方式需下載新版後手動安裝。'
              : '下載完成後，由你決定何時重新啟動。'
          }
        >
          {state.mode === 'manual' ? (
            <Button
              onClick={() =>
                void run(() => window.yuki.client.external(state.releaseUrl).then(unwrap))
              }
            >
              前往下載頁
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void run(() => window.yuki.updates.download().then(unwrap))}
            >
              下載更新
            </Button>
          )}
        </Row>
      )}
      {downloading && (
        <Row title="正在下載更新">
          <progress
            aria-label="更新下載進度"
            max={100}
            value={state.progress?.total ? state.progress.percent : undefined}
          />
          <Button onClick={() => void run(() => window.yuki.updates.cancel().then(unwrap))}>
            取消下載
          </Button>
        </Row>
      )}
      {state?.phase === 'downloaded' && (
        <Row
          title={`已下載 ${state.version}`}
          description="會先確認未儲存的變更與電腦控制權，再結束本機操作。"
        >
          <UpdateReadyButton />
        </Row>
      )}
      {(error || loadError || state?.problem) && (
        <Banner status="failed">
          {error || loadError || (state?.problem && failures[state.problem])}
        </Banner>
      )}
    </>
  )
}

export function UpdatePending() {
  const { state } = useUpdates()
  return (
    <Sheet
      title="正在準備更新"
      open={state?.phase === 'installing' || state?.phase === 'preparing'}
      onClose={() => {}}
      actions={<Spinner />}
    >
      <p>
        {state?.phase === 'preparing'
          ? '正在等候原本的本機操作收尾，完成後才會重新啟動。'
          : '準備完成後會重新啟動。角色在伺服器的工作會繼續保留。'}
      </p>
    </Sheet>
  )
}
