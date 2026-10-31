import { useEffect, useRef, useState } from 'react'
import type { Connection } from '../../shared/api'
import type { LocalBotState } from '../../shared/local-bot'
import type { ProviderPreset } from '../../shared/models'
import { ModelConnectionForm, type ConnectionDraft } from './ModelConnectionForm'
import { Banner, Button, TextField } from '../components/Controls'
import { unwrap, problemText, ClientProblem } from '../queries/client'
import styles from '../App.module.css'

export function LocalBot({
  active,
  back,
  done,
}: {
  active: boolean
  back(): void
  done(connection: Connection, activate?: boolean): void
}) {
  const mounted = useRef(true)
  const activeRef = useRef(active)
  activeRef.current = active
  const [state, setState] = useState<LocalBotState>()
  const [directory, setDirectory] = useState(''),
    [characterName, setCharacterName] = useState('Yuki'),
    [personName, setPersonName] = useState('')
  const [port, setPort] = useState('8080')
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
            : '本機部署未完成。',
      )
      await refresh()
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <div className={styles.welcome}>
      <section data-glass="card" className={styles.welcomeInner}>
        <h1>在本機部署 Yuki</h1>
        <p>
          Yuki
          和資料保存在你選的目錄。模型可以使用遠端服務或你已有的本機服務；這裡不附帶模型，也不要求先接
          QQ 或其他聊天平台。
        </p>
        {error && <Banner status="failed">{error}</Banner>}
        {progress && <p role="status">{progress}</p>}
        {state && !state.docker && (
          <Banner>
            請先安裝或啟動 Docker，並使用 Linux 容器。
            <Button
              onClick={() =>
                void window.yuki.client.external('https://docs.docker.com/get-started/get-docker/')
              }
            >
              安裝說明
            </Button>
          </Banner>
        )}
        {state && !state.bundled && (
          <Banner status="failed">
            這份開發建置尚未準備配套的本機部署資源，請使用完整測試包。
          </Banner>
        )}
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
          <label htmlFor="local-directory">資料與部署目錄</label>
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
              選擇目錄
            </Button>
          </div>
          {!state?.configured && (
            <>
              <label htmlFor="local-character">Yuki 的名稱</label>
              <TextField
                id="local-character"
                value={characterName}
                onChange={(event) => setCharacterName(event.target.value)}
                required
              />
              <label htmlFor="local-person">你的名稱</label>
              <TextField
                id="local-person"
                value={personName}
                onChange={(event) => setPersonName(event.target.value)}
                required
              />
              <label htmlFor="local-preset">服務預設</label>
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
                {!presets && <option value="">需要 Docker 讀取部署映像的預設</option>}
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
              <small>
                同機模型的 localhost 會轉為容器可達的 host.docker.internal；服務本身須允許這個來源。
              </small>
              <label htmlFor="local-port">本機連接埠</label>
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
                已有設定與資料，繼續使用原 Yuki 和本人入口。
                {state.running ? '服務正在執行。' : '服務尚未啟動。'}
              </p>
              <small>{state.installation?.address}</small>
            </>
          )}
          <div className={styles.actions}>
            <Button type="button" variant="plain" onClick={back}>
              返回／稍後設定
            </Button>
            <Button type="button" disabled={busy} onClick={() => void run(refresh)}>
              重新檢測
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy || state?.busy}
              disabled={
                !directory || !state?.docker || !state.bundled || (!state.configured && !presets)
              }
            >
              {state?.configured ? '啟動並連接' : '開始部署'}
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
              重新取得配對並連接
            </Button>
            <Button
              disabled={busy || !state.running}
              onClick={() =>
                void run(async () => {
                  setState(unwrap(await window.yuki.localBot.stop()))
                })
              }
            >
              停止本機服務
            </Button>
          </div>
        )}
        <small>關閉桌面視窗不會刪除資料。本機聊天服務不代表持久終端環境已安裝。</small>
      </section>
    </div>
  )
}
