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
  type LucideIcon,
} from 'lucide-react'
import type { Connection } from '../../shared/api'
import { UpdatePanel } from '../components/Updates'
import { ApplicationMenu } from '../components/ApplicationMenu'
import { RoleSwitcher } from '../components/RoleSwitcher'
import { ServerSettings } from './ServerSettings'
import { DeviceSecurity } from './DeviceSecurity'
import { AgentConnector } from './AgentConnector'
import { LogoutFlow } from './LogoutFlow'
import { Row, SettingsSection } from './SettingsRow'
import type { BootInfo, Preferences } from '../../shared/desktop'
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

export type SettingsCategory =
  | 'general'
  | 'look'
  | 'notify'
  | 'updates'
  | 'connection'
  | 'devices'
  | 'computer'
  | 'yukis'
  | 'advanced'

const groups: {
  label: string | null
  items: { id: SettingsCategory; label: string; icon: LucideIcon }[]
}[] = [
  {
    label: '應用程式',
    items: [
      { id: 'general', label: '一般', icon: SlidersHorizontal },
      { id: 'look', label: '外觀', icon: Palette },
      { id: 'notify', label: '通知', icon: Bell },
      { id: 'updates', label: '更新', icon: Download },
    ],
  },
  {
    label: null,
    items: [
      { id: 'connection', label: '連線', icon: Server },
      { id: 'devices', label: '裝置', icon: ShieldCheck },
      { id: 'computer', label: '這台電腦', icon: Laptop },
    ],
  },
  {
    label: '',
    items: [
      { id: 'yukis', label: '所有 Yuki', icon: Snowflake },
      { id: 'advanced', label: '進階', icon: Wrench },
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
  onAddCharacter,
  onDeployLocal,
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
  onAddCharacter(): void
  onDeployLocal(): void
}) {
  const shown = connection?.logout ? 'connection' : category
  const visibleGroups = groups.filter(
    (group) => group.label !== null || (connection && !connection.needsPairing),
  )
  const visible = visibleGroups.flatMap((group) => group.items)
  const [error, setError] = useState<{ section: string; message: string }>()
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
      setError({ section, message: '設定未能儲存，請重新開啟設定確認。' })
    }
  }
  const setLogin = async (enabled: boolean) => {
    setBusy(true)
    setError(undefined)
    try {
      query.setQueryData(['desktop', 'login-item'], unwrap(await window.yuki.loginItem(enabled)))
    } catch {
      setError({ section: 'startup', message: '系統未能更新登入設定。請重新讀取目前狀態。' })
    } finally {
      setBusy(false)
    }
  }
  const loginDescription =
    login.data?.reason === 'install-required'
      ? '使用正式安裝版後可設定。'
      : login.data?.reason === 'system-approval-required'
        ? '需要到系統的登入項目設定中核准。'
        : '登入這台電腦時開啟 Yuki。'
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
    <section className={styles.settings} aria-label="設定">
      <header className={styles.header}>
        <Button variant="plain" onClick={back} disabled={!!connection?.logout}>
          <ArrowLeft size={16} />
          返回
        </Button>
        <strong>設定</strong>
        <ApplicationMenu platform={boot.platform} className={styles.menu} />
      </header>
      <div className={styles.layout}>
        <nav
          className={styles.categories}
          role="tablist"
          aria-label="設定分類"
          aria-orientation="vertical"
        >
          <SelectionPill selected={shown} selector="button[aria-selected=true]" />
          {visibleGroups.map((group) => (
            <div key={group.label ?? 'current-yuki'} className={styles.categoryGroup}>
              {group.label === null && connection ? (
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
              ) : group.label ? (
                <div className={styles.navGroup}>{group.label}</div>
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
                  {item.label}
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
              ? `${connection.name} 的連線`
              : groups.flatMap((group) => group.items).find((item) => item.id === shown)!.label}
          </h2>
          {shown === 'general' ? (
            <>
              <SettingsSection title="啟動">
                {feedback('startup')}
                <Row title="登入時開啟" description={loginDescription}>
                  {login.isPending ? (
                    <Spinner />
                  ) : (
                    <>
                      {login.data?.reason === 'system-approval-required' && (
                        <Button onClick={() => void login.refetch()} aria-label="重新讀取登入設定">
                          重新讀取
                        </Button>
                      )}
                      <Toggle
                        label="登入時開啟"
                        checked={login.data?.enabled ?? false}
                        disabled={!login.data?.available || busy}
                        onChange={(enabled) => void setLogin(enabled)}
                      />
                    </>
                  )}
                </Row>
                {login.isError && (
                  <Row title="目前無法讀取登入設定">
                    <Button onClick={() => void login.refetch()}>重新讀取</Button>
                  </Row>
                )}
                <Row
                  title="關閉視窗時保持在選單列"
                  description={
                    boot.platform === 'linux'
                      ? 'Linux 桌面需支援 AppIndicator 才會顯示系統匣圖示。'
                      : '讓連線與通知在背景保持可用。'
                  }
                >
                  <Toggle
                    label="關閉視窗時保持在選單列"
                    checked={preferences.keepInTray}
                    onChange={(keepInTray) => void change({ keepInTray }, 'startup')}
                  />
                </Row>
              </SettingsSection>
              <SettingsSection title="輸入">
                {feedback('input')}
                <Row title="送出訊息">
                  <Segmented
                    label="送出訊息"
                    kind="radio"
                    value={preferences.sendKey}
                    items={[
                      { value: 'enter', label: 'Enter' },
                      { value: 'command-enter', label: '⌘ / Ctrl Enter' },
                    ]}
                    onChange={(sendKey) => void change({ sendKey }, 'input')}
                  />
                </Row>
              </SettingsSection>
              <SettingsSection title="時間">
                {feedback('time')}
                <Row title="時間顯示" description="只影響這台電腦顯示的時間。">
                  <select
                    aria-label="時間顯示"
                    value={preferences.timeZone}
                    onChange={(event) =>
                      void change(
                        { timeZone: event.target.value as Preferences['timeZone'] },
                        'time',
                      )
                    }
                  >
                    <option value="system">跟隨系統</option>
                    <option value="Asia/Taipei">台北時間（UTC+8）</option>
                  </select>
                </Row>
              </SettingsSection>
            </>
          ) : shown === 'look' ? (
            <SettingsSection>
              {feedback('look')}
              <Row title="主題">
                <Segmented
                  label="主題"
                  kind="radio"
                  value={preferences.theme}
                  items={[
                    { value: 'system', label: '跟隨系統' },
                    { value: 'light', label: '淺色' },
                    { value: 'dark', label: '深色' },
                  ]}
                  onChange={(theme) => void change({ theme }, 'look')}
                />
              </Row>
              <Row title="永遠不透明" description="側邊欄與工具列使用不透明背景。">
                <Toggle
                  label="永遠不透明"
                  checked={preferences.opaque}
                  onChange={(opaque) => void change({ opaque }, 'look')}
                />
              </Row>
              <Row title="減少動態" description="減少介面的位移與過場。">
                <Toggle
                  label="減少動態"
                  checked={preferences.reducedMotion}
                  onChange={(reducedMotion) => void change({ reducedMotion }, 'look')}
                />
              </Row>
              <Row title="增加對比">
                <Toggle
                  label="增加對比"
                  checked={preferences.highContrast}
                  onChange={(highContrast) => void change({ highContrast }, 'look')}
                />
              </Row>
            </SettingsSection>
          ) : shown === 'notify' ? (
            <>
              <p className={styles.notice}>適用於所有已連接的 Yuki。</p>
              <SettingsSection>
                {feedback('notify')}
                {(
                  [
                    { key: 'notifyProactive', label: 'Yuki 主動傳來的訊息' },
                    { key: 'notifyWaiting', label: '等待你回覆的工作' },
                    { key: 'notifyCompleted', label: '工作完成' },
                    { key: 'notifyHelp', label: 'Yuki 的電腦請求協助' },
                  ] as const
                ).map((item) => (
                  <Row key={item.key} title={item.label}>
                    <Toggle
                      label={item.label}
                      checked={preferences[item.key]}
                      onChange={(value) => void change({ [item.key]: value }, 'notify')}
                    />
                  </Row>
                ))}
              </SettingsSection>
            </>
          ) : shown === 'updates' ? (
            <SettingsSection title="App 更新">
              <UpdatePanel preferences={preferences} save={save} />
            </SettingsSection>
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
              <SettingsSection title="登出" danger>
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
              <SettingsSection title="已連接">
                {connections.map((item) => {
                  const current = item.characterId === connection?.characterId
                  const status = item.needsPairing
                    ? '需要重新配對'
                    : item.logout
                      ? '登出尚未完成'
                      : current
                        ? '目前使用中'
                        : ''
                  return (
                    <Row
                      key={item.characterId}
                      title={item.name}
                      description={`${item.baseUrl}${status ? ` · ${status}` : ''}`}
                    >
                      <Avatar name={item.name} size={24} />
                      {!current && <Button onClick={() => onSelect(item)}>切換</Button>}
                    </Row>
                  )
                })}
              </SettingsSection>
              <SettingsSection title="新增">
                <Row title="連接已有 Yuki" description="用配對連結或綁定碼連接。">
                  <Button onClick={onAddCharacter}>連接…</Button>
                </Row>
                <Row title="在這台電腦部署 Yuki" description="用 Docker 在本機執行一個 Yuki。">
                  <Button onClick={onDeployLocal}>部署與管理…</Button>
                </Row>
              </SettingsSection>
            </>
          ) : (
            <SettingsSection>
              {feedback('advanced')}
              <Row
                title="匯出診斷記錄"
                description="包含版本、外觀設定與佇列數量，不含憑據、訊息正文或本機檔案路徑。"
              >
                <Button
                  loading={busy}
                  onClick={async () => {
                    setBusy(true)
                    setError(undefined)
                    setNotice('')
                    try {
                      if (unwrap(await window.yuki.exportDiagnostics()))
                        setNotice('診斷記錄已匯出。')
                    } catch {
                      setError({
                        section: 'advanced',
                        message: '無法匯出診斷記錄，請確認儲存位置可寫入。',
                      })
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  匯出…
                </Button>
              </Row>
              {!!history.data?.length && (
                <Row
                  title="舊版操作記錄"
                  description="保留舊版頭像與本機操作的原始識別碼、未決操作及回執供查閱，不會重新執行。匯出檔案含原始操作資料，請自行保管。"
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
                          setNotice('舊版操作記錄已匯出。')
                      } catch {
                        setError({ section: 'advanced', message: '舊版操作記錄未能匯出。' })
                      }
                    }}
                  >
                    匯出 {history.data.reduce((sum, item) => sum + item.count, 0)} 筆記錄…
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
