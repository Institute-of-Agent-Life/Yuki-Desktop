import { useEffect, useRef, useState } from 'react'
import type { Connection } from '../../shared/api'
import type { SandboxProfile } from '../../shared/local-bot'
import type { ProviderPreset } from '../../shared/models'
import type { RemoteCheck, RemoteDeployState, RemoteDeployStep, SshAccess } from '../../shared/ssh'
import { ModelConnectionForm, type ConnectionDraft } from './ModelConnectionForm'
import { RemoteProblem, useSshForm } from './SshForm'
import { Banner, Button, TextField } from '../components/Controls'
import { unwrap } from '../queries/client'
import { useTranslation } from '../i18n'
import styles from '../App.module.css'
import { useGlass } from '../materials/glass'

/** "Deploy to my server": the same card, steps and progress as deploying on this computer. */
export function RemoteDeploy({
  active,
  label,
  back,
  done,
}: {
  active: boolean
  label: string
  back(): void
  done(connection: Connection, activate?: boolean): void
}) {
  const { t } = useTranslation(['remoteDeploy', 'ssh'])
  const card = useGlass<HTMLElement>('card')
  const activeRef = useRef(active)
  activeRef.current = active
  const [state, setState] = useState<RemoteDeployState>()
  const [server, setServer] = useState<{ access: SshAccess; directory: string }>(),
    [check, setCheck] = useState<RemoteCheck>(),
    [presets, setPresets] = useState<ProviderPreset[]>()
  const [characterName, setCharacterName] = useState('Yuki'),
    [personName, setPersonName] = useState(''),
    [preset, setPreset] = useState(0),
    [sandboxProfile, setSandboxProfile] = useState<SandboxProfile>('lite'),
    [model, setModel] = useState<ConnectionDraft>({ name: '', baseUrl: '', key: '', models: [] })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [retry, setRetry] = useState<() => Promise<void>>(),
    [mirror, setMirror] = useState(false),
    [progress, setProgress] = useState<RemoteDeployStep>()
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) top.current?.scrollIntoView({ block: 'nearest' })
  }, [error])
  useEffect(() => {
    void window.yuki.remoteDeploy.state().then(unwrap).then(setState)
    return window.yuki.remoteDeploy.onProgress(setProgress)
  }, [])
  const ssh = useSshForm({
    confirmLabel: t('remoteDeploy:checkEnvironment'),
    submit: async (access, directory) => {
      const result = unwrap(await window.yuki.remoteDeploy.check(access))
      setServer({ access, directory })
      setCheck(result)
      setSandboxProfile(result.recommended)
    },
  })
  /** Run one step; on failure the same step can be run again as it is. */
  const step = async (work: () => Promise<void>, again = true) => {
    setBusy(true)
    setError(undefined)
    setRetry(undefined)
    try {
      await work()
    } catch (failure) {
      setError(failure)
      if (again) setRetry(() => () => step(work))
    } finally {
      setBusy(false)
      setProgress(undefined)
    }
  }
  const prepare = (access: SshAccess) =>
    step(async () => {
      const catalog = unwrap(await window.yuki.remoteDeploy.prepare(access))
      setPresets(catalog)
      setModel((current) => ({
        ...current,
        name: catalog[0]!.display_name,
        baseUrl: current.baseUrl || catalog[0]!.default_base_url,
      }))
    })
  const installDocker = (access: SshAccess, viaMirror: boolean) =>
    step(async () => {
      try {
        setCheck(unwrap(await window.yuki.remoteDeploy.installDocker(access, viaMirror)))
      } catch (failure) {
        setMirror(true)
        throw failure
      }
    }, false)
  const deploy = () =>
    step(async () => {
      const selected = presets![preset]!
      const connection = unwrap(
        await window.yuki.remoteDeploy.deploy({
          access: server!.access,
          directory: server!.directory,
          label,
          characterName,
          personName,
          sandboxProfile,
          model: {
            protocol: selected.protocol,
            provider: selected.provider,
            base_url: model.baseUrl,
            api_key: model.key,
            model: model.models[0]!,
          },
        }),
      )
      setModel((current) => ({ ...current, key: '' }))
      done(connection, activeRef.current)
    })
  const usable =
    !!check &&
    check.privilege !== 'password' &&
    check.os === 'Linux' &&
    ['x86_64', 'amd64', 'aarch64', 'arm64'].includes(check.arch)
  return (
    <div className={styles.welcome}>
      <section ref={card.ref} data-glass="card" className={styles.welcomeInner}>
        <h1>{t('remoteDeploy:title')}</h1>
        <p>{t('remoteDeploy:intro')}</p>
        <div ref={top} />
        {state && !state.bundled && <Banner status="failed">{t('remoteDeploy:notBundled')}</Banner>}
        <RemoteProblem error={error} />
        {mirror && !check?.docker && <Banner>{t('remoteDeploy:mirrorExplain')}</Banner>}
        {progress && <p role="status">{t(`remoteDeploy:progress.${progress}`)}</p>}
        {check?.privilege === 'password' && (
          <Banner status="failed">{t('ssh:problem.remote_sudo_password_required')}</Banner>
        )}
        {check && !usable && check.privilege !== 'password' && (
          <Banner status="failed">{t('remoteDeploy:unsupportedSystem')}</Banner>
        )}
        {!server ? (
          <>
            {ssh.fields}
            <details>
              <summary>{t('remoteDeploy:introSummary')}</summary>
              <p>{t('remoteDeploy:introDetails')}</p>
            </details>
            <div className={styles.actions}>
              <Button variant="plain" onClick={back}>
                {t('remoteDeploy:back')}
              </Button>
              {ssh.button}
            </div>
          </>
        ) : (
          <form
            className={styles.server}
            onSubmit={(event) => {
              event.preventDefault()
              void (retry ? retry() : deploy())
            }}
          >
            <label>{t('remoteDeploy:environment')}</label>
            <small>
              {t('remoteDeploy:summary', {
                os: check!.os,
                arch: check!.arch,
                memory: check!.memoryMiB,
                disk: check!.diskMiB,
              })}
            </small>
            <small>
              {check!.docker ? t('remoteDeploy:dockerInstalled') : t('remoteDeploy:dockerMissing')}
            </small>
            {presets && (
              <>
                <label htmlFor="remote-character">{t('remoteDeploy:characterName')}</label>
                <TextField
                  id="remote-character"
                  value={characterName}
                  disabled={busy}
                  onChange={(event) => setCharacterName(event.target.value)}
                  required
                />
                <label htmlFor="remote-person">{t('remoteDeploy:personName')}</label>
                <TextField
                  id="remote-person"
                  value={personName}
                  disabled={busy}
                  onChange={(event) => setPersonName(event.target.value)}
                  required
                />
                <label htmlFor="remote-preset">{t('remoteDeploy:preset')}</label>
                <select
                  id="remote-preset"
                  value={preset}
                  disabled={busy}
                  onChange={(event) => {
                    const index = Number(event.target.value),
                      selected = presets[index]!
                    setPreset(index)
                    setModel((current) => ({
                      ...current,
                      name: selected.display_name,
                      baseUrl: selected.default_base_url,
                    }))
                  }}
                >
                  {presets.map((item, index) => (
                    <option key={index} value={index}>
                      {item.display_name}
                    </option>
                  ))}
                </select>
                <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <ModelConnectionForm
                    value={model}
                    change={setModel}
                    multiple={false}
                    showName={false}
                  />
                </fieldset>
                <label htmlFor="remote-sandbox">{t('remoteDeploy:sandbox')}</label>
                <select
                  id="remote-sandbox"
                  value={sandboxProfile}
                  disabled={busy}
                  onChange={(event) => setSandboxProfile(event.target.value as SandboxProfile)}
                >
                  <option value="desktop">{t('remoteDeploy:sandboxDesktop')}</option>
                  <option value="headless">{t('remoteDeploy:sandboxHeadless')}</option>
                  <option value="lite">{t('remoteDeploy:sandboxLite')}</option>
                </select>
                <small>{t('remoteDeploy:sandboxRecommended')}</small>
              </>
            )}
            <div className={styles.actions}>
              <Button type="button" variant="plain" onClick={back}>
                {t('remoteDeploy:back')}
              </Button>
              {usable && !check!.docker && mirror && (
                <Button
                  type="button"
                  loading={busy}
                  onClick={() => void installDocker(server.access, true)}
                >
                  {t('remoteDeploy:mirrorRetry')}
                </Button>
              )}
              {usable && !check!.docker && (
                <Button
                  type="button"
                  variant="primary"
                  loading={busy}
                  onClick={() => void installDocker(server.access, false)}
                >
                  {t('remoteDeploy:installDocker')}
                </Button>
              )}
              {usable && check!.docker && !presets && (
                <Button
                  type="button"
                  variant="primary"
                  loading={busy}
                  disabled={!state?.bundled}
                  onClick={() => void (retry ? retry() : prepare(server.access))}
                >
                  {retry ? t('remoteDeploy:retryStep') : t('remoteDeploy:prepareImage')}
                </Button>
              )}
              {presets && (
                <Button type="submit" variant="primary" loading={busy}>
                  {retry ? t('remoteDeploy:retryStep') : t('remoteDeploy:start')}
                </Button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
