import { useTabMotion } from '../motion/tab'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  SlidersHorizontal,
  Palette,
  Bell,
  Wrench,
  Server,
  ShieldCheck,
  Download,
  Laptop,
  Snowflake,
  Cpu,
  MessagesSquare,
  type LucideIcon,
} from 'lucide-react'
import type { Connection } from '../../shared/api'
import { UpdatePanel } from '../components/Updates'
import { ApplicationMenu } from '../components/ApplicationMenu'
import { RoleSwitcher } from '../components/RoleSwitcher'
import { EdgeFade, useScrolledUnder } from '../components/EdgeFade'
import { ServerSettings } from './ServerSettings'
import { DeviceSecurity } from './DeviceSecurity'
import { AgentConnector } from './AgentConnector'
import { ModelSettings, type ModelPage } from './ModelSettings'
import { Platforms } from './Platforms'
import { LogoutFlow } from './LogoutFlow'
import { Row, SettingsSection } from './SettingsRow'
import { backdrops, type Backdrop, type BootInfo, type Preferences } from '../../shared/desktop'
import {
  Avatar,
  Banner,
  Button,
  Segmented,
  Spinner,
  Toggle,
  SelectionPill,
} from '../components/Controls'
import { unwrap } from '../queries/client'
import styles from './Settings.module.css'
import { useTranslation } from '../i18n'
import { languageNames, languages } from '../../shared/locales'

export type SettingsCategory =
  | 'general'
  | 'look'
  | 'notify'
  | 'updates'
  | 'connection'
  | 'models'
  | 'platforms'
  | 'devices'
  | 'computer'
  | 'yukis'
  | 'advanced'

// `heading` null: the current Yuki's own group; '' : no heading. Labels are `settings:category.*`.
const groups: {
  heading: 'appGroup' | '' | null
  items: { id: SettingsCategory; icon: LucideIcon }[]
}[] = [
  {
    heading: 'appGroup',
    items: [
      { id: 'general', icon: SlidersHorizontal },
      { id: 'look', icon: Palette },
      { id: 'notify', icon: Bell },
      { id: 'updates', icon: Download },
    ],
  },
  {
    heading: null,
    items: [
      { id: 'connection', icon: Server },
      { id: 'models', icon: Cpu },
      { id: 'platforms', icon: MessagesSquare },
      { id: 'devices', icon: ShieldCheck },
      { id: 'computer', icon: Laptop },
    ],
  },
  {
    heading: '',
    items: [
      { id: 'yukis', icon: Snowflake },
      { id: 'advanced', icon: Wrench },
    ],
  },
]

