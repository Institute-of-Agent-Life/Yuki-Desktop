import { useEffect, useRef, useState } from 'react'
import { Clipboard, Snowflake } from 'lucide-react'
import type { Connection, Meta, PendingPairing } from '../../shared/api'
import { parsePairing } from '../../shared/pairing'
import { Banner, Button, TextField } from '../components/Controls'
import { PairingAvatar } from '../components/CharacterAvatar'
import { ClientProblem, problemText, unwrap } from '../queries/client'
import { TailscaleGuide } from './TailscaleGuide'
import { useSshForm } from './SshForm'
import { useTranslation } from '../i18n'
import styles from '../App.module.css'
import { useGlass } from '../materials/glass'

export function Pairing({
  label,
  initialLink,
  initialServer = '',
  reconnect = false,
  onDone,
  onResumeLogout,
  startAtServer = false,
  onCancel,
  onUpdate,
  onDeploy,
  onSkip,
  onSettings,
  onHelp,
  active = true,
}: {
  label: string
  initialLink: string | null
  initialServer?: string
  reconnect?: boolean
  startAtServer?: boolean
  active?: boolean
  onCancel?(): void
  onUpdate(): void
  onDeploy?(): void
  onSkip?(): void
  onSettings?(): void
  onHelp?(): void
  onDone(connection: Connection, activate?: boolean): void
  onResumeLogout(characterId: string): Promise<void>
}) {
  const card = useGlass<HTMLDivElement>('card')
  const { t } = useTranslation(['pairing', 'ssh', 'errors', 'common'])
  const [ssh, setSsh] = useState(false)
  const sshForm = useSshForm({
    confirmLabel: t('ssh:confirmConnect'),
    submit: async (access, directory) => {
      const connection = unwrap(await window.yuki.ssh.pair({ access, directory, label: device }))
      onDone(connection, form.current.active)
    },
  })
  const [step, setStep] = useState<'welcome' | 'connect' | 'confirm'>(
    initialServer || startAtServer ? 'connect' : 'welcome',
  )
  const [input, setInput] = useState(''),
    [server, setServer] = useState(initialServer),
    [device, setDevice] = useState(label)
  const [manual, setManual] = useState(!!initialServer)
  const [confirmed, setConfirmed] = useState<{ server: string; meta: Meta }>()
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [updateNeeded, setUpdateNeeded] = useState(false),
    [pendingLogout, setPendingLogout] = useState<string>()
  const current = useRef<object | undefined>(undefined)
  const form = useRef({ input, server, active })
  form.current = { input, server, active }
  useEffect(() => {
    if (!active) {
      current.current = undefined
      setBusy(false)
    }
  }, [active])
  const refreshPending = () => window.yuki.client.pendingPairings().then(unwrap).then(setPending)
  const leave = () => {
    current.current = undefined
    setBusy(false)
    setError('')
    setConfirmed(undefined)
  }
  const run = async (action: (owner: object) => Promise<void>, pairing = false) => {
    const owner = {}
    current.current = owner
    setBusy(true)
    setError('')
    setUpdateNeeded(false)
    setPendingLogout(undefined)
    try {
      await action(owner)
    } catch (failure) {
      if (current.current !== owner) return
      const code = failure instanceof ClientProblem ? failure.code : ''
      setError(
        pairing && code === 'unauthenticated'
          ? problemText('invalid_code')
          : failure instanceof Error
            ? failure.message
            : t('errors:notCompleted'),
      )
      setUpdateNeeded(code === 'client_upgrade_required')
      if (code === 'logout_pending' && confirmed) setPendingLogout(confirmed.meta.character.id)
      await refreshPending()
    } finally {
      if (current.current === owner) setBusy(false)
    }
  }
  const inspect = (value: string = input, address: string = server) => {
    const parsed = parsePairing(value),
      base = parsed?.server ?? address
    if (!base.trim()) {
      setManual(true)
      setError(t('pairing:noServer'))
      return
    }
    void run(async (owner) => {
      const meta = unwrap(await window.yuki.client.meta(base))
      if (current.current !== owner || !form.current.active) return
      setServer(base)
      setConfirmed({ server: base, meta })
      setStep('confirm')
    })
  }
  useEffect(() => {
    void refreshPending()
    return () => {
      current.current = undefined
    }
  }, [])
  useEffect(() => {
    const prefill = (link: string) => {
      const parsed = parsePairing(link)
      if (!parsed) return
      leave()
      setInput(link)
      setStep('connect')
      if (parsed.server) {
        setServer(parsed.server)
        inspect(link, parsed.server)
      }
    }
    if (initialLink) prefill(initialLink)
    return window.yuki.onPairLink(prefill)
    // The incoming link owns this check; subsequent form edits invalidate it.
  }, [initialLink])
  const parsed = parsePairing(input)
  const awaiting =
    confirmed && pending.find((item) => item.characterId === confirmed.meta.character.id)
  const finish = async (
    operation: Promise<import('../../shared/api').ApiReply<Connection>>,
    owner: object,
  ) => {
    const value = unwrap(await operation)
    const activate = current.current === owner && form.current.active
    if (form.current.input === input && form.current.server === server) {
      leave()
      setInput('')
      setStep('connect')
      setServer(initialServer)
      setManual(!!initialServer)
    }
    setPending((items) => items.filter((item) => item.deviceId !== value.deviceId))
    onDone(value, activate)
  }
  const pair = () => {
    if (!confirmed || !parsed) return
    if (parsed.server && parsed.server !== confirmed.server) {
      inspect(input, parsed.server)
      return
    }
    void run(
      (owner) => finish(window.yuki.client.pair(confirmed.server, parsed.code, device), owner),
      true,
    )
  }
  const cancel = () => {
    leave()
    setInput('')
    if (onCancel) onCancel()
    else setStep('welcome')
  }
  return (
    <div className={styles.welcome}>
      <div ref={card.ref} data-glass="card" className={styles.welcomeInner}>
        {step === 'welcome' ? (
          <Snowflake className={styles.welcomeMark} size={96} strokeWidth={1} />
        ) : (
          confirmed && (
            <PairingAvatar
              server={confirmed.server}
              name={confirmed.meta.character.display_name}
              size={56}
              avatarUrl={confirmed.meta.character.avatar_url}
            />
          )
        )}
        <h1>
          {ssh
            ? t('ssh:connectOverSsh')
            : step === 'welcome'
              ? 'Yuki'
              : (confirmed?.meta.character.display_name ?? t('pairing:connectExisting'))}
        </h1>
        <p>
          {ssh
            ? t('ssh:connectOverSshDescription')
            : step === 'welcome'
              ? t('pairing:welcomeDescription')
              : step === 'confirm'
                ? t('pairing:confirmDescription')
                : t('pairing:connectDescription')}
        </p>
        {error && <Banner status="failed">{error}</Banner>}
        {updateNeeded && <Button onClick={onUpdate}>{t('pairing:viewUpdate')}</Button>}
        {pendingLogout && (
          <Button onClick={() => void run(async () => onResumeLogout(pendingLogout))}>
            {t('pairing:resumeLogout')}
          </Button>
        )}
        {reconnect && <Banner>{t('pairing:reconnect')}</Banner>}
        {pending.map((item) => (
          <div key={item.deviceId} className={styles.server}>
            <p>{t('pairing:pendingCredentials', { name: item.name })}</p>
            <div className={styles.actions}>
              <Button
                loading={busy}
                onClick={() =>
                  void run((owner) =>
                    finish(
                      window.yuki.client.resumePairing(item.characterId, item.deviceId),
                      owner,
                    ),
                  )
                }
              >
                {t('pairing:resume', { name: item.name })}
              </Button>
              <Button
                variant="plain"
                onClick={() =>
                  void run(async () => {
                    unwrap(await window.yuki.client.forgetPairing(item.characterId, item.deviceId))
                    await refreshPending()
                  })
                }
              >
                {t('pairing:forgetPending')}
              </Button>
            </div>
            {!item.persistentCredentials && <small>{t('pairing:notPersistent')}</small>}
          </div>
        ))}
        {step === 'welcome' ? (
          <>
            <div className={styles.entryChoices}>
              <Button variant="primary" large onClick={() => setStep('connect')}>
                {t('pairing:connectExisting')}
              </Button>
              {onDeploy && (
                <Button large onClick={onDeploy}>
                  {t('pairing:deployLocal')}
                </Button>
              )}
              {onSkip && (
                <Button variant="plain" onClick={onSkip}>
                  {t('pairing:skip')}
                </Button>
              )}
            </div>
            <div className={styles.actions}>
              {onSettings && (
                <Button variant="plain" onClick={onSettings}>
                  {t('pairing:settings')}
                </Button>
              )}
              {onHelp && (
                <Button variant="plain" onClick={onHelp}>
                  {t('pairing:help')}
                </Button>
              )}
            </div>
          </>
        ) : ssh ? (
          <>
            {sshForm.fields}
            <div className={styles.actions}>
              <Button variant="plain" onClick={() => setSsh(false)}>
                {t('ssh:back')}
              </Button>
              {sshForm.button}
            </div>
          </>
        ) : (
          <form
            className={styles.server}
            onSubmit={(event) => {
              event.preventDefault()
              if (step === 'confirm') pair()
              else inspect()
            }}
          >
            {confirmed && <small>{t('pairing:server', { server: confirmed.server })}</small>}
            <small>{t('pairing:reachability')}</small>
            <TailscaleGuide onError={setError} />
            {step === 'connect' && !confirmed && (
              <Button type="button" variant="plain" onClick={() => setSsh(true)}>
                {t('ssh:connectOverSsh')}
              </Button>
            )}
            <label htmlFor="pair-code">{t('pairing:codeLabel')}</label>
            <div className={styles.codeRow}>
              <TextField
                id="pair-code"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={input}
                onChange={(event) => {
                  const value = event.target.value,
                    next = parsePairing(value)
                  current.current = undefined
                  setBusy(false)
                  setInput(value)
                  setError('')
                  if (next?.server && next.server !== confirmed?.server) {
                    setConfirmed(undefined)
                    setStep('connect')
                  }
                }}
              />
              <Button
                type="button"
                onClick={() =>
                  void window.yuki.client
                    .paste()
                    .then(unwrap)
                    .then((value) => {
                      leave()
                      setInput(value)
                      setStep('connect')
                      if (parsePairing(value)?.server) inspect(value)
                    })
                    .catch((failure) => setError(failure.message))
                }
              >
                <Clipboard size={14} aria-hidden="true" />
                {t('common:edit.paste')}
              </Button>
            </div>
            <small>{t('pairing:codeHint')}</small>
            {!manual && !confirmed && (
              <Button variant="plain" type="button" onClick={() => setManual(true)}>
                {t('pairing:enterServer')}
              </Button>
            )}
            {manual && !confirmed && (
              <>
                <label htmlFor="server-url">{t('pairing:serverAddress')}</label>
                <TextField
                  id="server-url"
                  autoComplete="url"
                  value={server}
                  placeholder="https://"
                  onChange={(event) => {
                    leave()
                    setServer(event.target.value)
                  }}
                />
              </>
            )}
            {step === 'confirm' && (
              <>
                <label htmlFor="device-name">{t('pairing:deviceName')}</label>
                <TextField
                  id="device-name"
                  value={device}
                  onChange={(event) => setDevice(event.target.value)}
                />
              </>
            )}
            <div className={styles.actions}>
              <Button
                type="button"
                variant="plain"
                onClick={() => {
                  if (step === 'confirm') {
                    leave()
                    setStep('connect')
                  } else cancel()
                }}
              >
                {t('common:action.back')}
              </Button>
              {step === 'confirm' ? (
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!parsed || !device.trim() || !!awaiting}
                >
                  {t('pairing:confirmConnect')}
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!input.trim() && !server.trim()}
                >
                  {t('common:action.continue')}
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
