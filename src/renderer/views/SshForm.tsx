import { useId, useState, type ReactNode } from 'react'
import type { SshAccess, SshAuth, SshProbe } from '../../shared/ssh'
import { Banner, Button, TextField } from '../components/Controls'
import { ClientProblem, unwrap } from '../queries/client'
import { useTranslation } from '../i18n'
import styles from '../App.module.css'

/** A failure as the person needs it: what it means, and what the server printed (foldable). */
export function RemoteProblem({ error }: { error: unknown }) {
  const { t } = useTranslation(['ssh'])
  if (!error) return null
  return (
    <>
      <Banner status="failed">{error instanceof Error ? error.message : String(error)}</Banner>
      {error instanceof ClientProblem && error.reason && (
        <details open>
          <summary>{t('ssh:serverOutput')}</summary>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontSize: 12,
              maxHeight: 160,
              overflow: 'auto',
            }}
          >
            {error.reason}
          </pre>
        </details>
      )}
    </>
  )
}

/**
 * Where to log in, then the host's key before anything is sent to it. The fields go in the
 * card or dialog body and the button in its own actions row; `submit` receives the login with
 * the fingerprint the person confirmed.
 */
export function useSshForm({
  confirmLabel,
  submit,
  directory: showDirectory = true,
}: {
  confirmLabel: string
  submit(access: SshAccess, directory: string): Promise<void>
  directory?: boolean
}) {
  const { t } = useTranslation(['ssh'])
  const id = useId(),
    formId = `${id}-form`
  const [address, setAddress] = useState(''),
    [port, setPort] = useState('22'),
    [auth, setAuth] = useState<SshAuth['kind']>('password'),
    [password, setPassword] = useState(''),
    [keyPath, setKeyPath] = useState(''),
    [passphrase, setPassphrase] = useState(''),
    [directory, setDirectory] = useState('~/yuki')
  const [probe, setProbe] = useState<SshProbe>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>()
  const at = address.lastIndexOf('@'),
    host = address.slice(at + 1).trim(),
    user = at > 0 ? address.slice(0, at).trim() : 'root'
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value)
      setProbe(undefined)
      setError(undefined)
    }
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await work()
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  const check = () =>
    run(async () => setProbe(unwrap(await window.yuki.ssh.probe(host, Number(port)))))
  const confirm = () =>
    run(() =>
      submit(
        {
          target: {
            host,
            port: Number(port),
            user,
            auth: auth === 'key' ? { kind: 'key', path: keyPath } : { kind: auth },
          },
          fingerprint: probe!.fingerprint,
          ...(auth === 'password'
            ? { secret: password }
            : auth === 'key'
              ? { secret: passphrase }
              : {}),
        },
        directory,
      ),
    )
  const fields: ReactNode = (
    <form
      id={formId}
      className={styles.server}
      onSubmit={(event) => {
        event.preventDefault()
        void (probe ? confirm() : check())
      }}
    >
      <RemoteProblem error={error} />
      {error instanceof ClientProblem && error.code === 'ssh_host_key_changed' && (
        <Button
          type="button"
          onClick={() =>
            void run(async () => {
              unwrap(await window.yuki.ssh.forgetHost(host, Number(port)))
              setProbe(unwrap(await window.yuki.ssh.probe(host, Number(port))))
            })
          }
        >
          {t('ssh:forgetHost')}
        </Button>
      )}
      <label htmlFor={`${id}-address`}>{t('ssh:address')}</label>
      <TextField
        id={`${id}-address`}
        value={address}
        autoComplete="off"
        spellCheck={false}
        placeholder="root@203.0.113.10"
        onChange={(event) => edit(setAddress)(event.target.value)}
        required
      />
      <label htmlFor={`${id}-port`}>{t('ssh:port')}</label>
      <TextField
        id={`${id}-port`}
        type="number"
        min={1}
        max={65535}
        value={port}
        onChange={(event) => edit(setPort)(event.target.value)}
        required
      />
      <label htmlFor={`${id}-auth`}>{t('ssh:auth')}</label>
      <select
        id={`${id}-auth`}
        value={auth}
        onChange={(event) => edit(setAuth)(event.target.value as SshAuth['kind'])}
      >
        <option value="password">{t('ssh:authPassword')}</option>
        <option value="key">{t('ssh:authKey')}</option>
        <option value="agent">{t('ssh:authAgent')}</option>
      </select>
      {auth === 'password' && (
        <>
          <label htmlFor={`${id}-password`}>{t('ssh:password')}</label>
          <TextField
            id={`${id}-password`}
            type="password"
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </>
      )}
      {auth === 'key' && (
        <>
          <label htmlFor={`${id}-key`}>{t('ssh:keyPath')}</label>
          <div className={styles.codeRow}>
            <TextField
              id={`${id}-key`}
              value={keyPath}
              spellCheck={false}
              onChange={(event) => edit(setKeyPath)(event.target.value)}
              required
            />
            <Button
              type="button"
              onClick={() =>
                void window.yuki.ssh
                  .chooseKey()
                  .then(unwrap)
                  .then((value) => value && edit(setKeyPath)(value))
              }
            >
              {t('ssh:chooseKey')}
            </Button>
          </div>
          <label htmlFor={`${id}-passphrase`}>{t('ssh:passphrase')}</label>
          <TextField
            id={`${id}-passphrase`}
            type="password"
            autoComplete="off"
            placeholder={t('ssh:passphraseHint')}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </>
      )}
      {showDirectory && (
        <>
          <label htmlFor={`${id}-directory`}>{t('ssh:directory')}</label>
          <TextField
            id={`${id}-directory`}
            value={directory}
            spellCheck={false}
            onChange={(event) => setDirectory(event.target.value)}
            required
          />
        </>
      )}
      {probe && (
        <>
          <label htmlFor={`${id}-fingerprint`}>{t('ssh:fingerprint')}</label>
          <TextField
            id={`${id}-fingerprint`}
            readOnly
            value={probe.fingerprint}
            spellCheck={false}
          />
          <small>{probe.known ? t('ssh:fingerprintKnown') : t('ssh:fingerprintFirst')}</small>
        </>
      )}
      <details>
        <summary>{t('ssh:help')}</summary>
        <p>{t('ssh:addressHint')}</p>
        <p>{t('ssh:secretStored')}</p>
        {showDirectory && <p>{t('ssh:directoryHint')}</p>}
        <p>{t('ssh:limitations')}</p>
      </details>
    </form>
  )
  const button: ReactNode = (
    <Button type="submit" form={formId} variant="primary" loading={busy} disabled={!host}>
      {probe ? confirmLabel : t('ssh:checkHost')}
    </Button>
  )
  return { fields, button, busy }
}
