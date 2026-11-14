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
import type { TFunction } from 'i18next'
import source from '../../shared/locales/zh-Hant/connector'
import { useTranslation } from '../i18n'
import { useDisplayTime } from '../state/time'

type T = TFunction<['connector']>
// The Connector's own error codes have a message here; anything else goes through `problemText`.
const problemMessage = (t: T, code: string) =>
  Object.hasOwn(source.problem, code)
    ? t(`connector:problem.${code as keyof typeof source.problem}`)
    : undefined
const driverName = (driver: string) =>
  driver === 'codex'
    ? 'Codex'
    : driver === 'claude'
      ? 'Claude Code'
      : driver === 'acp'
        ? 'ACP'
        : driver
const defaultAgentName = (t: T, driver: ConnectorDriver) =>
  driver === 'acp'
    ? t('connector:defaultAgent.acp')
    : t('connector:defaultAgent.native', { driver: driverName(driver) })

const summary = (t: T, state: ConnectorState | undefined): { text: string; status: Status } => {
  if (!state) return { text: t('connector:state.reading'), status: 'unknown' }
  const installation = state.available ? state : state.existing?.state
  if (!installation) return { text: t('connector:state.notConnected'), status: 'offline' }
  if (installation.paired && installation.admission?.matched === false)
    return { text: t('connector:state.otherYuki'), status: 'failed' }
  if (installation.updateAvailable)
    return { text: t('connector:state.updateRequired'), status: 'waiting' }
  if (!state.available) return { text: t('connector:state.existingFound'), status: 'waiting' }
  if (!installation.paired) return { text: t('connector:state.notConnected'), status: 'offline' }
  const supervision = installation.supervision
  if (supervision?.link === 'authorization_lost')
    return { text: t('connector:state.authorizationLost'), status: 'failed' }
  if (supervision?.link === 'protocol_unsupported')
    return { text: t('connector:state.connectorProtocolUnsupported'), status: 'failed' }
  if (supervision?.restartPending)
    return { text: t('connector:state.restarting'), status: 'waiting' }
  if (installation.running === false)
    return { text: t('connector:state.stopped'), status: 'waiting' }
  if (supervision?.link === 'disconnected')
    return { text: t('connector:state.reconnecting'), status: 'waiting' }
  return installation.admission?.connected
    ? { text: t('connector:state.connected'), status: 'done' }
    : { text: t('connector:state.unconfirmed'), status: 'unknown' }
}
// The Connector's own state lines; older Connectors report none.
const linkText = (t: T, installation: ConnectorAvailableState) => {
  const supervision = installation.supervision
  if (supervision?.restartPending) return t('connector:state.restartPending')
  if (installation.running !== true) return t('connector:state.notRunning')
  switch (supervision?.link) {
    case 'connected':
      return t('connector:state.connected')
    case 'disconnected':
      return t('connector:state.reconnecting')
    case 'authorization_lost':
      return t('connector:state.authorizationLost')
    case 'protocol_unsupported':
      return t('connector:state.protocolUnsupported')
    default:
      return t('connector:state.runningUnreported')
  }
}
const runningText = (t: T, running: boolean | null | undefined) =>
  running === true
    ? t('connector:state.running')
    : running === false
      ? t('connector:state.halted')
      : t('connector:state.unknown')

// macOS asks for both when the Connector, a child of Yuki.app, looks at or uses the screen.
const macPermissions: ConnectorPermission[] = ['screen', 'input']

