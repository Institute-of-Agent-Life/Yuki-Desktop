import { useEffect, useState } from 'react'
import { ArrowLeft, Snowflake } from 'lucide-react'
import type { BootInfo, Preferences } from '../shared/desktop'
import { Button, Segmented, TextField, Toggle } from './components/Controls'
import styles from './App.module.css'
import { useCommands } from './state/commands'

export function App({ boot }: { boot: BootInfo }) {
  const [step, setStep] = useState<'welcome' | 'server' | 'settings'>('welcome')
  const [preferences, setPreferences] = useState(boot.preferences)
  const [appearance, setAppearance] = useState(boot)
  const [server, setServer] = useState('')
  const save = async (patch: Partial<Preferences>) =>
    setPreferences(await window.yuki.preferences(patch))
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme =
      preferences.theme === 'system' ? (appearance.dark ? 'dark' : 'light') : preferences.theme
    root.dataset.contrast = String(preferences.highContrast || appearance.highContrast)
    root.dataset.motion = preferences.reducedMotion ? 'reduced' : 'normal'
    root.dataset.opaque = String(preferences.opaque || appearance.reducedTransparency)
    root.dataset.platform = boot.platform
  }, [preferences, appearance, boot.platform])
  useEffect(
    () => window.yuki.onTheme((theme) => setAppearance((previous) => ({ ...previous, ...theme }))),
    [],
  )
  useCommands((command) => {
    if (command === 'settings') setStep('settings')
    if (command === 'back') setStep('welcome')
  })
  return (
    <main className={styles.app}>
      <div className={styles.titlebar} />
      {step === 'settings' ? (
        <div className={styles.settings}>
          <header>
            <Button variant="plain" onClick={() => setStep('welcome')}>
              <ArrowLeft size={16} />
              返回
            </Button>
            <h2>設定</h2>
          </header>
          <section>
            <h3>外觀</h3>
            <div className={styles.setting}>
              <span>主題</span>
              <Segmented
                label="主題"
                value={preferences.theme}
                items={[
                  { value: 'system', label: '跟隨系統' },
                  { value: 'light', label: '淺色' },
                  { value: 'dark', label: '深色' },
                ]}
                onChange={(theme) => void save({ theme })}
              />
            </div>
            <div className={styles.setting}>
              <span>永遠不透明</span>
              <Toggle
                label="永遠不透明"
                checked={preferences.opaque}
                onChange={(opaque) => void save({ opaque })}
              />
            </div>
            <div className={styles.setting}>
              <span>減少動態</span>
              <Toggle
                label="減少動態"
                checked={preferences.reducedMotion}
                onChange={(reducedMotion) => void save({ reducedMotion })}
              />
            </div>
            <div className={styles.setting}>
              <span>增加對比</span>
              <Toggle
                label="增加對比"
                checked={preferences.highContrast}
                onChange={(highContrast) => void save({ highContrast })}
              />
            </div>
          </section>
          <section>
            <h3>Yuki Desktop</h3>
            <p>版本 {boot.version}</p>
          </section>
        </div>
      ) : (
        <div className={styles.welcome}>
          <div className={styles.welcomeInner}>
            <Snowflake className={styles.welcomeMark} size={120} strokeWidth={1} />
            <h1>{step === 'welcome' ? 'Yuki' : '連接你的角色'}</h1>
            <p>
              {step === 'welcome'
                ? '和她聊聊，一起把事情做好。無論從哪裡回來，都是同一個她。'
                : '輸入 Yuki 伺服器位址，或貼上你收到的綁定連結。'}
            </p>
            {step === 'welcome' ? (
              <Button variant="primary" large onClick={() => setStep('server')}>
                開始
              </Button>
            ) : (
              <form className={styles.server} onSubmit={(event) => event.preventDefault()}>
                <label htmlFor="server-url">伺服器位址</label>
                <TextField
                  id="server-url"
                  autoFocus
                  type="url"
                  autoComplete="url"
                  value={server}
                  onChange={(event) => setServer(event.target.value)}
                  placeholder="https://"
                />
                <small>可包含角色的路徑前綴。</small>
                <div>
                  <Button variant="plain" onClick={() => setStep('welcome')}>
                    返回
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