export function Settings({
  boot,
  preferences,
  save,
  back,
  connection,
  connections,
  onSelect,
  onConnection,
  about,
  onLoggedOut,
  category,
  onCategory,
  modelPage,
  onModelPage,
  onAddCharacter,
  onDeployLocal,
  onQQLogin,
  onDeployRemote,
}: {
  boot: BootInfo
  preferences: Preferences
  save(patch: Partial<Preferences>): Promise<void>
  back(): void
  connection?: Connection
  connections: Connection[]
  onSelect(connection: Connection): void
  onConnection(connection: Connection): void
  about(): void
  onLoggedOut(): Promise<void>
  category: SettingsCategory
  onCategory(category: SettingsCategory): void
  modelPage: ModelPage
  onModelPage(page: ModelPage): void
  onAddCharacter(): void
  onDeployLocal(): void
  onQQLogin(): void
  onDeployRemote(): void
}) {
  const { t } = useTranslation(['settings', 'common', 'remoteDeploy'])
  const keepInTray = t(
    boot.platform === 'darwin' ? 'settings:keepInMenuBar' : 'settings:keepInTray',
  )
  const modEnter = boot.platform === 'darwin' ? '⌘ Enter' : 'Ctrl Enter'
  const shown = connection?.logout ? 'connection' : category
  const visibleGroups = groups.filter(
    (group) => group.heading !== null || (connection && !connection.needsPairing),
  )
  const visible = visibleGroups.flatMap((group) => group.items)
  const [error, setError] = useState<{ section: string; message: string }>()
  const [edge, scrolled] = useScrolledUnder<HTMLElement>()
  const [notice, setNotice] = useState('')
  const panelMotion = useTabMotion<HTMLDivElement>(
    shown,
    visible.map((item) => item.id),
  )
  const [busy, setBusy] = useState(false)
  const query = useQueryClient()
  const login = useQuery({
    queryKey: ['desktop', 'login-item'],
    queryFn: () => window.yuki.loginItem().then(unwrap),
    retry: false,
  })
  const history = useQuery({
    queryKey: [connection?.characterId, 'retired-history'],
    queryFn: () => window.yuki.client.retiredHistory(connection!.characterId).then(unwrap),
    enabled: shown === 'advanced' && !!connection,
  })
  const choose = (value: SettingsCategory) => {
    onCategory(value)
    setError(undefined)
    setNotice('')
  }
  const change = async (patch: Partial<Preferences>, section: string) => {
    setError(undefined)
    try {
      await save(patch)
    } catch {
      setError({ section, message: t('settings:saveFailed') })
    }
  }
  const setLogin = async (enabled: boolean) => {
    setBusy(true)
    setError(undefined)
    try {
      query.setQueryData(['desktop', 'login-item'], unwrap(await window.yuki.loginItem(enabled)))
    } catch {
      setError({ section: 'startup', message: t('settings:loginFailed') })
    } finally {
      setBusy(false)
    }
  }
  const loginDescription =
    login.data?.reason === 'install-required'
      ? t('settings:loginInstallRequired')
      : login.data?.reason === 'system-approval-required'
        ? t('settings:loginApprovalRequired')
        : t('settings:loginDescription')
  const yukiTitle = connection && (
    <div className={styles.yukiTitle}>
      <Avatar name={connection.name} size={20} />
      <span className={styles.yukiName}>{connection.name}</span>
    </div>
  )
  const feedback = (section: string) => (
    <>
      {error?.section === section && <Banner status="failed">{error.message}</Banner>}
      {section === 'advanced' && notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
    </>
  )
  return (
    <section ref={edge} className={styles.settings} aria-label={t('settings:title')}>
      <EdgeFade shown={scrolled} />
      <header className={`${styles.header} ${scrolled ? styles.headerScrolled : ''}`}>
        <Button variant="plain" onClick={back} disabled={!!connection?.logout}>
          <ArrowLeft size={16} />
          {t('settings:back')}
        </Button>
        <strong>{t('settings:title')}</strong>
        <ApplicationMenu platform={boot.platform} className={styles.menu} />
      </header>
      <div className={styles.layout}>
        <nav
          className={styles.categories}
          role="tablist"
          aria-label={t('settings:categories')}
          aria-orientation="vertical"
        >
          <SelectionPill selected={shown} selector="button[aria-selected=true]" />
          {visibleGroups.map((group) => (
            <div key={group.heading ?? 'current-yuki'} className={styles.categoryGroup}>
              {group.heading === null && connection ? (
                <div className={styles.yukiHeader}>
                  {connections.length > 1 ? (
                    <RoleSwitcher
                      trigger={yukiTitle}
                      connections={connections}
                      selected={connection.characterId}
                      select={onSelect}
                      onAdd={onAddCharacter}
                      onDeploy={onDeployLocal}
                      onAbout={about}
                    />
                  ) : (
                    yukiTitle
                  )}
                </div>
              ) : group.heading ? (
                <div className={styles.navGroup}>{t(`settings:${group.heading}`)}</div>
              ) : null}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  id={`settings-${item.id}`}
                  role="tab"
                  aria-selected={shown === item.id}
                  aria-controls="settings-panel"
                  tabIndex={shown === item.id ? 0 : -1}
                  onClick={() => choose(item.id)}
                  onKeyDown={(event) => {
                    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const index = visible.findIndex((entry) => entry.id === item.id)
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? visible.length - 1
                          : (index + (event.key === 'ArrowDown' ? 1 : visible.length - 1)) %
                            visible.length
                    choose(visible[next]!.id)
                    ;(
                      event.currentTarget
                        .closest('[role="tablist"]')!
                        .querySelectorAll('[role="tab"]')[next] as HTMLElement
                    ).focus()
                  }}
                >
                  <item.icon size={16} strokeWidth={1.5} />
                  {t(`settings:category.${item.id}`)}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div
          ref={panelMotion}
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-${shown}`}
          className={styles.pane}
        >
          <h2>
            {shown === 'connection' && connection
              ? t('settings:connectionOf', { name: connection.name })
              : t(`settings:category.${shown}`)}
          </h2>
          {shown === 'general' ? (
            <>
              <SettingsSection title={t('settings:language')}>
                {feedback('language')}
                <Row title={t('settings:interfaceLanguage')}>
                  <select
                    aria-label={t('settings:interfaceLanguage')}
                    value={preferences.language}
                    onChange={(event) =>
                      void change(
                        { language: event.target.value as Preferences['language'] },
                        'language',
                      )
                    }
                  >
                    <option value="system">{t('common:followSystem')}</option>
                    {languages.map((language) => (
                      <option key={language} value={language} lang={language}>
                        {languageNames[language]}
                      </option>
                    ))}
                  </select>
                </Row>
              </SettingsSection>
              <SettingsSection title={t('settings:startup')}>
                {feedback('startup')}
                <Row title={t('settings:openAtLogin')} description={loginDescription}>
                  {login.isPending ? (
                    <Spinner />
                  ) : (
                    <>
                      {login.data?.reason === 'system-approval-required' && (
                        <Button
                          onClick={() => void login.refetch()}
                          aria-label={t('settings:reloadLogin')}
                        >
                          {t('settings:reload')}
                        </Button>
                      )}
                      <Toggle
                        label={t('settings:openAtLogin')}
                        checked={login.data?.enabled ?? false}
                        disabled={!login.data?.available || busy}
                        onChange={(enabled) => void setLogin(enabled)}
                      />
                    </>
                  )}
                </Row>
                {login.isError && (
                  <Row title={t('settings:loginUnreadable')}>
                    <Button onClick={() => void login.refetch()}>{t('settings:reload')}</Button>
                  </Row>
                )}
                <Row
                  title={keepInTray}
                  description={
                    boot.platform === 'linux'
                      ? t('settings:trayLinux')
                      : t('settings:trayDescription')
                  }
                >
                  <Toggle
                    label={keepInTray}
                    checked={preferences.keepInTray}
                    onChange={(keepInTray) => void change({ keepInTray }, 'startup')}
                  />
                </Row>
              </SettingsSection>
              <SettingsSection title={t('settings:input')}>
                {feedback('input')}
                <Row title={t('settings:sendMessage')}>
                  <Segmented
                    label={t('settings:sendMessage')}
                    kind="radio"
                    value={preferences.sendKey}
                    items={[
                      { value: 'enter', label: 'Enter' },
                      { value: 'command-enter', label: modEnter },
                    ]}
                    onChange={(sendKey) => void change({ sendKey }, 'input')}
                  />
                </Row>
              </SettingsSection>
              <SettingsSection title={t('settings:time')}>
                {feedback('time')}
                <Row title={t('settings:timeDisplay')} description={t('settings:timeDescription')}>
                  <select
                    aria-label={t('settings:timeDisplay')}
                    value={preferences.timeZone}
                    onChange={(event) =>
                      void change(
                        { timeZone: event.target.value as Preferences['timeZone'] },
                        'time',
                      )
                    }
                  >
                    <option value="system">{t('common:followSystem')}</option>
                    <option value="Asia/Taipei">{t('settings:taipeiTime')}</option>
                  </select>
                </Row>
              </SettingsSection>
            </>
          ) : shown === 'look' ? (
            <SettingsSection>
              {feedback('look')}
              <Row title={t('settings:theme')}>
                <Segmented
                  label={t('settings:theme')}
                  kind="radio"
                  value={preferences.theme}
                  items={[
                    { value: 'system', label: t('common:followSystem') },
                    { value: 'light', label: t('settings:light') },
                    { value: 'dark', label: t('settings:dark') },
                  ]}
                  onChange={(theme) => void change({ theme }, 'look')}
                />
              </Row>
              <Row title={t('settings:material')} description={t('settings:materialDescription')}>
                <Segmented
                  label={t('settings:material')}
                  kind="radio"
                  value={preferences.opaque ? 'opaque' : 'frost'}
                  items={[
                    { value: 'frost', label: t('settings:frost') },
                    { value: 'opaque', label: t('settings:opaque') },
                  ]}
                  onChange={(material) => void change({ opaque: material === 'opaque' }, 'look')}
                />
              </Row>
              <Row title={t('settings:backdrop')} description={t('settings:backdropDescription')}>
                <BackdropPicker
                  value={preferences.backdrop}
                  onChange={(backdrop) => void change({ backdrop }, 'look')}
                />
              </Row>
              <Row
                title={t('settings:reducedMotion')}
                description={t('settings:reducedMotionDescription')}
              >
                <Toggle
                  label={t('settings:reducedMotion')}
                  checked={preferences.reducedMotion}
                  onChange={(reducedMotion) => void change({ reducedMotion }, 'look')}
                />
              </Row>
              <Row title={t('settings:highContrast')}>
                <Toggle
                  label={t('settings:highContrast')}
                  checked={preferences.highContrast}
                  onChange={(highContrast) => void change({ highContrast }, 'look')}
                />
              </Row>
            </SettingsSection>
          ) : shown === 'notify' ? (
            <>
              <p className={styles.notice}>{t('settings:notifyScope')}</p>
              <SettingsSection>
                {feedback('notify')}
                {(
                  ['notifyProactive', 'notifyWaiting', 'notifyCompleted', 'notifyHelp'] as const
                ).map((key) => (
                  <Row key={key} title={t(`settings:${key}`)}>
                    <Toggle
                      label={t(`settings:${key}`)}
                      checked={preferences[key]}
                      onChange={(value) => void change({ [key]: value }, 'notify')}
                    />
                  </Row>
                ))}
              </SettingsSection>
            </>
          ) : shown === 'updates' ? (
            <SettingsSection title={t('settings:appUpdates')}>
              <UpdatePanel preferences={preferences} save={save} />
            </SettingsSection>
          ) : shown === 'models' ? (
            connection && (
              <ModelSettings
                key={connection.characterId}
                connection={connection}
                page={modelPage}
                onPage={onModelPage}
              />
            )
          ) : shown === 'platforms' ? (
            connection && (
              <Platforms
                key={connection.characterId}
                connection={connection}
                onQQLogin={onQQLogin}
              />
            )
          ) : shown === 'computer' ? (
            <AgentConnector
              key={connection?.characterId}
              connection={connection}
              deviceLabel={boot.deviceLabel}
              onUpdates={() => onCategory('updates')}
            />
          ) : shown === 'devices' ? (
            connection && <DeviceSecurity key={connection.characterId} connection={connection} />
          ) : shown === 'connection' ? (
            connection &&
            (connection.logout ? (
              <SettingsSection title={t('settings:logout')} danger>
                <LogoutFlow
                  key={connection.characterId}
                  connection={connection}
                  onConnection={onConnection}
                  onLoggedOut={onLoggedOut}
                />
              </SettingsSection>
            ) : (
              <ServerSettings
                key={connection.characterId}
                connection={connection}
                onConnection={onConnection}
                onLoggedOut={onLoggedOut}
                about={about}
              />
            ))
          ) : shown === 'yukis' ? (
            <>
              {connections.length > 0 && (
                <SettingsSection title={t('settings:connected')}>
                  {connections.map((item) => {
                    const current = item.characterId === connection?.characterId
                    const status = item.needsPairing
                      ? t('settings:needsPairing')
                      : item.logout
                        ? t('settings:logoutPending')
                        : current
                          ? t('settings:current')
                          : ''
                    return (
                      <Row
                        key={item.characterId}
                        title={item.name}
                        description={`${item.baseUrl}${status ? ` · ${status}` : ''}`}
                      >
                        <Avatar name={item.name} size={24} />
                        {!current && (
                          <Button onClick={() => onSelect(item)}>{t('settings:switch')}</Button>
                        )}
                      </Row>
                    )
                  })}
                </SettingsSection>
              )}
              <SettingsSection title={t('settings:add')}>
                <Row
                  title={t('settings:connectExisting')}
                  description={t('settings:connectExistingDescription')}
                >
                  <Button onClick={onAddCharacter}>{t('settings:connect')}</Button>
                </Row>
                <Row
                  title={t('settings:deployLocal')}
                  description={t('settings:deployLocalDescription')}
                >
                  <Button onClick={onDeployLocal}>{t('settings:deployManage')}</Button>
                </Row>
                <Row
                  title={t('remoteDeploy:deploy')}
                  description={t('remoteDeploy:deployDescription')}
                >
                  <Button onClick={onDeployRemote}>{t('remoteDeploy:deploy')}</Button>
                </Row>
              </SettingsSection>
            </>
          ) : (
            <SettingsSection>
              {feedback('advanced')}
              <Row
                title={t('settings:exportDiagnostics')}
                description={t('settings:exportDiagnosticsDescription')}
              >
                <Button
                  loading={busy}
                  onClick={async () => {
                    setBusy(true)
                    setError(undefined)
                    setNotice('')
                    try {
                      if (unwrap(await window.yuki.exportDiagnostics()))
                        setNotice(t('settings:diagnosticsExported'))
                    } catch {
                      setError({
                        section: 'advanced',
                        message: t('settings:diagnosticsFailed'),
                      })
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {t('settings:export')}
                </Button>
              </Row>
              {!!history.data?.length && (
                <Row
                  title={t('settings:retiredHistory')}
                  description={t('settings:retiredHistoryDescription')}
                >
                  <Button
                    onClick={async () => {
                      setError(undefined)
                      try {
                        if (
                          unwrap(
                            await window.yuki.client.exportRetiredHistory(connection!.characterId),
                          )
                        )
                          setNotice(t('settings:retiredExported'))
                      } catch {
                        setError({ section: 'advanced', message: t('settings:retiredFailed') })
                      }
                    }}
                  >
                    {t('settings:exportRecords', {
                      count: history.data.reduce((sum, item) => sum + item.count, 0),
                    })}
                  </Button>
                </Row>
              )}
            </SettingsSection>
          )}
        </div>
      </div>
    </section>
  )
}

// Each choice previews the backdrop itself, in the current theme.
function BackdropPicker({ value, onChange }: { value: Backdrop; onChange(value: Backdrop): void }) {
  const { t } = useTranslation(['settings'])
  return (
    <div role="radiogroup" aria-label={t('settings:backdrop')} className={styles.backdrops}>
      {backdrops.map((backdrop, index) => (
        <button
          key={backdrop}
          type="button"
          role="radio"
          aria-checked={value === backdrop}
          tabIndex={value === backdrop ? 0 : -1}
          className={styles.backdrop}
          onClick={() => onChange(backdrop)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
            event.preventDefault()
            const next =
              backdrops[
                (index + (event.key === 'ArrowRight' ? 1 : backdrops.length - 1)) % backdrops.length
              ]!
            onChange(next)
            const group = event.currentTarget.parentElement!
            requestAnimationFrame(() =>
              group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(),
            )
          }}
        >
          <span
            className={styles.backdropSwatch}
            style={{ background: `var(--backdrop-${backdrop}), var(--surface-page)` }}
          />
          <span>{t(`settings:backdrops.${backdrop}`)}</span>
        </button>
      ))}
    </div>
  )
}
