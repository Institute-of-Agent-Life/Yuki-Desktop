import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { BootInfo, Preferences } from '../shared/desktop'
import { Banner, Button, Segmented, Toggle } from './components/Controls'
import styles from './App.module.css'
import { useCommands } from './state/commands'
import type { Connection } from '../shared/api'
import { Pairing } from './views/Pairing'
import { Conversation } from './views/Conversation'
import { useWorkspace } from './state/workspace'
import { problemText } from './queries/client'
import { requestNavigation } from './state/navigation'

export function App({ boot }: { boot: BootInfo }) {
  const [step, setStep] = useState<'welcome' | 'server' | 'settings'>('welcome')
  const [preferences, setPreferences] = useState(boot.preferences)
  const [appearance, setAppearance] = useState(boot)
  const [connection, setConnection] = useState<Connection>()
  const [pairingTarget, setPairingTarget] = useState<Connection>()
  const [pairLink, setPairLink] = useState(boot.pairLink)
  const [target, setTarget] = useState(boot.openTarget),
    [navigationError, setNavigationError] = useState('')
  useEffect(() => {
    if (pairLink) return
    let active = true
    void window.yuki.client.connections().then((result) => {
      if (active && !result.ok) {
        setNavigationError(problemText(result.code))
        return
      }
      if (active && result.ok) {
        const first = target
          ? result.value.find((item) => item.characterId === target.characterId)
          : result.value[0]
        if (!first && target) {
          setNavigationError('原角色的連線已移除。')
          return
        }
        if (first?.needsPairing) {
          setConnection(undefined)
          setPairingTarget(first)
        } else {
          setConnection(first)
          if (target) {
            useWorkspace.getState().navigate(target)
            void window.yuki.client.acknowledgeTarget(target)
          }
        }
      }
    })
    return () => {
      active = false
    }
  }, [target, pairLink])
  useEffect(
    () =>
      window.yuki.onOpenTarget((target) => {
        requestNavigation(() => {
          setTarget(target)
          setNavigationError('')
          setStep('welcome')
        })
      }),
    [],
  )
  useEffect(
    () =>
      window.yuki.onPairLink((link) => {
        requestNavigation(() => {
          setTarget(null)
          setPairLink(link)
          setPairingTarget(undefined)
          setConnection(undefined)
          setStep('welcome')
        })
      }),
    [],
  )
  useEffect(
    () =>
      window.yuki.onLeaveRequest((request) => {
        requestNavigation(
          () => window.yuki.leaveResponse(request, true),
          () => window.yuki.leaveResponse(request, false),
        )
      }),
    [],
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
    if (command === 'settings') requestNavigation(() => setStep('settings'))
    if (command === 'back' && step === 'settings') setStep('welcome')
  })
  return (
    <main className={styles.app}>
      <div className={styles.titlebar} />
      {navigationError && <Banner status="failed">{navigationError}</Banner>}
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
            <h3>一般</h3>
            <div className={styles.setting}>
              <span>關閉視窗時保持在選單列</span>
              <Toggle
                label="關閉視窗時保持在選單列"
                checked={preferences.keepInTray}
                onChange={(keepInTray) => void save({ keepInTray })}
              />
            </div>
            {boot.platform === 'linux' && (
              <p>部分 Linux 桌面環境需啟用 AppIndicator 擴充功能，才會顯示系統匣圖示。</p>
            )}
            <div className={styles.setting}>
              <span>送出訊息</span>
              <Segmented
                label="送出訊息"
                value={preferences.sendKey}
                items={[
                  { value: 'enter', label: 'Enter' },
                  { value: 'command-enter', label: '⌘ / Ctrl Enter' },
                ]}
                onChange={(sendKey) => void save({ sendKey })}
              />
            </div>
          </section>
          <section>
            <h3>通知</h3>
            {(
              [
                { key: 'notifyProactive', label: 'Yuki 主動訊息' },
                { key: 'notifyWaiting', label: '等待你回覆' },
                { key: 'notifyCompleted', label: '工作完成' },
                { key: 'notifyHelp', label: '電腦協助請求' },
              ] as const
            ).map((item) => (
              <div className={styles.setting} key={item.key}>
                <span>{item.label}</span>
                <Toggle
                  label={item.label}
                  checked={preferences[item.key]}
                  onChange={(value) => void save({ [item.key]: value })}
                />
              </div>
            ))}
          </section>
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
          onSettings={() => requestNavigation(() => setStep('settings'))}
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
            void window.yuki.client.selected(value.characterId)
            setConnection(value)
            setPairingTarget(undefined)
            setPairLink(null)
            if (target?.characterId === value.characterId) {
              useWorkspace.getState().navigate(target)
              void window.yuki.client.acknowledgeTarget(target)
            } else useWorkspace.getState().setView('chat')
          }}
        />
      )}
    </main>
  )
}
