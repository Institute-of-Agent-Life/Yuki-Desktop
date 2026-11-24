import { useTabMotion } from '../motion/tab'
import { useRef, useState, type DragEvent } from 'react'
import { backdropUrl, blurBackdrop, importBackdrop } from '../materials/backdrop'
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
import {
  backdrops,
  defaultPreferences,
  type Backdrop,
  type BootInfo,
  type CustomBackdrop,
  type Preferences,
  type PreferencesPatch,
} from '../../shared/desktop'
import {
  Avatar,
  Banner,
  Button,
  Segmented,
  Slider,
  Spinner,
  Toggle,
  SelectionPill,
} from '../components/Controls'
import { ClientProblem, unwrap } from '../queries/client'
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
  save(patch: PreferencesPatch): Promise<void>
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
  const change = async (patch: PreferencesPatch, section: string) => {
    setError(undefined)
    try {
      await save(patch)
    } catch {
      setError({ section, message: t('settings:saveFailed') })
    }
  }
  // A picture of one's own for a theme: chosen in the file dialog, or dropped. Its blur, if any, is
  // drawn for it at once, so a new picture is never shown sharp under a blurred setting.
  const pictureFor = async (picture?: File) => {
    setError(undefined)
    try {
      const input = picture
        ? unwrap(await window.yuki.backgrounds.drop(picture))
        : unwrap(await window.yuki.backgrounds.pick())
      if (!input) return undefined
      const id = await importBackdrop(input.bytes).catch((error: unknown) => {
        throw error instanceof ClientProblem ? error : new ClientProblem('unsupported_image')
      })
      if (preferences.customBackdrop.blur) await blurBackdrop(id, preferences.customBackdrop.blur)
      return id
    } catch (error) {
      setError({
        section: 'look',
        message: error instanceof Error ? error.message : t('settings:saveFailed'),
      })
      return undefined
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
              <Row
                title={t('settings:transparency')}
                description={t('settings:transparencyDescription')}
              >
                <TransparencySlider
                  value={preferences.transparency}
                  onChange={(transparency) => void change({ transparency }, 'look')}
                />
              </Row>
              <Row title={t('settings:backdrop')} description={t('settings:backdropDescription')}>
                <BackdropPicker
                  value={preferences.backdrop}
                  custom={preferences.customBackdrop}
                  onChange={(backdrop) => void change({ backdrop }, 'look')}
                  onPicture={(picture) =>
                    void pictureFor(picture).then((light) => {
                      if (light)
                        return change({ backdrop: 'custom', customBackdrop: { light } }, 'look')
                    })
                  }
                />
              </Row>
              {preferences.backdrop === 'custom' && (
                <CustomBackdropRows
                  backdrop={preferences.customBackdrop}
                  pictureFor={pictureFor}
                  change={(customBackdrop) => change({ customBackdrop }, 'look')}
                  remove={() =>
                    void change(
                      {
                        backdrop: defaultPreferences.backdrop,
                        customBackdrop: { light: undefined, dark: undefined },
                      },
                      'look',
                    )
                  }
                />
              )}
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

/*
 * The window's transparency (docs/reports/2026-11-23-liquid-glass/slider-v2.md): the page follows
 * the thumb at once through `--window-transparency`, and the preference is saved when it is let
 * go, or at once when it reaches or leaves 0, which turns the window's native material off or on.
 */
function TransparencySlider({ value, onChange }: { value: number; onChange(value: number): void }) {
  const { t } = useTranslation(['settings'])
  // What the thumb last showed, and a value saved as it crossed 0, not to be saved twice.
  const shown = useRef(value),
    crossed = useRef<number | undefined>(undefined)
  return (
    <div className={styles.transparency}>
      <svg role="img" aria-label={t('settings:transparencyMin')} viewBox="0 0 16 16">
        <rect x="3" y="3" width="10" height="10" rx="2.5" fill="currentColor" />
      </svg>
      <Slider
        label={t('settings:transparency')}
        value={value}
        min={0}
        max={100}
        valueText={(value) =>
          value === 0
            ? t('settings:transparencyOpaque')
            : t('settings:transparencyValue', { value })
        }
        onChange={(next) => {
          document.documentElement.style.setProperty('--window-transparency', String(next / 100))
          if ((next === 0) !== (shown.current === 0)) {
            crossed.current = next
            onChange(next)
          }
          shown.current = next
        }}
        onCommit={(next) => {
          const saved = crossed.current === next
          crossed.current = undefined
          if (!saved) onChange(next)
        }}
      />
      <svg role="img" aria-label={t('settings:transparencyMax')} viewBox="0 0 16 16">
        <rect
          x="1.6"
          y="1.6"
          width="12.8"
          height="12.8"
          rx="3"
          fill="currentColor"
          fillOpacity="0.2"
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
    </div>
  )
}

/*
 * A picture of one's own: chosen again, a separate one for dark, how it fits, its blur and dim, or
 * removed. A blur is drawn into a copy of each picture when it is let go, then saved.
 */
function CustomBackdropRows({
  backdrop,
  pictureFor,
  change,
  remove,
}: {
  backdrop: CustomBackdrop
  pictureFor(): Promise<string | undefined>
  change(part: Partial<CustomBackdrop>): Promise<void>
  remove(): void
}) {
  const { t } = useTranslation(['settings'])
  const [separate, setSeparate] = useState(Boolean(backdrop.dark))
  const choose = (theme: 'light' | 'dark') =>
    void pictureFor().then((id) => {
      if (id) return change({ [theme]: id })
    })
  return (
    <>
      <Row title={t('settings:backdrops.custom')}>
        <div className={styles.customActions}>
          <Button onClick={() => choose('light')}>{t('settings:backdropChoose')}</Button>
          {separate && (
            <Button onClick={() => choose('dark')}>{t('settings:backdropChooseDark')}</Button>
          )}
          <Button onClick={remove}>{t('settings:backdropRemove')}</Button>
        </div>
      </Row>
      <Row title={t('settings:backdropPerTheme')}>
        <Toggle
          label={t('settings:backdropPerTheme')}
          checked={separate}
          onChange={(next) => {
            setSeparate(next)
            if (!next && backdrop.dark) void change({ dark: undefined })
          }}
        />
      </Row>
      <Row title={t('settings:backdropFit')}>
        <Segmented
          label={t('settings:backdropFit')}
          kind="radio"
          value={backdrop.fit}
          items={[
            { value: 'fill', label: t('settings:backdropFill') },
            { value: 'fit', label: t('settings:backdropFitInside') },
            { value: 'tile', label: t('settings:backdropTile') },
          ]}
          onChange={(fit) => void change({ fit })}
        />
      </Row>
      <Row title={t('settings:backdropBlur')}>
        <div className={styles.backdropSlider}>
          <Slider
            label={t('settings:backdropBlur')}
            value={backdrop.blur}
            min={0}
            max={20}
            valueText={(value) => t('settings:backdropBlurValue', { value })}
            onChange={() => {}}
            onCommit={(blur) =>
              void Promise.all(
                [backdrop.light, backdrop.dark]
                  .filter((id): id is string => Boolean(id) && blur > 0)
                  .map((id) => blurBackdrop(id, blur)),
              ).then(() => change({ blur }))
            }
          />
        </div>
      </Row>
      <Row title={t('settings:backdropDim')}>
        <div className={styles.backdropSlider}>
          <Slider
            label={t('settings:backdropDim')}
            value={backdrop.dim}
            min={0}
            max={60}
            valueText={(value) => t('settings:backdropDimValue', { value })}
            onChange={() => {}}
            onCommit={(dim) => void change({ dim })}
          />
        </div>
      </Row>
    </>
  )
}

// Each choice previews the backdrop itself, in the current theme; the last is a picture of one's
// own, which also takes a picture dropped on it.
function BackdropPicker({
  value,
  custom,
  onChange,
  onPicture,
}: {
  value: Backdrop
  custom: CustomBackdrop
  onChange(value: Backdrop): void
  onPicture(picture?: File): void
}) {
  const { t } = useTranslation(['settings'])
  const [dropping, setDropping] = useState(false)
  const choices = [...backdrops, 'custom'] as const
  return (
    <div role="radiogroup" aria-label={t('settings:backdrop')} className={styles.backdrops}>
      {choices.map((backdrop, index) => (
        <button
          key={backdrop}
          type="button"
          role="radio"
          aria-checked={value === backdrop}
          tabIndex={value === backdrop ? 0 : -1}
          className={styles.backdrop}
          onClick={() =>
            backdrop === 'custom' && !custom.light ? onPicture() : onChange(backdrop)
          }
          {...(backdrop === 'custom'
            ? {
                onDragOver: (event: DragEvent<HTMLButtonElement>) => {
                  if (!event.dataTransfer.types.includes('Files')) return
                  event.preventDefault()
                  setDropping(true)
                },
                onDragLeave: () => setDropping(false),
                onDrop: (event: DragEvent<HTMLButtonElement>) => {
                  event.preventDefault()
                  setDropping(false)
                  const picture = event.dataTransfer.files[0]
                  if (picture) onPicture(picture)
                },
              }
            : {})}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
            event.preventDefault()
            const next =
              choices[
                (index + (event.key === 'ArrowRight' ? 1 : choices.length - 1)) % choices.length
              ]!
            if (next === 'custom' && !custom.light) onPicture()
            else onChange(next)
            const group = event.currentTarget.parentElement!
            requestAnimationFrame(() =>
              group.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus(),
            )
          }}
        >
          <span
            className={styles.backdropSwatch}
            data-dropping={backdrop === 'custom' && dropping ? '' : undefined}
            title={backdrop === 'custom' && dropping ? t('settings:backdropDrop') : undefined}
            style={{
              background:
                backdrop !== 'custom'
                  ? `var(--backdrop-${backdrop}), var(--surface-page)`
                  : custom.light
                    ? `url("${backdropUrl(`${custom.light}.webp`)}") center / cover`
                    : undefined,
            }}
          />
          <span>{t(`settings:backdrops.${backdrop}`)}</span>
        </button>
      ))}
    </div>
  )
}
