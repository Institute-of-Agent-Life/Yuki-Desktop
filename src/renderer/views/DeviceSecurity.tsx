import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import type { Connection, Me, LinkCodeReply, CharacterCommandItem } from '../../shared/api'
import { Banner, Button, Sheet, Spinner } from '../components/Controls'
import { hidesPrivateData, unwrap, problemText } from '../queries/client'
import { useDisplayTime } from '../state/time'
import { Row, SettingsSection, PendingRequest } from './SettingsRow'
import styles from './Settings.module.css'

export function DeviceSecurity({ connection }: { connection: Connection }) {
  const id = connection.characterId,
    query = useQueryClient(),
    { date } = useDisplayTime()
  const me = useQuery({
    queryKey: [id, 'me'],
    queryFn: () => window.yuki.client.read<Me>(id, { kind: 'me' }).then(unwrap),
    retry: false,
    enabled: !connection.logout,
  })
  const commands = useQuery({
    queryKey: [id, 'character-commands'],
    queryFn: () => window.yuki.client.characterCommands(id).then(unwrap),
    enabled: !connection.logout,
  })
  const codes = useQuery({
    queryKey: [id, 'link-code-requests'],
    queryFn: () => window.yuki.client.linkCodeRequests(id).then(unwrap),
    enabled: !connection.logout,
  })
  const [error, setError] = useState<{ section: string; message: string }>(),
    [notice, setNotice] = useState<{ section: string; message: string }>(),
    [busy, setBusy] = useState(false),
    [revoked, setRevoked] = useState(false),
    [revoke, setRevoke] = useState<Me['devices'][number]>()
  const [open, setOpen] = useState(false),
    [issued, setIssued] = useState<LinkCodeReply>(),
    [qr, setQR] = useState(''),
    [qrError, setQRError] = useState(''),
    [now, setNow] = useState(Date.now())
  const generation = useRef(0),
    lost = revoked || hidesPrivateData(me.error),
    data = lost ? undefined : me.data
  const refresh = () =>
    Promise.all(
      ['me', 'character-commands', 'link-code-requests'].map((key) =>
        query.invalidateQueries({ queryKey: [id, key] }),
      ),
    )
  const close = () => {
    generation.current++
    setOpen(false)
    setIssued(undefined)
    setQR('')
    setQRError('')
  }
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )
  useEffect(() => {
    if (lost || connection.logout) {
      close()
      setRevoke(undefined)
    }
  }, [lost, connection.logout])
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind, hint) => {
        if (
          character === id &&
          kind === 'connection' &&
          (hint as { code?: string })?.code === 'unauthenticated'
        ) {
          setRevoked(true)
          close()
          setRevoke(undefined)
        }
        if (
          character === id &&
          (['sync', 'refresh', 'character-command', 'link-code'].includes(kind) ||
            (kind === 'connection' && (hint as { code?: string })?.code === 'unauthenticated'))
        )
          void refresh()
      }),
    [id, query],
  )
  const link = issued?.code
    ? `yuki://pair?${new URLSearchParams({ server: connection.baseUrl, code: issued.code })}`
    : ''
  const expires = issued?.request.result?.expires_at
  const expired = !!expires && Date.parse(expires) <= now
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])
  useEffect(() => {
    if (expired) {
      setIssued((value) => (value ? { ...value, code: null } : undefined))
      setQR('')
    }
  }, [expired])
  useEffect(() => {
    let active = true
    setQR('')
    setQRError('')
    if (link && !expired)
      void QRCode.toDataURL(link, { width: 512, margin: 2, errorCorrectionLevel: 'M' })
        .then((value) => {
          if (active) setQR(value)
        })
        .catch(() => {
          if (active) setQRError('QR 暫時無法顯示，仍可複製綁定連結。')
        })
    return () => {
      active = false
    }
  }, [link, expired])
  const issue = async (requestId?: string) => {
    const attempt = ++generation.current
    setOpen(true)
    setIssued(undefined)
    setQR('')
    setError(undefined)
    setNotice(undefined)
    setBusy(true)
    try {
      const result = unwrap(
        requestId
          ? await window.yuki.client.verifyLinkCode(id, requestId)
          : await window.yuki.client.issueLinkCode(id),
      )
      if (generation.current === attempt) setIssued(result)
      await refresh()
    } catch (error) {
      if (generation.current === attempt)
        setError({
          section: 'codes',
          message: error instanceof Error ? error.message : '無法產生綁定碼。',
        })
    } finally {
      setBusy(false)
    }
  }
  const revokeDevice = async (
    deviceId: string,
    section: Me['devices'][number]['purpose'] | 'pending',
    requestId?: string,
  ) => {
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const item: CharacterCommandItem = unwrap(
        requestId
          ? await window.yuki.client.verifyCharacterCommand(id, requestId)
          : await window.yuki.client.characterCommand(id, { kind: 'device-revoke', deviceId }),
      )
      setRevoke(undefined)
      if (item.state === 'result') {
        if (item.problem) setError({ section, message: problemText(item.problem) })
        else setNotice({ section, message: '裝置已撤銷。' })
      }
      await refresh()
    } catch (error) {
      setError({
        section,
        message: error instanceof Error ? error.message : '撤銷結果尚未確認。',
      })
    } finally {
      setBusy(false)
    }
  }
  const copy = async (value: string) => {
    try {
      unwrap(await window.yuki.client.copy(value))
      setNotice({ section: 'codes', message: '已複製。' })
    } catch (error) {
      setError({ section: 'codes', message: error instanceof Error ? error.message : '無法複製。' })
    }
  }
  const pending =
    commands.data?.filter(
      (item) => item.command.kind === 'device-revoke' && item.state !== 'result',
    ) ?? []
  const feedback = (section: string) => (
    <>
      {error?.section === section && <Banner status="failed">{error.message}</Banner>}
      {notice?.section === section && (
        <p className={styles.notice} role="status">
          {notice.message}
        </p>
      )}
    </>
  )
  return (
    <>
      <p className={styles.notice}>
        這裡列出你在 {connection.name} 的登入與電腦連接器。撤銷只影響選定的一項。
      </p>
      {[
        { purpose: 'chat', title: '登入的裝置' },
        { purpose: 'connector', title: '電腦連接器' },
      ].map(({ purpose, title }) => {
        const devices = data?.devices.filter((device) => device.purpose === purpose)
        return purpose === 'connector' &&
          !devices?.length &&
          error?.section !== purpose &&
          notice?.section !== purpose ? null : (
          <SettingsSection key={purpose} title={title}>
            {purpose === 'chat' && (
              <>
                {me.isPending && <Spinner />}
                {revoked && !me.isError && (
                  <Banner status="failed">{problemText('unauthenticated')}</Banner>
                )}
                {me.isError && <Banner status="failed">{me.error.message}</Banner>}
              </>
            )}
            {feedback(purpose)}
            {devices?.map((device) => (
              <Row
                key={device.device_id}
                title={`${device.label || '未命名裝置'}${device.device_id === connection.deviceId ? '（目前這台）' : ''}`}
                description={`建立於 ${date(device.created_at)}${device.revoked_at ? ` · 已撤銷 ${date(device.revoked_at)}` : ''}`}
              >
                {device.revoked_at ? (
                  <span className={styles.notice}>已撤銷</span>
                ) : device.device_id !== connection.deviceId ? (
                  <Button
                    disabled={
                      busy ||
                      pending.some(
                        (item) =>
                          item.command.kind === 'device-revoke' &&
                          item.command.deviceId === device.device_id,
                      )
                    }
                    onClick={() => setRevoke(device)}
                    aria-label={`撤銷 ${device.label || '未命名裝置'}`}
                  >
                    撤銷…
                  </Button>
                ) : (
                  <span className={styles.notice}>使用中</span>
                )}
              </Row>
            ))}
          </SettingsSection>
        )
      })}
      {(pending.length > 0 || error?.section === 'pending' || notice?.section === 'pending') && (
        <SettingsSection>
          {feedback('pending')}
          {pending.map((item) => (
            <PendingRequest
              key={item.requestId}
              text="裝置撤銷：結果尚未確認。"
              busy={busy}
              onVerify={() => {
                if (item.command.kind === 'device-revoke')
                  void revokeDevice(item.command.deviceId, 'pending', item.requestId)
              }}
            />
          ))}
        </SettingsSection>
      )}
      <SettingsSection title="連接另一台裝置">
        {feedback('codes')}
        <Row title="產生一次性綁定碼" description="10 分鐘內可使用一次，請勿分享給他人。">
          <Button disabled={busy || !data} onClick={() => void issue()}>
            產生綁定碼
          </Button>
          {codes.data?.at(-1) && (
            <Button
              variant="plain"
              disabled={busy || !data}
              onClick={() => void issue(codes.data!.at(-1)!.requestId)}
            >
              查看上次結果
            </Button>
          )}
        </Row>
        {codes.data
          ?.filter((item) => item.state !== 'result')
          .map((item) => (
            <PendingRequest
              key={item.requestId}
              text="發碼結果尚未確認，原請求已保留。"
              busy={busy}
              onVerify={() => void issue(item.requestId)}
            />
          ))}
      </SettingsSection>
      <Sheet
        title="撤銷裝置？"
        open={!!revoke}
        onClose={() => {
          if (!busy) setRevoke(undefined)
        }}
        actions={
          <>
            <Button disabled={busy} onClick={() => setRevoke(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={() => void revokeDevice(revoke!.device_id, revoke!.purpose)}
            >
              撤銷裝置
            </Button>
          </>
        }
      >
        <p>「{revoke?.label || '未命名裝置'}」會失去這個 Yuki 的連線權限。之後需要重新配對。</p>
      </Sheet>
      <Sheet
        title="連接另一台裝置"
        open={open}
        onClose={close}
        actions={
          <Button variant="primary" autoFocus onClick={close}>
            完成
          </Button>
        }
      >
        <p>10 分鐘內、一次使用。請勿分享給他人。</p>
        {notice && (
          <p role="status" className={styles.notice}>
            {notice.message}
          </p>
        )}
        {busy && <Spinner />}
        {error && <Banner status="failed">{error.message}</Banner>}
        {issued &&
          (issued.request.problem ? (
            <Banner status="failed">
              {issued.request.state === 'result'
                ? problemText(issued.request.problem)
                : '發碼結果尚未確認。可關閉此視窗，稍後查證原請求。'}
            </Banner>
          ) : issued.code && !expired ? (
            <>
              <div className={styles.pairDetails}>
                <div>
                  {qr ? (
                    <img
                      className={styles.qr}
                      src={qr}
                      width={120}
                      height={120}
                      alt="綁定連結 QR"
                    />
                  ) : (
                    !qrError && <Spinner />
                  )}
                </div>
                <div>
                  {qrError && <p className={styles.notice}>{qrError}</p>}
                  <p className={styles.secret} aria-label="一次性綁定碼">
                    {issued.code}
                  </p>
                  <p className={styles.link} aria-label="一次性綁定連結">
                    {link}
                  </p>
                  <p className={styles.notice}>有效至 {date(expires ?? null)}</p>
                  <div className={styles.actions}>
                    <Button onClick={() => void copy(issued.code!)}>複製綁定碼</Button>
                    <Button onClick={() => void copy(link)}>複製綁定連結</Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p role="status">
              {expired
                ? '綁定碼已過期。可明確產生另一個碼。'
                : '已確認原發碼請求。綁定碼明文無法重新取得；需要時可明確產生另一個碼，先前的碼仍會按原期限失效。'}
            </p>
          ))}
        <Button variant="plain" disabled={busy || lost} onClick={() => void issue()}>
          再產生一個
        </Button>
      </Sheet>
    </>
  )
}
