import { useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import { Banner, Button, Sheet, TextField } from '../components/Controls'
import { Segmented } from '../components/InteractiveControls'
import { unwrap } from '../queries/client'
import { useTranslation } from '../i18n'
import { Row, SettingsSection } from './SettingsRow'
import { RemoteProblem, useSshForm } from './SshForm'
import styles from './Settings.module.css'

/** How this desktop reaches the Yuki, and — over SSH — the same login managing its server. */
export function TransportSettings({
  connection,
  onConnection,
}: {
  connection: Connection
  onConnection(connection: Connection): void
}) {
  const { t } = useTranslation(['ssh'])
  const id = useId(),
    query = useQueryClient(),
    characterId = connection.characterId,
    transport = connection.transport
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<'direct' | 'ssh'>('direct'),
    [server, setServer] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState<{ text: string; failed?: boolean }>(),
    [logs, setLogs] = useState<string>(),
    [version, setVersion] = useState<string>()
  useEffect(() => {
    void window.yuki.remoteDeploy
      .state()
      .then(unwrap)
      .then((state) => setVersion(state.version))
  }, [])
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await work()
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  const changed = async (result: { connection: Connection; connectorProblem?: string }) => {
    onConnection(result.connection)
    await query.invalidateQueries({ queryKey: [characterId] })
    setOpen(false)
    if (result.connectorProblem)
      setNotice({
        text: t('ssh:connectorNotMoved', { reason: result.connectorProblem }),
        failed: true,
      })
  }
  const ssh = useSshForm({
    confirmLabel: t('ssh:confirmConnect'),
    submit: async (access, directory) =>
      changed(
        unwrap(
          await window.yuki.ssh.changeTransport(characterId, { kind: 'ssh', access, directory }),
        ),
      ),
  })
  return (
    <SettingsSection title={t('ssh:transport')}>
      {notice?.failed && <Banner status="failed">{notice.text}</Banner>}
      {notice && !notice.failed && (
        <p role="status" className={styles.notice}>
          {notice.text}
        </p>
      )}
      {!open && <RemoteProblem error={error} />}
      <Row
        title={transport?.kind === 'ssh' ? t('ssh:overSsh') : t('ssh:direct')}
        description={
          transport?.kind === 'ssh'
            ? t('ssh:transportSsh', {
                user: transport.user,
                host: transport.host,
                port: transport.localPort,
              })
            : t('ssh:transportDirect', { address: connection.baseUrl })
        }
      >
        <Button
          onClick={() => {
            setKind(transport?.kind ?? 'direct')
            setServer(transport?.kind === 'ssh' ? '' : connection.baseUrl)
            setError(undefined)
            setOpen(true)
          }}
        >
          {t('ssh:changeTransport')}
        </Button>
      </Row>
      {transport?.kind === 'ssh' && (
        <Row title={t('ssh:manage')} description={t('ssh:manageDescription')}>
          <Button
            loading={busy && !open}
            disabled={!version}
            onClick={() =>
              void run(async () => {
                unwrap(await window.yuki.ssh.upgrade(characterId))
                setNotice({ text: t('ssh:upgraded') })
              })
            }
          >
            {t('ssh:upgrade')}
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => setLogs(unwrap(await window.yuki.ssh.logs(characterId))))
            }
          >
            {t('ssh:logs')}
          </Button>
        </Row>
      )}
      <Sheet
        title={t('ssh:logsTitle')}
        open={logs !== undefined}
        onClose={() => setLogs(undefined)}
        actions={<Button onClick={() => setLogs(undefined)}>{t('ssh:close')}</Button>}
      >
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '60vh' }}>
          {logs}
        </pre>
      </Sheet>
      <Sheet
        title={t('ssh:changeTransportTitle')}
        open={open}
        onClose={() => {
          if (!busy && !ssh.busy) setOpen(false)
        }}
        actions={
          <>
            <Button disabled={busy || ssh.busy} onClick={() => setOpen(false)}>
              {t('ssh:cancel')}
            </Button>
            {kind === 'direct' ? (
              <Button
                variant="primary"
                loading={busy}
                disabled={!server.trim()}
                onClick={() =>
                  void run(async () =>
                    changed(
                      unwrap(
                        await window.yuki.ssh.changeTransport(characterId, {
                          kind: 'direct',
                          server,
                        }),
                      ),
                    ),
                  )
                }
              >
                {t('ssh:confirmDirect')}
              </Button>
            ) : (
              ssh.button
            )}
          </>
        }
      >
        <p>{t('ssh:changeTransportDescription')}</p>
        <Segmented
          label={t('ssh:transport')}
          kind="radio"
          value={kind}
          items={[
            { value: 'direct', label: t('ssh:direct') },
            { value: 'ssh', label: t('ssh:overSsh') },
          ]}
          onChange={(value) => {
            setKind(value)
            setError(undefined)
          }}
        />
        {kind === 'direct' ? (
          <>
            <RemoteProblem error={error} />
            <label htmlFor={`${id}-server`}>{t('ssh:server')}</label>
            <TextField
              id={`${id}-server`}
              value={server}
              placeholder="https://"
              autoComplete="url"
              onChange={(event) => setServer(event.target.value)}
              disabled={busy}
            />
          </>
        ) : (
          ssh.fields
        )}
      </Sheet>
    </SettingsSection>
  )
}
