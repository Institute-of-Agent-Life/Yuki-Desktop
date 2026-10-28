import { useEffect, useRef, useState } from 'react'
import { Clipboard, Snowflake } from 'lucide-react'
import type { Connection, Meta, PendingPairing } from '../../shared/api'
import { parsePairing } from '../../shared/pairing'
import { Banner, Button, TextField } from '../components/Controls'
import { PairingAvatar } from '../components/CharacterAvatar'
import { ClientProblem, problemText, unwrap } from '../queries/client'
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
  onUpdate,
  onDeploy,
  onSkip,
  onSettings,
  onHelp,
  active = true,
}: {
  label: string
  initialLink: string | null
  initialServer?: string
  reconnect?: boolean
  startAtServer?: boolean
  active?: boolean
  onCancel?(): void
  onUpdate(): void
  onDeploy?(): void
  onSkip?(): void
  onSettings?(): void
  onHelp?(): void
  onDone(connection: Connection, activate?: boolean): void
  onResumeLogout(characterId: string): Promise<void>
}) {
  const [step, setStep] = useState<'welcome' | 'connect' | 'confirm'>(
    initialServer || startAtServer ? 'connect' : 'welcome',
  )
  const [input, setInput] = useState(''),
    [server, setServer] = useState(initialServer),
    [device, setDevice] = useState(label)
  const [manual, setManual] = useState(!!initialServer)
  const [confirmed, setConfirmed] = useState<{ server: string; meta: Meta }>()
  const [pending, setPending] = useState<PendingPairing[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [updateNeeded, setUpdateNeeded] = useState(false),
    [pendingLogout, setPendingLogout] = useState<string>()
  const current = useRef<object | undefined>(undefined)
  const form = useRef({ input, server, active })
  form.current = { input, server, active }
  useEffect(() => {
    if (!active) {
      current.current = undefined
      setBusy(false)
    }
  }, [active])
  const refreshPending = () => window.yuki.client.pendingPairings().then(unwrap).then(setPending)
  const leave = () => {
    current.current = undefined
    setBusy(false)
    setError('')
    setConfirmed(undefined)
  }
  const run = async (action: (owner: object) => Promise<void>, pairing = false) => {
    const owner = {}
    current.current = owner
    setBusy(true)
    setError('')
    setUpdateNeeded(false)
    setPendingLogout(undefined)
    try {
      await action(owner)
    } catch (failure) {
      if (current.current !== owner) return
      const code = failure instanceof ClientProblem ? failure.code : ''
      setError(
        pairing && code === 'unauthenticated'
          ? problemText('invalid_code')
          : failure instanceof Error
            ? failure.message
            : '操作未完成。',
      )
      setUpdateNeeded(code === 'client_upgrade_required')
      if (code === 'logout_pending' && confirmed) setPendingLogout(confirmed.meta.character.id)
      await refreshPending()
    } finally {
      if (current.current === owner) setBusy(false)
    }
  }
  const inspect = (value: string = input, address: string = server) => {
    const parsed = parsePairing(value),
      base = parsed?.server ?? address
    if (!base.trim()) {
      setManual(true)
      setError('這份配對資訊沒有伺服器位址，請向提供者取得，或選擇手動連接。')
      return
    }
    void run(async (owner) => {
      const meta = unwrap(await window.yuki.client.meta(base))
      if (current.current !== owner || !form.current.active) return
      setServer(base)
      setConfirmed({ server: base, meta })
      setStep('confirm')
    })
  }
  useEffect(() => {
    void refreshPending()
    return () => {
      current.current = undefined
    }
  }, [])
  useEffect(() => {
    const prefill = (link: string) => {
      const parsed = parsePairing(link)
      if (!parsed) return
      leave()
      setInput(link)
      setStep('connect')
      if (parsed.server) {
        setServer(parsed.server)
        inspect(link, parsed.server)
      }
    }
    if (initialLink) prefill(initialLink)
    return window.yuki.onPairLink(prefill)
    // The incoming link owns this check; subsequent form edits invalidate it.
  }, [initialLink])
  const parsed = parsePairing(input)
  const awaiting =
    confirmed && pending.find((item) => item.characterId === confirmed.meta.character.id)
  const finish = async (
    operation: Promise<import('../../shared/api').ApiReply<Connection>>,
    owner: object,
  ) => {
    const value = unwrap(await operation)
    const activate = current.current === owner && form.current.active
    if (form.current.input === input && form.current.server === server) {
      leave()
      setInput('')
      setStep('connect')
      setServer(initialServer)
      setManual(!!initialServer)
    }
    setPending((items) => items.filter((item) => item.deviceId !== value.deviceId))
    onDone(value, activate)
  }
  const pair = () => {
    if (!confirmed || !parsed) return
    if (parsed.server && parsed.server !== confirmed.server) {
      inspect(input, parsed.server)
      return
    }
    void run(
      (owner) => finish(window.yuki.client.pair(confirmed.server, parsed.code, device), owner),
      true,
    )
  }
  const cancel = () => {
    leave()
    setInput('')
    if (onCancel) onCancel()
    else setStep('welcome')
  }
  return (
    <div className={styles.welcome}>
      <div data-glass="card" className={styles.welcomeInner}>
        {step === 'welcome' ? (
          <Snowflake className={styles.welcomeMark} size={96} strokeWidth={1} />
        ) : (
          confirmed && (
            <PairingAvatar
              server={confirmed.server}
              name={confirmed.meta.character.display_name}
              size={56}
              avatarUrl={confirmed.meta.character.avatar_url}
            />
          )
        )}
        <h1>
          {step === 'welcome'
            ? 'Yuki'
            : (confirmed?.meta.character.display_name ?? '連接已有 Yuki')}
        </h1>
        <p>
          {step === 'welcome'
            ? '和她聊聊，一起把事情做好。選擇你想從哪裡開始。'
            : step === 'confirm'
              ? '確認 Yuki 與伺服器，再允許這台裝置連接。'
              : '貼上配對連結或收到的完整配對資訊。'}
        </p>
        {error && <Banner status="failed">{error}</Banner>}
        {updateNeeded && <Button onClick={onUpdate}>查看 App 更新</Button>}
        {pendingLogout && (
          <Button onClick={() => void run(async () => onResumeLogout(pendingLogout))}>
            處理原連線的登出資料
          </Button>
        )}
        {reconnect && <Banner>重新連接原本人入口；草稿與未確認請求仍保留。</Banner>}
        {pending.map((item) => (
          <div key={item.deviceId} className={styles.server}>
            <p>已領取 {item.name} 的裝置憑據，尚待確認本人資料。可以繼續，不必重新兌換配對碼。</p>
            <div className={styles.actions}>
              <Button
                loading={busy}
                onClick={() =>
                  void run((owner) =>
                    finish(
                      window.yuki.client.resumePairing(item.characterId, item.deviceId),
                      owner,
                    ),
                  )
                }
              >
                繼續連接 {item.name}
              </Button>
              <Button
                variant="plain"
                onClick={() =>
                  void run(async () => {
                    unwrap(await window.yuki.client.forgetPairing(item.characterId, item.deviceId))
                    await refreshPending()
                  })
                }
              >
                放棄本機待完成連接
              </Button>
            </div>
            {!item.persistentCredentials && (
              <small>未啟用系統憑據保存，僅能在這次 App 執行中繼續。</small>
            )}
          </div>
        ))}
        {step === 'welcome' ? (
          <>
            <div className={styles.entryChoices}>
              <Button variant="primary" large onClick={() => setStep('connect')}>
                連接已有 Yuki
              </Button>
              {onDeploy && (
                <Button large onClick={onDeploy}>
                  在本機部署 Yuki
                </Button>
              )}
              {onSkip && (
                <Button variant="plain" onClick={onSkip}>
                  先逛逛，稍後設定
                </Button>
              )}
            </div>
            <div className={styles.actions}>
              {onSettings && (
                <Button variant="plain" onClick={onSettings}>
                  設定
                </Button>
              )}
              {onHelp && (
                <Button variant="plain" onClick={onHelp}>
                  使用說明
                </Button>
              )}
            </div>
          </>
        ) : (
          <form
            className={styles.server}
            onSubmit={(event) => {
              event.preventDefault()
              if (step === 'confirm') pair()
              else inspect()
            }}
          >
            {confirmed && <small>伺服器：{confirmed.server}</small>}
            <small>
              使用可從這台電腦存取的 Yuki 網址。透過 SSH、VPN 或 Tailscale 連接時，請先建立網路連線。
            </small>
            <label htmlFor="pair-code">配對連結、綁定碼或完整回覆</label>
            <div className={styles.codeRow}>
              <TextField
                id="pair-code"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={input}
                onChange={(event) => {
                  const value = event.target.value,
                    next = parsePairing(value)
                  current.current = undefined
                  setBusy(false)
                  setInput(value)
                  setError('')
                  if (next?.server && next.server !== confirmed?.server) {
                    setConfirmed(undefined)
                    setStep('connect')
                  }
                }}
              />
              <Button
                type="button"
                onClick={() =>
                  void window.yuki.client
                    .paste()
                    .then(unwrap)
                    .then((value) => {
                      leave()
                      setInput(value)
                      setStep('connect')
                      if (parsePairing(value)?.server) inspect(value)
                    })
                    .catch((failure) => setError(failure.message))
                }
              >
                <Clipboard size={14} aria-hidden="true" />
                貼上
              </Button>
            </div>
            <small>
              從已連接的 Yuki 取得配對資訊；綁定碼只可使用一次。沒有連結時可手動輸入地址。
            </small>
            {!manual && !confirmed && (
              <Button variant="plain" type="button" onClick={() => setManual(true)}>
                手動輸入伺服器位址
              </Button>
            )}
            {manual && !confirmed && (
              <>
                <label htmlFor="server-url">伺服器位址</label>
                <TextField
                  id="server-url"
                  autoComplete="url"
                  value={server}
                  placeholder="https://"
                  onChange={(event) => {
                    leave()
                    setServer(event.target.value)
                  }}
                />
              </>
            )}
            {step === 'confirm' && (
              <>
                <label htmlFor="device-name">這台裝置的名稱</label>
                <TextField
                  id="device-name"
                  value={device}
                  onChange={(event) => setDevice(event.target.value)}
                />
              </>
            )}
            <div className={styles.actions}>
              <Button
                type="button"
                variant="plain"
                onClick={() => {
                  if (step === 'confirm') {
                    leave()
                    setStep('connect')
                  } else cancel()
                }}
              >
                返回
              </Button>
              {step === 'confirm' ? (
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!parsed || !device.trim() || !!awaiting}
                >
                  確認並連接
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={!input.trim() && !server.trim()}
                >
                  繼續
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
