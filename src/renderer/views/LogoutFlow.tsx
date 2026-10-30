import { useEffect, useRef, useState } from 'react'
import type { Connection, LogoutSummary } from '../../shared/api'
import { Banner, Button, Sheet } from '../components/Controls'
import { unwrap } from '../queries/client'
import { Row } from './SettingsRow'

export function LogoutFlow({
  connection,
  onConnection,
  onLoggedOut,
}: {
  connection: Connection
  onConnection(connection: Connection): void
  onLoggedOut(): Promise<void>
}) {
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const [confirm, setConfirm] = useState(false),
    [summary, setSummary] = useState<LogoutSummary | undefined>(
      connection.logout ? { connection, ...connection.logout } : undefined,
    ),
    [deleting, setDeleting] = useState(connection.logout?.choice === 'delete'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const prepare = async () => {
    setBusy(true)
    setError('')
    try {
      const result = unwrap(
        connection.logout
          ? await window.yuki.client.logoutSummary(connection.characterId)
          : await window.yuki.client.prepareLogout(connection.characterId),
      )
      if (!active.current) return
      setSummary(result)
      setDeleting(result.connection.logout?.choice === 'delete')
      onConnection(result.connection)
      setConfirm(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : '登出尚未確認，本機內容仍保留。')
    } finally {
      setBusy(false)
    }
  }
  const finish = async (choice: 'keep' | 'delete') => {
    setBusy(true)
    setError('')
    try {
      unwrap(
        await window.yuki.client.finishLogout(
          connection.characterId,
          summary!.connection.deviceId!,
          choice,
        ),
      )
      if (active.current) await onLoggedOut()
    } catch (error) {
      setError(error instanceof Error ? error.message : '本機資料處理尚未完成，請重試。')
      try {
        const current = unwrap(await window.yuki.client.logoutSummary(connection.characterId))
        setSummary(current)
        setDeleting(current.connection.logout?.choice === 'delete')
        onConnection(current.connection)
      } catch {
        /* Keep the last confirmed scope available for review. */
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {error && <Banner status="failed">{error}</Banner>}
      <Row
        title={`登出 ${connection.name}`}
        description={
          connection.logout
            ? '裝置憑據已失效，請完成本機資料選擇。'
            : '撤銷這台裝置的登入，再選擇保留或刪除本機資料。'
        }
      >
        <Button
          variant={connection.logout ? 'secondary' : 'destructive'}
          disabled={busy}
          onClick={() => (connection.logout ? void prepare() : setConfirm(true))}
        >
          {connection.logout ? '繼續登出' : '登出…'}
        </Button>
      </Row>
      <Sheet
        title="登出這個 Yuki？"
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false)
        }}
        actions={
          <>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              返回
            </Button>
            <Button loading={busy} onClick={() => void prepare()}>
              撤銷憑據並繼續
            </Button>
          </>
        }
      >
        <p>先撤銷「{connection.name}」在這台裝置的連線憑據，再選擇保留或刪除本機內容。</p>
        {busy && <p role="status">正在收尾進行中的操作並確認裝置憑據…</p>}
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
      <Sheet
        title="處理本機內容"
        open={!!summary && !deleting}
        onClose={() => {
          if (!busy) setSummary(undefined)
        }}
        actions={
          <>
            <Button
              disabled={busy}
              onClick={() => {
                setError('')
                setDeleting(true)
              }}
            >
              刪除本機資料…
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void finish('keep')}>
              保留並登出
            </Button>
          </>
        }
      >
        <p>裝置憑據已失效。這個本人入口在這台電腦有：</p>
        <ul>
          <li>{summary?.drafts ?? 0} 份草稿</li>
          <li>{summary?.pending ?? 0} 項待確認請求</li>
          <li>{summary?.attachments ?? 0} 個待送附件</li>
        </ul>
        <p>保留後，同一位本人再次配對可接續查證。其他本人不會取得這些內容。</p>
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
      <Sheet
        title={
          summary?.connection.logout?.choice === 'delete' ? '繼續刪除本機資料' : '刪除本機資料？'
        }
        open={!!summary && deleting}
        onClose={() => {
          if (!busy) {
            if (summary?.connection.logout?.choice) setSummary(undefined)
            else setDeleting(false)
          }
        }}
        actions={
          <>
            <Button
              disabled={busy}
              onClick={() => {
                if (summary?.connection.logout?.choice) setSummary(undefined)
                else setDeleting(false)
              }}
            >
              {summary?.connection.logout?.choice ? '稍後處理' : '返回'}
            </Button>
            <Button variant="destructive" loading={busy} onClick={() => void finish('delete')}>
              {summary?.connection.logout?.choice ? '重試刪除並登出' : '刪除並登出'}
            </Button>
          </>
        }
      >
        <p>
          將移除這個本人入口在本機的草稿、待確認內容、附件快照與讀取快取，無法復原。已送達伺服器的資料與另存到其他位置的檔案會保留。
        </p>
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
    </>
  )
}
