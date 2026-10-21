import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BootInfo, Preferences } from '../shared/desktop'
import { Banner } from './components/Controls'
import styles from './App.module.css'
import { useCommands } from './state/commands'
import type { Connection } from '../shared/api'
import { Pairing } from './views/Pairing'
import { Conversation } from './views/Conversation'
import { WorkspaceSession, workspaceFor, workspaceScope, forgetWorkspace } from './state/workspace'
import { problemText, unwrap } from './queries/client'
import { requestNavigation } from './state/navigation'
import { TimeZoneContext } from './state/time'
import { Settings } from './views/Settings'
import { UpdatePending } from './components/Updates'
import { UpdateProvider } from './state/updates'
import { RoleSwitcher } from './components/RoleSwitcher'
import { ApplicationMenu } from './components/ApplicationMenu'
import { useQueryClient } from '@tanstack/react-query'

export function App({ boot }: { boot: BootInfo }) {
  const query = useQueryClient()
  const selection = useRef<string | undefined>(undefined)
  const [step, setStep] = useState<'welcome' | 'adding' | 'settings'>('welcome')
  const [folderSettings, setFolderSettings] = useState(false)
  const [serverSettings, setServerSettings] = useState(false)
  const [preferences, setPreferences] = useState(boot.preferences)
  const [cssAccessibility, setCssAccessibility] = useState(() => ({
    opaque: matchMedia('(prefers-reduced-transparency: reduce)').matches,
    contrast: matchMedia('(prefers-contrast: more)').matches,
  }))
  useEffect(() => {
    const opaque = matchMedia('(prefers-reduced-transparency: reduce)'),
      contrast = matchMedia('(prefers-contrast: more)')
    const update = () => setCssAccessibility({ opaque: opaque.matches, contrast: contrast.matches })
    opaque.addEventListener('change', update)
    contrast.addEventListener('change', update)
    return () => {
      opaque.removeEventListener('change', update)
      contrast.removeEventListener('change', update)
    }
  }, [])
  const [appearance, setAppearance] = useState(boot)
  const [connections, setConnections] = useState<Connection[]>([])
  const [connection, setConnection] = useState<Connection>()
  const [pairingTarget, setPairingTarget] = useState<Connection>()
  const [pairLink, setPairLink] = useState(boot.pairLink)
  const [target, setTarget] = useState(boot.openTarget)
  const [navigationError, setNavigationError] = useState('')
  const updateConnection = (value: Connection) => {
    setConnections((current) =>
      current.some((item) => item.characterId === value.characterId)
        ? current.map((item) => (item.characterId === value.characterId ? value : item))
        : [...current, value],
    )
    setConnection(value)
    selection.current = value.characterId
  }
  const select = (value: Connection) => {
    requestNavigation(() => {
      updateConnection(value)
      setTarget(null)
      setPairLink(null)
      setPairingTarget(value.needsPairing ? value : undefined)
      setNavigationError('')
      setStep(value.logout ? 'settings' : 'welcome')
    })
  }
  useEffect(() => {
    if (pairLink) return
    let active = true
    void window.yuki.client.connections().then((result) => {
      if (!active) return
      if (!result.ok) {
        setNavigationError(problemText(result.code))
        return
      }
      setConnections(result.value)
      const first = target
        ? result.value.find((item) => item.characterId === target.characterId)
        : (result.value.find((item) => item.characterId === selection.current) ?? result.value[0])
      if (!first && target) {
        setNavigationError('原角色的連線已移除。')
        return
      }
      if (first) {
        setConnection(first)
        selection.current = first.characterId
        setPairingTarget(first.needsPairing ? first : undefined)
        if (first.logout) setStep('settings')
        else if (target && !first.needsPairing) {
          workspaceFor(workspaceScope(first)).getState().navigate(target)
          void window.yuki.client.acknowledgeTarget(target)
        }
      } else setConnection(undefined)
    })
    return () => {
      active = false
    }
  }, [target, pairLink])
  useEffect(
    () =>
      window.yuki.onOpenTarget((next) => {
        requestNavigation(() => {
          setTarget(next)
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
          setStep('adding')
        })
      }),
    [],
  )
  useEffect(
    () =>
      window.yuki.client.onHint((id, kind, data) => {
        if (
          kind !== 'connection-name' ||
          !data ||
          typeof (data as { name?: unknown }).name !== 'string'
        )
          return
        const name = (data as { name: string }).name
        setConnections((current) =>
          current.map((item) => (item.characterId === id ? { ...item, name } : item)),
        )
        setConnection((current) => (current?.characterId === id ? { ...current, name } : current))
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
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme =
      preferences.theme === 'system' ? (appearance.dark ? 'dark' : 'light') : preferences.theme
    root.dataset.contrast = String(
      preferences.highContrast || appearance.highContrast || cssAccessibility.contrast,
    )
    root.dataset.motion = preferences.reducedMotion ? 'reduced' : 'normal'
    const opaque =
      cssAccessibility.opaque ||
      cssAccessibility.contrast ||
      preferences.opaque ||
      preferences.highContrast ||
      appearance.reducedTransparency ||
      appearance.highContrast
    root.dataset.opaque = String(opaque)
    root.dataset.material = opaque ? 'none' : boot.nativeMaterial
    root.dataset.platform = boot.platform
  }, [preferences, appearance, cssAccessibility, boot.platform, boot.nativeMaterial])
  useEffect(
    () => window.yuki.onTheme((theme) => setAppearance((previous) => ({ ...previous, ...theme }))),
    [],
  )
  const adding = () =>
    requestNavigation(() => {
      setServerSettings(true)
      setPairLink(null)
      setPairingTarget(undefined)
      setStep('adding')
    })
  const workspace = connection ? workspaceFor(workspaceScope(connection)).getState() : undefined
  useCommands((command) => {
    if (command === 'settings')
      requestNavigation(() => {
        setFolderSettings(false)
        setServerSettings(false)
        setStep('settings')
      })
    if (command === 'back' && step === 'settings') setStep('welcome')
    if (command === 'previous-character' || command === 'next-character') {
      if (!connections.length) return
      const at = connections.findIndex((item) => item.characterId === connection?.characterId)
      const offset = command === 'next-character' ? 1 : -1
      select(connections[(at + offset + connections.length) % connections.length]!)
    }
    if (step === 'settings' && ['chat', 'works', 'computer', 'files', 'about'].includes(command)) {
      requestNavigation(() => {
        workspace?.setView(command as import('../shared/desktop').View)
        setStep('welcome')
      })
    }
  })
  const pairing = step === 'adding' || !connection || !!pairingTarget
  const showingSettings = step === 'settings' || (step !== 'adding' && !!connection?.logout)
  const settingsInWorkspace =
    showingSettings && connection && !connection.logout && !connection.needsPairing && !pairing
  const settings = (
    <Settings
      key={connection?.characterId ?? 'desktop'}
      embedded={!!settingsInWorkspace}
      folderRequest={folderSettings}
      serverRequest={serverSettings}
      boot={boot}
      preferences={preferences}
      save={save}
      connection={connection}
      onConnection={updateConnection}
      onAddCharacter={adding}
      onLoggedOut={async () => {
        const previous = connection!
        await query.cancelQueries({ queryKey: [previous.characterId] })
        query.removeQueries({ queryKey: [previous.characterId] })
        forgetWorkspace(previous)
        setTarget(null)
        setPairLink(null)
        setNavigationError('')
        const remaining = unwrap(await window.yuki.client.connections())
        setConnections(remaining)
        setConnection(remaining[0])
        setPairingTarget(
          remaining[0] ? undefined : { ...previous, logout: undefined, needsPairing: true },
        )
        selection.current = remaining[0]?.characterId
        setStep('welcome')
      }}
      about={() => {
        workspace?.setView('about')
        setStep('welcome')
      }}
      back={() => setStep('welcome')}
    />
  )
  return (
    <UpdateProvider>
      <UpdatePending />
      <TimeZoneContext.Provider value={preferences.timeZone}>
        <main className={styles.app}>
          <div className={styles.titlebar} />
          {navigationError && <Banner status="failed">{navigationError}</Banner>}
          {connections
            .filter((item) => !item.logout && !item.needsPairing)
            .map((item) => {
              const active = item.characterId === connection?.characterId && !pairing
              const scope = workspaceScope(item)
              return (
                <WorkspaceSession key={scope} scope={scope} active={active}>
                  <div
                    className={styles.roleSession}
                    hidden={!active}
                    inert={!active}
                    data-character-session={item.characterId}
                  >
                    <Conversation
                      connection={item}
                      platform={boot.platform}
                      preferences={preferences}
                      settings={settingsInWorkspace && active ? settings : undefined}
                      onSettingsBack={() => setStep('welcome')}
                      roleSwitcher={
                        connections.length > 1 ? (
                          <RoleSwitcher
                            connections={connections}
                            selected={item.characterId}
                            select={select}
                          />
                        ) : undefined
                      }
                      onSettings={(next) =>
                        requestNavigation(() => {
                          setFolderSettings(next === 'folder')
                          setServerSettings(false)
                          setStep('settings')
                        })
                      }
                      onPairAgain={() =>
                        requestNavigation(() => {
                          setPairingTarget(item)
                          setConnection(item)
                          setStep('welcome')
                        })
                      }
                    />
                  </div>
                </WorkspaceSession>
              )
            })}
          {showingSettings ? (
            !settingsInWorkspace && settings
          ) : pairing ? (
            <Pairing
              key={`${step}/${pairingTarget?.characterId ?? 'new'}`}
              label={boot.deviceLabel}
              onUpdate={() => {
                setFolderSettings(false)
                setServerSettings(false)
                setStep('settings')
              }}
              initialLink={pairLink}
              initialServer={pairingTarget?.baseUrl}
              reconnect={!!pairingTarget}
              startAtServer={step === 'adding'}
              onCancel={
                step === 'adding' && connection
                  ? () => {
                      setPairLink(null)
                      setStep('settings')
                    }
                  : undefined
              }
              onResumeLogout={async (id) => {
                const candidate = unwrap(await window.yuki.client.connections()).find(
                  (item) => item.characterId === id,
                )
                if (!candidate) throw new Error('原連線已處理完成，可以重新配對。')
                setPairLink(null)
                setPairingTarget(undefined)
                updateConnection(candidate)
                setStep('settings')
              }}
              onDone={(value) => {
                void query.cancelQueries({ queryKey: [value.characterId] })
                query.removeQueries({ queryKey: [value.characterId] })
                updateConnection(value)
                setPairingTarget(undefined)
                setPairLink(null)
                setStep('welcome')
                if (target?.characterId === value.characterId) {
                  workspaceFor(workspaceScope(value)).getState().navigate(target)
                  void window.yuki.client.acknowledgeTarget(target)
                }
              }}
            />
          ) : null}
          {pairing && !showingSettings && <ApplicationMenu platform={boot.platform} overlay />}
        </main>
      </TimeZoneContext.Provider>
    </UpdateProvider>
  )
}
