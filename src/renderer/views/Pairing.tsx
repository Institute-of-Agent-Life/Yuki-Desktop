import { useEffect, useState } from 'react'
import { Snowflake } from 'lucide-react'
import type { Connection, Me, Meta } from '../../shared/api'
import { parsePairing } from '../../shared/pairing'
import { Banner, Button, TextField } from '../components/Controls'
import { PairingAvatar } from '../components/CharacterAvatar'
import { ClientProblem, unwrap } from '../queries/client'
import styles from '../App.module.css'

export function Pairing({
  label,
  initialLink,
  initialServer = '',
  reconnect = false,
  onDone,
  onResumeLogout,
  startAtServer = false,
  onCancel,
}: {
  label: string
  initialLink: string | null
  initialServer?: string
  reconnect?: boolean
  startAtServer?: boolean
  onCancel?(): void
  onDone(connection: Connection): void
  onResumeLogout(characterId: string): Promise<void>
}) {
  const [step, setStep] = useState<'welcome' | 'server' | 'code' | 'person'>(
    initialServer || startAtServer ? 'server' : 'welcome',
  )
  const [server, setServer] = useState(initialServer),
    [codeInput, setCodeInput] = useState(''),
    [device, setDevice] = useState(label)
  const [meta, setMeta] = useState<Meta>(),
    [me, setMe] = useState<Me>(),
    [connection, setConnection] = useState<Connection>()
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [pendingLogout, setPendingLogout] = useState<string>()
  const parsed = parsePairing(codeInput)
  const prefill = (link: string) => {
    const value = parsePairing(link)
    if (!value?.server) return
    setServer(value.server)
    setCodeInput(value.code)
    setMeta(undefined)
    setStep('server')
  }
  useEffect(() => {
    if (initialLink) prefill(initialLink)
    return window.yuki.onPairLink(prefill)
  }, [initialLink])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setPendingLogout(undefined)
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成。')
      if (error instanceof ClientProblem && error.code === 'logout_pending' && meta)
        setPendingLogout(meta.character.id)
    } finally {
      setBusy(false)
    }
  }
  const check = async () =>
    run(async () => {
      const link = parsePairing(server)
      const base = link?.server ?? server
      if (link) setCodeInput(link.code)
      const info = unwrap(await window.yuki.client.meta(base))
      setServer(base)
      setMeta(info)
      setStep('code')
    })
  const pair = async () =>
    run(async () => {
      if (!parsed || !meta) return
      const value = unwrap(await window.yuki.client.pair(server, parsed.code, device))
      const person = unwrap(await window.yuki.client.read<Me>(value.characterId, { kind: 'me' }))
      setConnection(value)
      setMe(person)
      setStep('person')
    })
  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeInner}>
        {meta && (
          <PairingAvatar
            server={server}
            name={meta.character.display_name}
            size={step === 'person' ? 80 : 36}
            avatarUrl={meta.character.avatar_url}
          />
        )}
        {step === 'welcome' && (
          <Snowflake className={styles.welcomeMark} size={160} strokeWidth={1} />
        )}
        <h1>
          {step === 'welcome'
            ? 'Yuki'
            : step === 'person'
              ? `你好，${me?.display_name ?? ''}`
              : (meta?.character.display_name ?? '連接你的角色')}
        </h1>
        <p>
          {step === 'welcome'
            ? '和她聊聊，一起把事情做好。無論從哪裡回來，都是同一個她。'
            : step === 'server'
              ? '輸入角色的伺服器位址，或貼上你收到的綁定連結。'
              : step === 'code'
                ? '確認這是你要連接的角色，再輸入綁定碼。'
                : '你在其他入口的對話與工作，也能在這裡接續。'}
        </p>
        {error && <Banner status="failed">{error}</Banner>}
        {pendingLogout && (
          <Button loading={busy} onClick={() => void run(() => onResumeLogout(pendingLogout))}>
            處理登出中的本機資料
          </Button>
        )}
        {reconnect && (
          <Banner>請重新配對以讀取原本的連線。本機草稿與未確認請求仍保留在原入口。</Banner>
        )}
        {step === 'welcome' && (
          <Button variant="primary" large onClick={() => setStep('server')}>
            開始
          </Button>
        )}
        {step === 'server' && (
          <form
            className={styles.server}
            onSubmit={(event) => {
              event.preventDefault()
              void check()
            }}
          >
            <label htmlFor="server-url">伺服器位址</label>
            <TextField
              id="server-url"
              autoFocus
              autoComplete="url"
              value={server}
              onChange={(event) => setServer(event.target.value)}
              placeholder="https://"
            />
            <small>可包含角色的路徑前綴。</small>
            <div className={styles.actions}>
              <Button
                variant="plain"
                onClick={() => (onCancel ? onCancel() : setStep('welcome'))}
                type="button"
              >
                {onCancel ? '取消' : '返回'}
              </Button>
              <Button variant="primary" type="submit" loading={busy} disabled={!server.trim()}>
                繼續
              </Button>
            </div>
          </form>
        )}
        {step === 'code' && (
          <form
            className={styles.server}
            onSubmit={(event) => {
              event.preventDefault()
              void pair()
            }}
          >
            <p>
              在 QQ／Telegram 私聊角色傳送 /ai link，將整則回覆貼上。綁定碼區分大小寫，10 分鐘有效。
            </p>
            <label htmlFor="pair-code">綁定碼或完整回覆</label>
            <div className={styles.codeRow}>
              <TextField
                id="pair-code"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className={styles.codeInput}
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value)}
              />
              <Button
                variant="plain"
                type="button"
                onClick={() =>
                  void window.yuki.client
                    .paste()
                    .then(unwrap)
                    .then(setCodeInput)
                    .catch((error) => setError(error.message))
                }
              >
                貼上
              </Button>
            </div>
            <small role="status">
              {parsed
                ? `已辨識：${parsed.code.slice(0, 6)}…${parsed.code.slice(-4)}（32 字元）`
                : '沒有找到 32 字元的綁定碼'}
            </small>
            <label htmlFor="device-name">裝置名稱</label>
            <TextField
              id="device-name"
              maxLength={100}
              value={device}
              onChange={(event) => setDevice(event.target.value)}
            />
            <div className={styles.actions}>
              <Button type="button" variant="plain" onClick={() => setStep('server')}>
                返回
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={!parsed || !device.trim()}
              >
                配對
              </Button>
            </div>
          </form>
        )}
        {step === 'person' && (
          <>
            <ul>
              {me?.bindings.map((item) => (
                <li key={item.binding_id}>
                  {item.platform.toUpperCase()} · {item.display_name}
                </li>
              ))}
            </ul>
            {connection && !connection.persistentCredentials && (
              <Banner>尚未啟用系統金鑰圈，本次憑據只保留到 App 結束。</Banner>
            )}
            <Button variant="primary" onClick={() => connection && onDone(connection)}>
              進入
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
