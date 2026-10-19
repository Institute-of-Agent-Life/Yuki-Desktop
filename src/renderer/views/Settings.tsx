import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, SlidersHorizontal, Palette, Bell, Wrench } from 'lucide-react'
import type { BootInfo, Preferences } from '../../shared/desktop'
import { Banner, Button, Segmented, Spinner, Toggle } from '../components/Controls'
import { unwrap } from '../queries/client'
import styles from './Settings.module.css'

const categories = [
  { id: 'general', label: '一般', icon: SlidersHorizontal },
  { id: 'look', label: '外觀', icon: Palette },
  { id: 'notify', label: '通知', icon: Bell },
  { id: 'advanced', label: '進階', icon: Wrench },
] as const
type Category = (typeof categories)[number]['id']
function Row({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.row}>
      <div className={styles.label}>
        {title}
        {description && <small>{description}</small>}
      </div>
      {children}
    </div>
  )
}
export function Settings({
  boot,
  preferences,
  save,
  back,
}: {
  boot: BootInfo
  preferences: Preferences
  save(patch: Partial<Preferences>): Promise<void>
  back(): void
}) {
  const [category, setCategory] = useState<Category>('general'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const query = useQueryClient()
  const login = useQuery({
    queryKey: ['desktop', 'login-item'],
    queryFn: () => window.yuki.loginItem().then(unwrap),
    retry: false,
  })
  const change = async (patch: Partial<Preferences>) => {
    setError('')
    try {
      await save(patch)
    } catch {
      setError('設定未能儲存，請重新開啟設定確認。')
    }
  }
  const setLogin = async (enabled: boolean) => {
    setBusy(true)
    setError('')
    try {
      query.setQueryData(['desktop', 'login-item'], unwrap(await window.yuki.loginItem(enabled)))
    } catch {
      setError('系統未能更新登入設定。請重新讀取目前狀態。')
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
  return (
    <section className={styles.settings} aria-label="設定">
      <header className={styles.header}>
        <Button variant="plain" onClick={back}>
          <ArrowLeft size={16} />
          返回
        </Button>
        <strong>設定</strong>
      </header>
      <div className={styles.layout}>
        <nav
          className={styles.categories}
          role="tablist"
          aria-label="設定分類"
          aria-orientation="vertical"
        >
          {categories.map((item, index) => (
            <button
              key={item.id}
              id={`settings-${item.id}`}
              role="tab"
              aria-selected={category === item.id}
              aria-controls="settings-panel"
              tabIndex={category === item.id ? 0 : -1}
              onClick={() => {
                setCategory(item.id)
                setError('')
                setNotice('')
              }}
              onKeyDown={(event) => {
                if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? categories.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : categories.length - 1)) %
                        categories.length
                setCategory(categories[next]!.id)
                ;(event.currentTarget.parentElement!.children[next] as HTMLElement).focus()
              }}
            >
              <item.icon size={16} strokeWidth={1.5} />
              {item.label}
            </button>
          ))}
        </nav>
        <div
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-${category}`}
          className={styles.pane}
        >
          <h2>{categories.find((item) => item.id === category)!.label}</h2>
          {error && <Banner status="failed">{error}</Banner>}
          {notice && (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          )}
          {category === 'general' ? (
            <>
              <div className={styles.group}>
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
                    onChange={(keepInTray) => void change({ keepInTray })}
                  />
                </Row>
                <Row title="送出訊息">
                  <Segmented
                    label="送出訊息"
                    value={preferences.sendKey}
                    items={[
                      { value: 'enter', label: 'Enter' },
                      { value: 'command-enter', label: '⌘ / Ctrl Enter' },
                    ]}
                    onChange={(sendKey) => void change({ sendKey })}
                  />
                </Row>
              </div>
            </>
          ) : category === 'look' ? (
            <div className={styles.group}>
              <Row title="主題">
                <Segmented
                  label="主題"
                  value={preferences.theme}
                  items={[
                    { value: 'system', label: '跟隨系統' },
                    { value: 'light', label: '淺色' },
                    { value: 'dark', label: '深色' },
                  ]}
                  onChange={(theme) => void change({ theme })}
                />
              </Row>
              <Row title="永遠不透明" description="側邊欄與工具列使用不透明背景。">
                <Toggle
                  label="永遠不透明"
                  checked={preferences.opaque}
                  onChange={(opaque) => void change({ opaque })}
                />
              </Row>
              <Row title="減少動態" description="減少介面的位移與過場。">
                <Toggle
                  label="減少動態"
                  checked={preferences.reducedMotion}
                  onChange={(reducedMotion) => void change({ reducedMotion })}
                />
              </Row>
              <Row title="增加對比">
                <Toggle
                  label="增加對比"
                  checked={preferences.highContrast}
                  onChange={(highContrast) => void change({ highContrast })}
                />
              </Row>
              <Row title="時間顯示" description="只影響這台電腦顯示的時間。">
                <select
                  aria-label="時間顯示"
                  value={preferences.timeZone}
                  onChange={(event) =>
                    void change({ timeZone: event.target.value as Preferences['timeZone'] })
                  }
                >
                  <option value="Asia/Taipei">UTC+8</option>
                  <option value="system">跟隨系統</option>
                </select>
              </Row>
            </div>
          ) : category === 'notify' ? (
            <div className={styles.group}>
              {(
                [
                  { key: 'notifyProactive', label: '角色主動訊息' },
                  { key: 'notifyWaiting', label: '等待你回覆' },
                  { key: 'notifyCompleted', label: '工作完成' },
                  { key: 'notifyHelp', label: '電腦協助請求' },
                ] as const
              ).map((item) => (
                <Row key={item.key} title={item.label}>
                  <Toggle
                    label={item.label}
                    checked={preferences[item.key]}
                    onChange={(value) => void change({ [item.key]: value })}
                  />
                </Row>
              ))}
            </div>
          ) : (
            <>
              <div className={styles.group}>
                <Row
                  title="匯出診斷記錄"
                  description="包含版本、外觀設定與佇列數量，不含憑據、訊息正文或本機檔案路徑。"
                >
                  <Button
                    loading={busy}
                    onClick={async () => {
                      setBusy(true)
                      setError('')
                      setNotice('')
                      try {
                        if (unwrap(await window.yuki.exportDiagnostics()))
                          setNotice('診斷記錄已匯出。')
                      } catch {
                        setError('無法匯出診斷記錄，請確認儲存位置可寫入。')
                      } finally {
                        setBusy(false)
                      }
                    }}
                  >
                    匯出…
                  </Button>
                </Row>
              </div>
              <p className={styles.version}>Yuki Desktop {boot.version}</p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
