import { useEffect, useRef, useState } from 'react'
import type { Connection } from '../../shared/api'
import type { LocalBotState, SandboxProfile } from '../../shared/local-bot'
import type { ProviderPreset } from '../../shared/models'
import { ModelConnectionForm, type ConnectionDraft } from './ModelConnectionForm'
import { Banner, Button, TextField } from '../components/Controls'
import { unwrap, problemText, ClientProblem } from '../queries/client'
import { useTranslation } from '../i18n'
import styles from '../App.module.css'
import { useGlass } from '../materials/glass'

export function LocalBot({
  active,
  back,
  done,
}: {
  active: boolean
  back(): void
  done(connection: Connection, activate?: boolean): void
}) {
  const card = useGlass<HTMLElement>('card')
  const { t } = useTranslation(['localBot'])
  const mounted = useRef(true)
  const activeRef = useRef(active)
  activeRef.current = active
  const [state, setState] = useState<LocalBotState>()
  const [directory, setDirectory] = useState(''),
    [characterName, setCharacterName] = useState('Yuki'),
    [personName, setPersonName] = useState('')
  const [port, setPort] = useState('8080')
  const [sandboxProfile, setSandboxProfile] = useState<SandboxProfile>('desktop')
  const [presets, setPresets] = useState<ProviderPreset[]>()
  const [preset, setPreset] = useState(0)
  const [modelConnection, setModelConnection] = useState<ConnectionDraft>({
    name: '',
    baseUrl: '',
    key: '',
    models: [],
  })
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState('')
  const refresh = async () => {
    const value = unwrap(await window.yuki.localBot.state())
    setState(value)
    if (value.installation) {
      setDirectory(value.installation.directory)
      setPort(String(value.installation.port))
      setCharacterName(value.installation.characterName)
      setPersonName(value.installation.personName)
      setSandboxProfile(value.installation.sandboxProfile ?? 'desktop')
    }
    if (!value.configured && value.docker && value.bundled && presets === undefined) {
      const catalog = unwrap(await window.yuki.localBot.presets())
      setPresets(catalog)
      setModelConnection((current) => ({
        ...current,
        name: catalog[0]!.display_name,
        baseUrl: current.baseUrl || catalog[0]!.default_base_url,
      }))
    }
  }
  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.yuki.localBot.onProgress(setProgress)
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (active) void refresh().catch((failure) => setError(failure.message))
  }, [active])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (failure) {
      setError(
        failure instanceof ClientProblem
          ? problemText(failure.code)
          : failure instanceof Error
            ? failure.message
            : t('localBot:failed'),
      )
      await refresh()
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <div className={styles.welcome}>
      <section ref={card.ref} data-glass="card" className={styles.welcomeInner}>
        <h1>{t('localBot:title')}</h1>
        <p>{t('localBot:description')}</p>
        {error && <Banner status="failed">{error}</Banner>}
        {progress && <p role="status">{progress}</p>}
        {state && !state.docker && (
          <Banner>
            {t('localBot:dockerMissing')}
            <Button
              onClick={() =>
                void window.yuki.client.external('https://docs.docker.com/get-started/get-docker/')
              }
            >
              {t('localBot:dockerHelp')}
            </Button>
          </Banner>
        )}
        {state && !state.bundled && <Banner status="failed">{t('localBot:notBundled')}</Banner>}
        <form
          className={styles.server}
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              const connection = unwrap(
                await window.yuki.localBot.deploy({
                  directory,
                  port: Number(port),
                  characterName,
                  personName,
                  sandboxProfile,
                  ...(state?.configured
                    ? {}
                    : {
                        model: {
                          protocol: presets![preset]!.protocol,
                          provider: presets![preset]!.provider,
                          base_url: modelConnection.baseUrl,
                          api_key: modelConnection.key,
                          model: modelConnection.models[0]!,
                        },
                      }),
                }),
              )
              setModelConnection((current) => ({ ...current, key: '' }))
              done(connection, mounted.current && activeRef.current)
            })
          }}
        >
          <label htmlFor="local-directory">{t('localBot:directory')}</label>
          <div className={styles.codeRow}>
            <TextField id="local-directory" value={directory} readOnly />
            <Button
              type="button"
              disabled={busy || !!state?.installation}
              onClick={() =>
                void window.yuki.localBot
                  .chooseDirectory()
                  .then(unwrap)
                  .then((value) => {
                    if (value) setDirectory(value)
                  })
              }
            >
              {t('localBot:chooseDirectory')}
            </Button>
          </div>
          {!state?.configured && (
            <>
              <label htmlFor="local-character">{t('localBot:characterName')}</label>
              <TextField
                id="local-character"
                value={characterName}
                onChange={(event) => setCharacterName(event.target.value)}
                required
              />
              <label htmlFor="local-person">{t('localBot:personName')}</label>
              <TextField
                id="local-person"
                value={personName}
                onChange={(event) => setPersonName(event.target.value)}
                required
              />
              <label htmlFor="local-preset">{t('localBot:preset')}</label>
              <select
                id="local-preset"
                value={presets ? preset : ''}
                disabled={busy || !presets}
                onChange={(event) => {
                  const index = Number(event.target.value),
                    selected = presets![index]!
                  setPreset(index)
                  setModelConnection((current) => ({
                    ...current,
                    name: selected.display_name,
                    baseUrl: selected.default_base_url,
                  }))
                }}
              >
                {!presets && <option value="">{t('localBot:presetNeedsDocker')}</option>}
                {presets?.map((preset, index) => (
                  <option key={index} value={index}>
                    {preset.display_name}
                  </option>
                ))}
              </select>
              <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <ModelConnectionForm
                  value={modelConnection}
                  change={setModelConnection}
                  multiple={false}
                  showName={false}
                />
              </fieldset>
              <small>{t('localBot:localhost')}</small>
              <label htmlFor="local-sandbox">{t('localBot:sandbox')}</label>
              <select
                id="local-sandbox"
                value={sandboxProfile}
                disabled={busy}
                onChange={(event) => setSandboxProfile(event.target.value as SandboxProfile)}
              >
                {(['desktop', 'headless', 'lite'] as const).map((profile) => (
                  <option key={profile} value={profile}>
                    {t(`localBot:sandboxProfile.${profile}`)}
                  </option>
                ))}
              </select>
              <label htmlFor="local-port">{t('localBot:port')}</label>
              <TextField
                id="local-port"
                type="number"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                min={1}
                max={65535}
                required
              />
            </>
          )}
          {state?.configured && (
            <>
              <p>
                {state.running ? t('localBot:configuredRunning') : t('localBot:configuredStopped')}
              </p>
              <small>{state.installation?.address}</small>
            </>
          )}
          <div className={styles.actions}>
            <Button type="button" variant="plain" onClick={back}>
              {t('localBot:later')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void run(refresh)}>
              {t('localBot:recheck')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy || state?.busy}
              disabled={
                !directory || !state?.docker || !state.bundled || (!state.configured && !presets)
              }
            >
              {state?.configured ? t('localBot:startAndConnect') : t('localBot:begin')}
            </Button>
          </div>
        </form>
        {state?.configured && (
          <div className={styles.actions}>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  done(
                    unwrap(await window.yuki.localBot.connect()),
                    mounted.current && activeRef.current,
                  )
                })
              }
            >
              {t('localBot:repair')}
            </Button>
            <Button
              disabled={busy || !state.running}
              onClick={() =>
                void run(async () => {
                  setState(unwrap(await window.yuki.localBot.stop()))
                })
              }
            >
              {t('localBot:stop')}
            </Button>
          </div>
        )}
        <small>{t('localBot:footnote')}</small>
      </section>
    </div>
  )
}
