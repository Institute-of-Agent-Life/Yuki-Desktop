import { useEffect, useState } from 'react'
import type { BootInfo, Preferences } from '../shared/desktop'
import { Banner } from './components/Controls'
import styles from './App.module.css'
import { useCommands } from './state/commands'
import type { Connection } from '../shared/api'
import { Pairing } from './views/Pairing'
import { Conversation } from './views/Conversation'
import { useWorkspace } from './state/workspace'
import { problemText, unwrap } from './queries/client'
import { requestNavigation } from './state/navigation'
import { TimeZoneContext } from './state/time'
import { Settings } from './views/Settings'
import { useQueryClient } from '@tanstack/react-query'

export function App({ boot }: { boot: BootInfo }) {
  const query = useQueryClient()
  const [step, setStep] = useState<'welcome' | 'server' | 'settings'>('welcome')
  const [folderSettings, setFolderSettings] = useState(false)
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
        if (first?.logout) {
          setConnection(first)
          setStep('settings')
        } else if (first?.needsPairing) {
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
    if (command === 'settings')
      requestNavigation(() => {
        setFolderSettings(false)
        setStep('settings')
      })
    if (command === 'back' && step === 'settings') setStep('welcome')
    if (step === 'settings' && ['chat', 'works', 'computer', 'files', 'about'].includes(command)) {
      useWorkspace.getState().setView(command as import('../shared/desktop').View)
      setStep('welcome')
    }
  })
  return (
    <TimeZoneContext.Provider value={preferences.timeZone}>
      <main className={styles.app}>
        <div className={styles.titlebar} />
        {navigationError && <Banner status="failed">{navigationError}</Banner>}
        {step === 'settings' || connection?.logout ? (
          <Settings
            folderRequest={folderSettings}
            boot={boot}
            preferences={preferences}
            save={save}
            connection={connection}
            onConnection={setConnection}
            onLoggedOut={async () => {
              const previous = connection!
              await query.cancelQueries({ queryKey: [previous.characterId] })
              query.removeQueries({ queryKey: [previous.characterId] })
              useWorkspace.getState().setView('chat')
              setTarget(null)
              setPairLink(null)
              setNavigationError('')
              const remaining = unwrap(await window.yuki.client.connections())
              if (remaining[0]) {
                setConnection(remaining[0])
                setPairingTarget(undefined)
                void window.yuki.client.selected(remaining[0].characterId)
              } else {
                setConnection(undefined)
                setPairingTarget({ ...previous, logout: undefined, needsPairing: true })
              }
              setStep('welcome')
            }}
            about={() => {
              useWorkspace.getState().setView('about')
              setStep('welcome')
            }}
            back={() => {
              setStep('welcome')
            }}
          />
        ) : connection ? (
          <Conversation
            key={connection.characterId}
            connection={connection}
            platform={boot.platform}
            preferences={preferences}
            save={(patch) => void save(patch)}
            onSettings={(target) =>
              requestNavigation(() => {
                setFolderSettings(target === 'folder')
                setStep('settings')
              })
            }
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
            onResumeLogout={async (id) => {
              const candidate = unwrap(await window.yuki.client.connections()).find(
                (item) => item.characterId === id,
              )
              if (!candidate) throw new Error('原連線已處理完成，可以重新配對。')
              setPairLink(null)
              setPairingTarget(undefined)
              setConnection(candidate)
              setStep('settings')
            }}
            onDone={(value) => {
              void query.cancelQueries({ queryKey: [value.characterId] })
              query.removeQueries({ queryKey: [value.characterId] })
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
    </TimeZoneContext.Provider>
  )
}
