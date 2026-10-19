import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { BootInfo, Preferences } from '../shared/desktop'
import { Button, Segmented, Toggle } from './components/Controls'
import styles from './App.module.css'
import { useCommands } from './state/commands'
import type { Connection } from '../shared/api'
import { Pairing } from './views/Pairing'
import { Conversation } from './views/Conversation'
import { useWorkspace } from './state/workspace'

export function App({ boot }: { boot: BootInfo }) {
  const [step, setStep] = useState<'welcome' | 'server' | 'settings'>('welcome')
  const [preferences, setPreferences] = useState(boot.preferences)
  const [appearance, setAppearance] = useState(boot)
  const [connection, setConnection] = useState<Connection>()
  const [pairingTarget, setPairingTarget] = useState<Connection>()
  const [pairLink, setPairLink] = useState(boot.pairLink)
  useEffect(() => {
    void window.yuki.client.connections().then((result) => {
      if (result.ok) {
        const first = result.value[0]
        if (first?.needsPairing) setPairingTarget(first)
        else setConnection(first)
      }
    })
  }, [])
  useEffect(
    () =>
      window.yuki.onPairLink((link) => {
        setPairLink(link)
        setPairingTarget(connection)
        setConnection(undefined)
        setStep('welcome')
      }),
    [connection],
  )
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
            <Button
              variant="plain"
              onClick={() => {
                setStep('welcome')
                useWorkspace.getState().setView('chat')
              }}
            >
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
      ) : connection ? (
        <Conversation
          key={connection.characterId}
          connection={connection}
          platform={boot.platform}
          preferences={preferences}
          save={(patch) => void save(patch)}
          onSettings={() => setStep('settings')}
          onPairAgain={() => {
            setPairingTarget(connection)
            setConnection(undefined)
            setStep('welcome')
          }}
        />
      ) : (
        <Pairing
          label={boot.deviceLabel}
          initialLink={pairLink}
          initialServer={pairingTarget?.baseUrl}
          reconnect={!!pairingTarget}
          onDone={(value) => {
            setConnection(value)
            setPairingTarget(undefined)
            setPairLink(null)
            useWorkspace.getState().setView('chat')
          }}
        />
      )}
    </main>
  )
}