type Feedback = {
  section: 'status' | 'permission' | 'agents' | 'installation' | 'server'
  text: string
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
  const { t } = useTranslation(['connector', 'common'])
  const { date } = useDisplayTime()
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
  const [instanceLabel, setInstanceLabel] = useState<string>(() => defaultAgentName(t, 'codex'))
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
  const status = summary(t, state.data)
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
            ? failure.reason && Object.hasOwn(source.stage, failure.reason)
              ? t('connector:stageFailure', {
                  stage: t(`connector:stage.${failure.reason as keyof typeof source.stage}`),
                  problem: problemMessage(t, failure.code) ?? failure.message,
                })
              : (problemMessage(t, failure.code) ?? failure.message)
            : t('connector:unconfirmed'),
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
        text: t('connector:notFound', { driver: driverName(driver) }),
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
        ? t('connector:savedCatalog', {
            problem: problemMessage(t, result.catalogProblem) ?? result.catalogProblem,
          })
        : t('connector:saved'),
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
          ? t('connector:removedCatalog', {
              problem: problemMessage(t, result.catalogProblem) ?? result.catalogProblem,
            })
          : t('connector:removed'),
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
          t('connector:notChosen')}
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
        {t('connector:chooseProgram')}
      </Button>
    </>
  )
  return (
    <>
      <p className={styles.notice}>{t('connector:intro', { name: connection?.name ?? 'Yuki' })}</p>
      {available &&
        available.protocol !== undefined &&
        serverProtocol !== undefined &&
        available.protocol !== serverProtocol && (
          <Banner status="unknown">
            {t(
              available.protocol < serverProtocol
                ? 'connector:protocolBehind'
                : 'connector:protocolAhead',
              { local: available.protocol, server: serverProtocol },
            )}
            {available.protocol < serverProtocol && onUpdates && (
              <Button onClick={onUpdates}>{t('connector:goUpdate')}</Button>
            )}
          </Banner>
        )}
      <SettingsSection title={t('connector:section.status')}>
        {feedback('status')}
        {state.isError && (
          <Banner status="unknown">
            {state.error instanceof ClientProblem
              ? (problemMessage(t, state.error.code) ?? problemText(state.error.code))
              : t('connector:readFailed')}
          </Banner>
        )}
        {available?.admission?.problem && (
          <Banner status="unknown">
            {t('connector:admissionUnconfirmed', {
              problem:
                problemMessage(t, available.admission.problem) ??
                problemText(available.admission.problem),
            })}
          </Banner>
        )}
        <Row
          title={t('connector:thisComputer', { label })}
          description={
            installation?.paired && installation.admission?.matched === false
              ? t('connector:otherYukiDescription')
              : installation?.admission?.matched === true && connection
                ? t('connector:connectedTo', { name: connection.name })
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
              {t('connector:newConnection')}
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
                    text: t('connector:updated'),
                  })
                })
              }
            >
              {installation.updateAvailable
                ? t('connector:updateKeepData')
                : t('connector:adoptKeepData')}
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
              {t('connector:useExisting')}
            </Button>
          ) : null}
        </Row>
        {connection && available?.paired && (
          <Row
            title={t('connector:serverAddress')}
            description={t('connector:serverAddressDescription')}
          >
            <Button
              disabled={busy}
              onClick={() => {
                setError(undefined)
                setNotice(undefined)
                setServerAddress(available.server ?? '')
              }}
            >
              {t('connector:changeServer')}
            </Button>
          </Row>
        )}
        {existing && (
          <Row
            title={t('connector:reuseExisting')}
            description={t('connector:reuseExistingDescription')}
          />
        )}
        {installation?.updateAvailable && (
          <Row
            title={t('connector:updateConnector')}
            description={t('connector:updateDescription', {
              current: installation.version ?? t('connector:currentVersionMissing'),
              bundled: installation.bundledVersion ?? t('connector:bundledVersionMissing'),
            })}
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
                    text: t('connector:paired'),
                  })
                })
            }}
          >
            <Row title={t('connector:computerName')}>
              <TextField
                aria-label={t('connector:computerNameLabel')}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                required
              />
            </Row>
            {connection ? (
              <>
                <Row
                  title={t('connector:consent')}
                  description={t('connector:consentDescription', {
                    name: connection.name,
                    url: connection.baseUrl,
                  })}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    {t('connector:consentLabel')}
                  </label>
                </Row>
                <Row title={t('connector:connect')}>
                  <Button type="submit" variant="primary" loading={busy} disabled={!consent}>
                    {t('connector:connect')}
                  </Button>
                </Row>
              </>
            ) : (
              <Row title={t('connector:noYuki')} description={t('connector:noYukiDescription')} />
            )}
          </form>
        )}
        {available?.paired && (
          <Row
            title={
              available.managed === false
                ? t('connector:independentConnection')
                : t('connector:localConnection')
            }
            description={
              available.managed === false
                ? t('connector:independentDescription')
                : t('connector:localDescription')
            }
          >
            {available.managed === false ? (
              <span>{runningText(t, available.running)}</span>
            ) : (
              <Toggle
                label={t('connector:localConnection')}
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
              <Banner status="failed">{t('connector:authorizationLostBanner')}</Banner>
            )}
            {available.supervision?.link === 'protocol_unsupported' && (
              <Banner status="failed">{t('connector:protocolUnsupportedBanner')}</Banner>
            )}
            <Row
              title={t('connector:linkStatus')}
              description={
                available.supervision?.reason
                  ? t('connector:lastReason', { reason: available.supervision.reason })
                  : undefined
              }
            >
              <span>{linkText(t, available)}</span>
            </Row>
            {available.supervision?.lastExit && (
              <Row
                title={t('connector:lastExit')}
                description={date(available.supervision.lastExit.at, {
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              >
                <span>
                  {available.supervision.lastExit.code !== null
                    ? t('connector:exitCode', { code: available.supervision.lastExit.code })
                    : t('connector:exitSignal', {
                        signal: String(available.supervision.lastExit.signal),
                      })}
                </span>
              </Row>
            )}
            <Row
              title={t('connector:autoRestart')}
              description={t('connector:autoRestartDescription')}
            >
              <span>
                {t('connector:restarts', { count: available.supervision?.restarts ?? 0 })}
              </span>
            </Row>
            <Row
              title={t('connector:exportDiagnostics')}
              description={t('connector:exportDiagnosticsDescription')}
            >
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    if (unwrap(await window.yuki.connector.exportDiagnostics()))
                      setNotice({ section: 'status', text: t('connector:diagnosticsExported') })
                  })
                }
              >
                {t('connector:exportDiagnostics')}
              </Button>
            </Row>
          </>
        )}
      </SettingsSection>
      {connection && (
        <Sheet
          title={t('connector:changeServer')}
          open={serverAddress !== undefined}
          onClose={() => {
            if (!busy) setServerAddress(undefined)
          }}
          actions={
            <>
              <Button disabled={busy} onClick={() => setServerAddress(undefined)}>
                {t('common:action.cancel')}
              </Button>
              <Button
                type="submit"
                form={serverForm}
                variant="primary"
                loading={busy}
                disabled={!serverAddress?.trim()}
              >
                {t('common:action.save')}
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
                  text: t('connector:serverSaved'),
                })
              }, 'server')
            }}
          >
            <p>{t('connector:serverSheetBody')}</p>
            <TextField
              aria-label={t('connector:serverAddress')}
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
          <SettingsSection title={t('connector:section.permission')}>
            {feedback('permission')}
            <Row
              title={t('connector:fullAccess')}
              description={
                available.fullAccess === undefined
                  ? t('connector:fullAccessUnsupported')
                  : t('connector:fullAccessDescription')
              }
            >
              {available.fullAccess !== undefined && (
                <Toggle
                  label={t('connector:fullAccess')}
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
                          changed.available && changed.catalogProblem
                            ? t(
                                enabled
                                  ? 'connector:fullAccessOnCatalog'
                                  : 'connector:fullAccessOffCatalog',
                                { problem: problemText(changed.catalogProblem) },
                              )
                            : t(enabled ? 'connector:fullAccessOn' : 'connector:fullAccessOff'),
                      })
                    }, 'permission')
                  }
                />
              )}
            </Row>
            {available.computer?.platform === 'darwin' &&
              available.supervision?.permissions &&
              macPermissions.map((permission) =>
                available.supervision!.permissions![permission] ? (
                  <Row
                    key={permission}
                    title={t(`connector:macPermission.${permission}.title`)}
                    description={t(`connector:macPermission.${permission}.description`)}
                  >
                    <span>{t('connector:allowed')}</span>
                  </Row>
                ) : (
                  <Row
                    key={permission}
                    title={t(`connector:macPermission.${permission}.title`)}
                    description={t(`connector:macPermission.${permission}.denied`)}
                  >
                    <span>{t('connector:notAllowed')}</span>
                    <Button
                      onClick={() =>
                        void perform(async () => {
                          unwrap(await window.yuki.connector.permissionSettings(permission))
                        }, 'permission')
                      }
                    >
                      {t('connector:openSystemSettings')}
                    </Button>
                  </Row>
                ),
              )}
          </SettingsSection>
          <SettingsSection title={t('connector:section.agents')}>
            {!editorOpen && !removing && feedback('agents')}
            {available.instances.map((instance) => {
              const remote = available.admission?.instances?.find(
                (item) => item.localId === instance.id,
              )
              const driver = driverName(instance.driver)
              const statusText = !remote
                ? t('connector:agentNotAdmitted')
                : remote.status !== 'available'
                  ? t('connector:agentNotReady', {
                      driver,
                      reason:
                        problemMessage(t, remote.errorType ?? '') ??
                        remote.errorType ??
                        remote.status ??
                        t('connector:noReason'),
                    })
                  : remote.online
                    ? instance.driver === 'claude'
                      ? t('connector:claudeFound')
                      : t('connector:nativeConnected', { driver })
                    : instance.driver === 'claude'
                      ? t('connector:claudeOffline')
                      : t('connector:nativeOffline', { driver })
              return (
                <Row
                  key={instance.id}
                  title={instance.label}
                  description={t('connector:agentDescription', { driver, status: statusText })}
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
                    {t('connector:edit')}
                  </Button>
                  <Button
                    variant="plain"
                    disabled={busy}
                    aria-label={t('connector:deleteName', { name: instance.label })}
                    onClick={() => setRemoving(instance)}
                  >
                    {t('connector:deleteEllipsis')}
                  </Button>
                </Row>
              )
            })}
            <Row
              title={t('connector:addAgentTitle')}
              description={t('connector:addAgentDescription')}
            >
              <Button
                disabled={busy}
                onClick={() => {
                  setInstanceId('')
                  setCreate(true)
                  setInstanceLabel(defaultAgentName(t, driver))
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
                {t('connector:addAgent')}
              </Button>
            </Row>
          </SettingsSection>
          <Sheet
            title={
              create
                ? t('connector:addAgentTitle')
                : t('connector:editName', { name: original?.label ?? instanceLabel })
            }
            width={560}
            open={editorOpen}
            onClose={() => {
              if (!busy) setEditorOpen(false)
            }}
            actions={
              <>
                <Button disabled={busy} onClick={() => setEditorOpen(false)}>
                  {t('common:action.cancel')}
                </Button>
                <Button
                  form={editorForm}
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={busy || (!candidateId && !command)}
                >
                  {t('common:action.save')}
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
                    ? t('connector:claudeDiagnosed')
                    : t('connector:nativeDiagnosed')
                  : (problemMessage(t, diagnostic.problem ?? '') ??
                    t('connector:notReady', { problem: String(diagnostic.problem) }))}
              </Banner>
            )}
            {original && (
              <Row title={t('connector:program')}>
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
                    {t('connector:checkReady')}
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
                  {t('connector:revealProgram')}
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
              <Row title={t('connector:agentType')}>
                <select
                  aria-label={t('connector:agentType')}
                  value={original?.driver ?? driver}
                  disabled={busy || !!original}
                  onChange={(event) => {
                    const next = event.target.value as ConnectorDriver
                    if (instanceLabel === defaultAgentName(t, driver))
                      setInstanceLabel(defaultAgentName(t, next))
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
                  <option value="acp">{t('connector:acpAgent')}</option>
                  {original && !['codex', 'claude', 'acp'].includes(original.driver) && (
                    <option value={original.driver}>
                      {t('connector:originalDriver', { driver: driverName(original.driver) })}
                    </option>
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
                    {t('connector:findInstalled', { name: nativeName })}
                  </Button>
                </div>
              )}
              {candidates.length > 1 && (
                <Row title={t('connector:programSource')}>
                  <select
                    aria-label={t('connector:programSource')}
                    value={candidateId}
                    onChange={(event) => setCandidateId(event.target.value)}
                  >
                    <option value="">{t('connector:chooseExecutableOption')}</option>
                    {candidates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Row>
              )}
              {candidates.length === 1 && candidateId && (
                <Row title={t('connector:found', { name: nativeName })}>
                  <span>{candidates[0]!.label}</span>
                </Row>
              )}
              <Row title={t('connector:displayName')}>
                <TextField
                  aria-label={t('connector:displayNameLabel')}
                  value={instanceLabel}
                  onChange={(event) => {
                    setInstanceLabel(event.target.value)
                    setLabelChanged(true)
                  }}
                  required
                />
              </Row>
              {(original?.driver ?? driver) === 'acp' ? (
                <Row title={t('connector:program')}>{executableSelection}</Row>
              ) : (
                <details>
                  <summary>{t('connector:advancedProgram')}</summary>
                  {executableSelection}
                </details>
              )}
              {(original?.driver ?? driver) === 'acp' && (
                <div className={styles.nativeArguments}>
                  <p className={styles.notice}>{t('connector:chooseAcp')}</p>
                  <h4>{t('connector:argumentsHeading')}</h4>
                  <p className={styles.notice}>{t('connector:argumentsHint')}</p>
                  {agentArgs.map((value, index) => (
                    <Row key={index} title={t('connector:argument', { number: index + 1 })}>
                      <TextField
                        aria-label={t('connector:acpArgument', { number: index + 1 })}
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
                        aria-label={t('connector:removeAcpArgument', { number: index + 1 })}
                        onClick={() => {
                          setAgentArgs(agentArgs.filter((_, item) => item !== index))
                          setArgsChanged(true)
                        }}
                      >
                        {t('common:action.remove')}
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
                    {t('connector:addArgument')}
                  </Button>
                </div>
              )}
            </form>
          </Sheet>
          <Sheet
            title={t('connector:removeTitle')}
            open={!!removing}
            onClose={() => {
              if (!busy) setRemoving(undefined)
            }}
            actions={
              <>
                <Button disabled={busy} onClick={() => setRemoving(undefined)}>
                  {t('common:action.cancel')}
                </Button>
                <Button variant="destructive" loading={busy} onClick={() => void remove()}>
                  {t('connector:removeConfirm')}
                </Button>
              </>
            }
          >
            {removing && feedback('agents')}
            <p>{t('connector:removeBody', { label: removing?.label ?? '' })}</p>
          </Sheet>
        </>
      )}
      <details>
        <summary>{t('connector:troubleshooting')}</summary>
        <SettingsSection title={t('connector:section.technical')}>
          {feedback('installation')}
          {existing && (
            <>
              <Row title={t('connector:existingVersion')}>
                <span>{existing.state.version ?? t('connector:notProvided')}</span>
              </Row>
              <Row title={t('connector:existingIndependent')}>
                <span>{runningText(t, existing.state.running)}</span>
              </Row>
              <Row title={t('connector:existingServerLink')}>
                <span>
                  {existing.state.admission?.connected
                    ? t('connector:state.connected')
                    : t('connector:state.unconfirmed')}
                </span>
              </Row>
            </>
          )}
          {available && (
            <>
              <Row title={t('connector:connectorVersion')} description={available.runtime}>
                <span>
                  {t('connector:versionProtocol', {
                    version: available.version ?? t('connector:notProvided'),
                    protocol: available.protocol ?? t('connector:notProvided'),
                  })}
                </span>
              </Row>
              <Row title={t('connector:existingData')} description={available.dataDirectory}>
                <span>{available.deviceId ?? t('connector:notPaired')}</span>
              </Row>
              <Row title={t('connector:serverProtocol')}>
                <span>{serverProtocol ?? t('connector:serverProtocolMissing')}</span>
              </Row>
              {available.paired && (
                <Row title={t('connector:authorizationSource')} description={available.server}>
                  <span>
                    {available.admission?.matched
                      ? t('connector:currentOwner')
                      : t('connector:ownerUnconfirmed')}
                  </span>
                </Row>
              )}
              <Row title={t('connector:serverAdmission')}>
                <span>
                  {available.admission?.connected
                    ? t('connector:state.connected')
                    : t('connector:state.unconfirmed')}
                </span>
              </Row>
              {available.computer && (
                <Row title={t('connector:localRuntime')}>
                  <span>
                    {available.computer.platform} ·{' '}
                    {available.computer.shell ?? t('connector:noShell')}
                  </span>
                </Row>
              )}
            </>
          )}
        </SettingsSection>
        <details>
          <summary>{t('connector:advancedInstallation')}</summary>
          <SettingsSection description={t('connector:advancedInstallationDescription')}>
            <Row title={t('connector:existingPython')}>
              <TextField
                aria-label={t('connector:existingPython')}
                value={externalPython}
                onChange={(event) => setExternalPython(event.target.value)}
              />
            </Row>
            <Row title={t('connector:existingDataDirectory')}>
              <TextField
                aria-label={t('connector:existingDataDirectory')}
                value={externalData}
                onChange={(event) => setExternalData(event.target.value)}
              />
            </Row>
            <Row title={t('connector:useExistingInstallation')}>
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
                {t('connector:readAndUseExisting')}
              </Button>
            </Row>
          </SettingsSection>
        </details>
        {available && !available.paired && (
          <details>
            <summary>{t('connector:advancedCode')}</summary>
            <SettingsSection description={t('connector:advancedCodeDescription')}>
              <Row title={t('connector:manualServer')}>
                <TextField
                  aria-label={t('connector:manualServerLabel')}
                  type="url"
                  value={manualServer}
                  onChange={(event) => setManualServer(event.target.value)}
                />
              </Row>
              <Row title={t('connector:computerCode')}>
                <TextField
                  aria-label={t('connector:manualCodeLabel')}
                  type="password"
                  autoComplete="off"
                  value={manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                />
              </Row>
              <Row title={t('connector:useManualCode')}>
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
                  {t('connector:connectWithCode')}
                </Button>
              </Row>
            </SettingsSection>
          </details>
        )}
        {driver !== 'acp' && (
          <SettingsSection>
            <Row title={t('connector:installGuide')}>
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
                {t('connector:installGuideFor', { driver: driverName(driver) })}
              </Button>
            </Row>
          </SettingsSection>
        )}
      </details>
    </>
  )
}
