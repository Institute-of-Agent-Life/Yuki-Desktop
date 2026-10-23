import { useState } from 'react'
import { Snowflake } from 'lucide-react'
import { Button } from '../components/Controls'
import styles from '../App.module.css'

export function DisconnectedHome({
  connect,
  deploy,
  settings,
  help,
}: {
  connect(): void
  deploy(): void
  settings(): void
  help(): void
}) {
  const [exploring, setExploring] = useState(false)
  return (
    <div className={styles.welcome}>
      <section data-glass="card" className={styles.welcomeInner}>
        <Snowflake className={styles.welcomeMark} size={80} strokeWidth={1} />
        <h1>{exploring ? '你的 Yuki 工作區' : 'Yuki'}</h1>
        <p>
          {exploring
            ? '尚未連接角色。本機設定和使用說明現在就能使用，連接後即可聊天和接續工作。'
            : '和她聊聊，一起把事情做好。你可以連接已有 Yuki，也可以把她部署在這台電腦。'}
        </p>
        <div className={styles.entryChoices}>
          <Button variant="primary" large onClick={connect}>
            連接已有 Yuki
          </Button>
          <Button large onClick={deploy}>
            在本機部署 Yuki
          </Button>
          {!exploring && (
            <Button variant="plain" onClick={() => setExploring(true)}>
              先逛逛，稍後設定
            </Button>
          )}
        </div>
        {exploring && (
          <div className={styles.server}>
            <h2>對話與工作</h2>
            <p>連接你的角色後，可以讀取本人對話、傳送文字和附件，接續她正在處理的工作。</p>
            <h2>本機 Codex</h2>
            <p>
              已有並登入 Codex 時，可在連接 Yuki 後明確授權這台電腦，讓她在你選的專案或會話中工作。
            </p>
            <h2>角色與 SOUL</h2>
            <p>角色擁有者可以修改名稱、資料與同一份 SOUL。未連接時不會建立人物或發出業務請求。</p>
          </div>
        )}
        <div className={styles.actions}>
          <Button variant="plain" onClick={settings}>
            設定
          </Button>
          <Button variant="plain" onClick={help}>
            使用說明
          </Button>
        </div>
      </section>
    </div>
  )
}
