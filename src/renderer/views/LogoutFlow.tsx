import { useEffect, useRef, useState } from 'react'
import type { Connection, LogoutSummary } from '../../shared/api'
import { Banner, Button, Sheet } from '../components/Controls'
import { unwrap } from '../queries/client'
import { useTranslation } from '../i18n'
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
  const { t } = useTranslation(['connection', 'common'])
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
      setError(error instanceof Error ? error.message : t('connection:logout.notConfirmed'))
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
      setError(error instanceof Error ? error.message : t('connection:logout.cleanupFailed'))
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
        title={t('connection:logout.named', { name: connection.name })}
        description={
          connection.logout
            ? t('connection:logout.credentialExpired')
            : t('connection:logout.description')
        }
      >
        <Button
          variant={connection.logout ? 'secondary' : 'destructive'}
          disabled={busy}
          onClick={() => (connection.logout ? void prepare() : setConfirm(true))}
        >
          {connection.logout ? t('connection:logout.resume') : t('connection:logout.start')}
        </Button>
      </Row>
      <Sheet
        title={t('connection:logout.confirmTitle')}
        open={confirm}
        onClose={() => {
          if (!busy) setConfirm(false)
        }}
        actions={
          <>
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              {t('common:action.back')}
            </Button>
            <Button loading={busy} onClick={() => void prepare()}>
              {t('connection:logout.revokeAndContinue')}
            </Button>
          </>
        }
      >
        <p>{t('connection:logout.confirmBody', { name: connection.name })}</p>
        {busy && <p role="status">{t('connection:logout.finishing')}</p>}
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
      <Sheet
        title={t('connection:logout.localTitle')}
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
              {t('connection:logout.deleteLocal')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void finish('keep')}>
              {t('connection:logout.keepAndLogout')}
            </Button>
          </>
        }
      >
        <p>{t('connection:logout.localIntro')}</p>
        <ul>
          <li>{t('connection:logout.drafts', { count: summary?.drafts ?? 0 })}</li>
          <li>{t('connection:logout.pending', { count: summary?.pending ?? 0 })}</li>
          <li>{t('connection:logout.attachments', { count: summary?.attachments ?? 0 })}</li>
        </ul>
        <p>{t('connection:logout.keepNote')}</p>
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
      <Sheet
        title={
          summary?.connection.logout?.choice === 'delete'
            ? t('connection:logout.resumeDeleteTitle')
            : t('connection:logout.deleteTitle')
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
              {summary?.connection.logout?.choice
                ? t('connection:logout.later')
                : t('common:action.back')}
            </Button>
            <Button variant="destructive" loading={busy} onClick={() => void finish('delete')}>
              {summary?.connection.logout?.choice
                ? t('connection:logout.retryDelete')
                : t('connection:logout.deleteAndLogout')}
            </Button>
          </>
        }
      >
        <p>{t('connection:logout.deleteBody')}</p>
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
    </>
  )
}
