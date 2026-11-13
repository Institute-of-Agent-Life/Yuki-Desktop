import { useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import { Banner, Button, Sheet, TextField } from '../components/Controls'
import { Segmented } from '../components/InteractiveControls'
import { unwrap } from '../queries/client'
import { useTranslation } from '../i18n'
import { Row } from './SettingsRow'
import { RemoteProblem, useSshForm } from './SshForm'
import { TailscaleGuide } from './TailscaleGuide'
import appStyles from '../App.module.css'
import styles from './Settings.module.css'

/**
 * How this desktop reaches the Yuki: one row naming the address or SSH login in use, and one
 * dialog that changes either — same Yuki, same device credential, the Connector following.
 */
export function TransportSettings({
  connection,
  onConnection,
}: {
  connection: Connection
  onConnection(connection: Connection): void
}) {
  const { t } = useTranslation(['ssh'])
  const id = useId(),
    directForm = `${id}-direct`,
    query = useQueryClient(),
    characterId = connection.characterId,
    transport = connection.transport
  const [open, setOpen] = useState(false),
    [kind, setKind] = useState<'direct' | 'ssh'>('direct'),
    [server, setServer] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState<string>()
  const changed = async (result: { connection: Connection; connectorProblem?: string }) => {
    onConnection(result.connection)
    await query.invalidateQueries({ queryKey: [characterId] })
    setOpen(false)
    if (result.connectorProblem)
      setNotice(t('ssh:connectorNotMoved', { reason: result.connectorProblem }))
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
  const direct = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await changed(
        unwrap(await window.yuki.ssh.changeTransport(characterId, { kind: 'direct', server })),
      )
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {notice && <Banner status="failed">{notice}</Banner>}
      <Row
        title={t('ssh:transport')}
        description={
          transport?.kind === 'ssh'
            ? t('ssh:transportSsh', { user: transport.user, host: transport.host })
            : t('ssh:transportDirect', { address: connection.baseUrl })
        }
      >
        <Button
          onClick={() => {
            setKind(transport?.kind ?? 'direct')
            setServer(transport?.kind === 'ssh' ? '' : connection.baseUrl)
            setError(undefined)
            setNotice(undefined)
            setOpen(true)
          }}
        >
          {t('ssh:change')}
        </Button>
      </Row>
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
                type="submit"
                form={directForm}
                variant="primary"
                loading={busy}
                disabled={!server.trim()}
              >
                {t('ssh:confirmDirect')}
              </Button>
            ) : (
              ssh.button
            )}
          </>
        }
      >
        <div className={styles.sheetStack}>
          <p className={styles.notice}>{t('ssh:changeTransportDescription')}</p>
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
            <form
              id={directForm}
              className={appStyles.server}
              onSubmit={(event) => {
                event.preventDefault()
                void direct()
              }}
            >
              <RemoteProblem error={error} />
              <label htmlFor={`${id}-server`}>{t('ssh:server')}</label>
              <TextField
                id={`${id}-server`}
                value={server}
                placeholder="https://"
                autoComplete="url"
                spellCheck={false}
                onChange={(event) => setServer(event.target.value)}
                disabled={busy}
              />
              <TailscaleGuide onError={(message) => setError(message || undefined)} />
            </form>
          ) : (
            ssh.fields
          )}
        </div>
      </Sheet>
    </>
  )
}

/** Over SSH, the same login is the hand on the server: upgrade the Yuki there, read its logs. */
export function ServerManagement({ connection }: { connection: Connection }) {
  const { t } = useTranslation(['ssh'])
  const characterId = connection.characterId
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState<string>(),
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
  return (
    <>
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <RemoteProblem error={error} />
      <Row
        title={t('ssh:manage')}
        description={
          version ? t('ssh:upgradeDescription', { version }) : t('ssh:manageDescription')
        }
      >
        <Button
          loading={busy}
          disabled={!version}
          onClick={() =>
            void run(async () => {
              unwrap(await window.yuki.ssh.upgrade(characterId))
              setNotice(t('ssh:upgraded'))
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
      <Sheet
        title={t('ssh:logsTitle')}
        open={logs !== undefined}
        onClose={() => setLogs(undefined)}
        actions={<Button onClick={() => setLogs(undefined)}>{t('ssh:close')}</Button>}
      >
        <pre className={styles.terminalOutput}>{logs}</pre>
      </Sheet>
    </>
  )
}
