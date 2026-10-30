import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BootInfo, Preferences } from '../shared/desktop'
import { Banner } from './components/Controls'
import styles from './App.module.css'
import { useCommands } from './state/commands'
import type { Connection } from '../shared/api'
import { Pairing } from './views/Pairing'
import { DisconnectedHome } from './views/DisconnectedHome'
import { LocalBot } from './views/LocalBot'
import { Conversation } from './views/Conversation'
import { WorkspaceSession, workspaceFor, workspaceScope, forgetWorkspace } from './state/workspace'
import { problemText, unwrap } from './queries/client'
import { requestNavigation } from './state/navigation'
import { TimeZoneContext } from './state/time'
import { Settings, type SettingsCategory } from './views/Settings'
import { UpdatePending } from './components/Updates'
import { UpdateProvider } from './state/updates'
import { RoleSwitcher } from './components/RoleSwitcher'
import { ApplicationMenu } from './components/ApplicationMenu'
import { useQueryClient } from '@tanstack/react-query'

export function App({ boot }: { boot: BootInfo }) {
  const query = useQueryClient()
  const selection = useRef<string | undefined>(undefined)
  const [step, setStep] = useState<'welcome' | 'adding' | 'local'>(
    boot.pairLink ? 'adding' : 'welcome',
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('general')
  const openSettings = (category?: SettingsCategory) => {
    if (category) setSettingsCategory(category)
    setSettingsOpen(true)
  }
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
  const select = (value: Connection, stayInSettings = false) => {
    requestNavigation(() => {
      updateConnection(value)
      setTarget(null)
      setPairLink(null)
      setPairingTarget(value.needsPairing ? value : undefined)
      setNavigationError('')
      setSettingsOpen(stayInSettings && !value.needsPairing)
      setStep('welcome')
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
      const available = result.value.filter((item) => !item.needsPairing || item.logout)
      const first = target
        ? result.value.find((item) => item.characterId === target.characterId)
        : (available.find((item) => item.characterId === selection.current) ?? available[0])
      if (!first && target) {
        setNavigationError('原 Yuki 的連線已移除。')
        return
      }
      if (first) {
        setConnection(first)
        selection.current = first.characterId
        setPairingTarget(first.needsPairing ? first : undefined)
        if (first.logout) {
          setSettingsCategory('connection')
          setSettingsOpen(true)
        } else if (target && !first.needsPairing) {
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
          setSettingsOpen(false)
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
          setSettingsOpen(false)
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
      setPairLink(null)
      setPairingTarget(undefined)
      setSettingsOpen(false)
      setStep('adding')
    })
  const deployLocal = () =>
    requestNavigation(() => {
      setSettingsOpen(false)
      setStep('local')
    })
  const workspace = workspaceFor(connection ? workspaceScope(connection) : 'desktop').getState()
  useCommands((command) => {
    if (command === 'settings')
      requestNavigation(() => {
        openSettings()
      })
    if (command === 'back' && settingsOpen) setSettingsOpen(false)
    if (command === 'previous-character' || command === 'next-character') {
      if (!connections.length) return
      const at = connections.findIndex((item) => item.characterId === connection?.characterId)
      const offset = command === 'next-character' ? 1 : -1
      select(connections[(at + offset + connections.length) % connections.length]!, settingsOpen)
    }
    if (
      settingsOpen &&
      ['chat', 'works', 'computer', 'local', 'files', 'about'].includes(command)
    ) {
      requestNavigation(() => {
        if (command === 'chat' && connection)
          workspace.navigate({
            characterId: connection.characterId,
            conversationId: connection.conversationId,
            view: 'chat',
          })
        else workspace.setView(command as import('../shared/desktop').View)
        setSettingsOpen(false)
        setStep('welcome')
      })
    }
  })
  const complete = (value: Connection, activate = true) => {
    void query.cancelQueries({ queryKey: [value.characterId] })
    query.removeQueries({ queryKey: [value.characterId] })
    if (!activate) {
      setConnections((current) => [
        ...current.filter((item) => item.characterId !== value.characterId),
        value,
      ])
      setConnection((current) => (current?.characterId === value.characterId ? value : current))
      return
    }
    updateConnection(value)
    setPairingTarget(undefined)
    setPairLink(null)
    setSettingsOpen(false)
    setStep('welcome')
    if (target?.characterId === value.characterId) {
      workspaceFor(workspaceScope(value)).getState().navigate(target)
      void window.yuki.client.acknowledgeTarget(target)
    }
  }
  const pairing = step === 'adding' || !!pairingTarget
  const showingSettings = settingsOpen || (step === 'welcome' && !!connection?.logout)
  const settings = (
    <Settings
      category={settingsCategory}
      onCategory={setSettingsCategory}
      boot={boot}
      preferences={preferences}
      save={save}
      connection={connection}
      connections={connections}
      onSelect={(value) => select(value, true)}
      onConnection={updateConnection}
      onAddCharacter={adding}
      onDeployLocal={deployLocal}
      onLoggedOut={async () => {
        const previous = connection!
        await query.cancelQueries({ queryKey: [previous.characterId] })
        query.removeQueries({ queryKey: [previous.characterId] })
        forgetWorkspace(previous)
        setTarget(null)
        setPairLink(null)
        setNavigationError('')
        const remaining = unwrap(await window.yuki.client.connections())
        const first = remaining.find((item) => !item.needsPairing || item.logout)
        setConnections(remaining)
        setConnection(first)
        if (!first) setSettingsCategory('yukis')
        setPairingTarget(first?.needsPairing ? first : undefined)
        selection.current = first?.characterId
        setSettingsOpen(false)
        setStep('welcome')
      }}
      about={() => {
        workspace.setView('about')
        setSettingsOpen(false)
        setStep('welcome')
      }}
      back={() => setSettingsOpen(false)}
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
              const active =
                item.characterId === connection?.characterId &&
                !pairing &&
                step !== 'local' &&
                !showingSettings
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
                      roleSwitcher={
                        connections.length > 1 ? (
                          <RoleSwitcher
                            connections={connections}
                            selected={item.characterId}
                            select={select}
                          />
                        ) : undefined
                      }
                      onSettings={(target) =>
                        requestNavigation(() => {
                          openSettings(target)
                        })
                      }
                      onPairAgain={() =>
                        requestNavigation(() => {
                          setPairingTarget(item)
                          setConnection(item)
                          setSettingsOpen(false)
                          setStep('welcome')
                        })
                      }
                    />
                  </div>
                </WorkspaceSession>
              )
            })}
          {showingSettings && settings}
          {step === 'local' && (
            <div className={styles.roleSession} hidden={showingSettings} inert={showingSettings}>
              <LocalBot
                active={!showingSettings}
                back={() => {
                  setPairingTarget(undefined)
                  setPairLink(null)
                  setTarget(null)
                  if (connection?.needsPairing) {
                    setConnection(undefined)
                    selection.current = undefined
                  }
                  setStep('welcome')
                }}
                done={complete}
              />
            </div>
          )}
          {!pairing && !connection && step !== 'local' && (
            <div className={styles.roleSession} hidden={showingSettings} inert={showingSettings}>
              <WorkspaceSession scope="desktop" active={!showingSettings}>
                <DisconnectedHome
                  platform={boot.platform}
                  connect={adding}
                  deploy={deployLocal}
                  onSettings={openSettings}
                  roleSwitcher={
                    connections.length ? (
                      <RoleSwitcher connections={connections} selected="" select={select} />
                    ) : undefined
                  }
                  help={() => {
                    void window.yuki.client.external(
                      'https://github.com/Institute-of-Agent-Life/Yuki-Desktop',
                    )
                  }}
                />
              </WorkspaceSession>
            </div>
          )}
          {pairing && (
            <div
              hidden={showingSettings || step === 'local'}
              inert={showingSettings || step === 'local'}
            >
              <Pairing
                key={pairingTarget?.characterId ?? 'new'}
                active={!showingSettings && step !== 'local'}
                label={boot.deviceLabel}
                onUpdate={() => openSettings('updates')}
                initialLink={pairLink}
                initialServer={pairingTarget?.baseUrl}
                reconnect={!!pairingTarget}
                startAtServer
                onCancel={() => {
                  setTarget(null)
                  setPairLink(null)
                  setPairingTarget(undefined)
                  if (connection?.needsPairing) {
                    setConnection(undefined)
                    selection.current = undefined
                  }
                  setSettingsOpen(false)
                  setStep('welcome')
                }}
                onResumeLogout={async (id) => {
                  const candidate = unwrap(await window.yuki.client.connections()).find(
                    (item) => item.characterId === id,
                  )
                  if (!candidate) throw new Error('原連線已處理完成，可以重新配對。')
                  setPairLink(null)
                  setPairingTarget(undefined)
                  updateConnection(candidate)
                  setSettingsCategory('connection')
                  setSettingsOpen(true)
                  setStep('welcome')
                }}
                onDone={complete}
              />
            </div>
          )}
          {(pairing || step === 'local') && !showingSettings && (
            <ApplicationMenu platform={boot.platform} overlay />
          )}
        </main>
      </TimeZoneContext.Provider>
    </UpdateProvider>
  )
}
