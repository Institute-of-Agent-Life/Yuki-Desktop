import type { ReactNode } from 'react'
import {
  ArrowLeft,
  BriefcaseBusiness,
  Folder,
  MessageCircle,
  Monitor,
  Settings2,
  Snowflake,
} from 'lucide-react'
import { Button } from '../components/Controls'
import { Workspace } from '../components/Workspace'
import { useWorkspace } from '../state/workspace'
import styles from './DisconnectedHome.module.css'

export function DisconnectedHome({
  platform,
  connect,
  deploy,
  onSettings,
  onSettingsBack,
  help,
  settings,
  roleSwitcher,
}: {
  platform: string
  connect(): void
  deploy(): void
  onSettings(): void
  onSettingsBack(): void
  help(): void
  settings?: ReactNode
  roleSwitcher?: ReactNode
}) {
  const view = useWorkspace((state) => state.view)
  const title =
    view === 'works'
      ? '工作'
      : view === 'files'
        ? '檔案與成果'
        : view === 'computer'
          ? '電腦'
          : view === 'about'
            ? '關於 Yuki Desktop'
            : '對話'
  const Icon =
    view === 'works'
      ? BriefcaseBusiness
      : view === 'files'
        ? Folder
        : view === 'computer'
          ? Monitor
          : view === 'about'
            ? Snowflake
            : MessageCircle
  return (
    <Workspace
      name="Yuki Desktop"
      avatar={<Snowflake size={28} strokeWidth={1.5} aria-hidden="true" />}
      status="尚未連接 Bot"
      presence="offline"
      platform={platform}
      floating={false}
      roleSwitcher={roleSwitcher}
      settings={settings}
      onSettings={onSettings}
      onView={settings ? onSettingsBack : undefined}
      toolbar={
        <>
          {settings && (
            <Button variant="plain" onClick={onSettingsBack}>
              <ArrowLeft size={16} />
              返回
            </Button>
          )}
          <strong className={styles.toolbarTitle}>{settings ? '設定' : title}</strong>
          {!settings && (
            <Button variant="plain" onClick={onSettings}>
              <Settings2 size={16} />
              設定
            </Button>
          )}
        </>
      }
      inspectorTitle="尚未連接 Bot"
      inspector={<p className={styles.inspectorEmpty}>連接 Bot 後，可以在這裡查看原工作與檔案。</p>}
    >
      <section className={styles.empty} aria-labelledby="disconnected-heading">
        <Icon className={styles.mark} size={40} strokeWidth={1.25} aria-hidden="true" />
        <h1 id="disconnected-heading">
          {view === 'works'
            ? '工作會顯示在這裡'
            : view === 'files'
              ? '檔案與成果會顯示在這裡'
              : view === 'computer'
                ? 'Yuki 的電腦會顯示在這裡'
                : view === 'about'
                  ? 'Yuki Desktop'
                  : '你的 Yuki 工作區'}
        </h1>
        <p className={styles.description}>
          {view === 'works'
            ? '連接你的 Bot 後，可以查看真實工作、補充要求，並跟進原本的進度與結果。'
            : view === 'files'
              ? '連接你的 Bot 後，可以瀏覽檔案與成果的原版本、比較內容，並返回原始訊息或工作。'
              : view === 'computer'
                ? '連接你的 Bot 後，可以查看她的電腦、接手操作，再交回原工作。'
                : view === 'about'
                  ? '與自己的 Bot 對話、查看工作，也可以讓她使用本機的編程 Agent。角色資料會在連接後顯示。'
                  : 'Bot 可以稍後再設定。你現在就能使用工作區、本機設定和說明；連接後即可開始對話。'}
        </p>
        <div className={styles.actions}>
          <Button variant="primary" large onClick={connect}>
            連接已有 Yuki
          </Button>
          <Button large onClick={deploy}>
            在本機部署 Yuki
          </Button>
        </div>
        <p className={styles.hint}>隨時可以從設定中的「Yuki 連接」繼續配置連線。</p>
        <Button variant="plain" onClick={help}>
          使用說明
        </Button>
      </section>
    </Workspace>
  )
}
