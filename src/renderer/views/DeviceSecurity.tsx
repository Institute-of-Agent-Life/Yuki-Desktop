import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import type { Connection, Me, LinkCodeReply, CharacterCommandItem } from '../../shared/api'
import { Banner, Button, Sheet, Spinner } from '../components/Controls'
import { hidesPrivateData, unwrap, problemText, useApiRevision } from '../queries/client'
import { useDisplayTime } from '../state/time'
import { useTranslation } from '../i18n'
import { Row, SettingsSection, PendingRequest } from './SettingsRow'
import styles from './Settings.module.css'

type DeviceCommand = 'device-revoke' | 'device-delete'

export function DeviceSecurity({ connection }: { connection: Connection }) {
  const { t } = useTranslation(['devices', 'common'])
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
    [confirm, setConfirm] = useState<{ device: Me['devices'][number]; kind: DeviceCommand }>()
  const deletable = (useApiRevision(id) ?? 0) >= 15
  const [open, setOpen] = useState(false),
    [issued, setIssued] = useState<LinkCodeReply>(),
    [qr, setQR] = useState(''),
    [qrFailed, setQRFailed] = useState(false),
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
    setQRFailed(false)
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
      setConfirm(undefined)
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
          setConfirm(undefined)
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
    setQRFailed(false)
    if (link && !expired)
      void QRCode.toDataURL(link, { width: 512, margin: 2, errorCorrectionLevel: 'M' })
        .then((value) => {
          if (active) setQR(value)
        })
        .catch(() => {
          if (active) setQRFailed(true)
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
          message: error instanceof Error ? error.message : t('devices:issueFailed'),
        })
    } finally {
      setBusy(false)
    }
  }
  const deviceCommand = async (
    kind: DeviceCommand,
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
          : await window.yuki.client.characterCommand(id, { kind, deviceId }),
      )
      if (item.state === 'result') {
        if (item.problem) setError({ section, message: problemText(item.problem) })
        else
          setNotice({
            section,
            message:
              kind === 'device-delete'
                ? t('devices:deviceDeleted')
                : section === 'connector'
                  ? t('devices:connectorRemoved')
                  : t('devices:deviceRevoked'),
          })
      }
      await refresh()
    } catch (error) {
      setError({
        section,
        message:
          error instanceof Error
            ? error.message
            : kind === 'device-delete'
              ? t('devices:deleteUnconfirmed')
              : t('devices:revokeUnconfirmed'),
      })
    } finally {
      setConfirm(undefined)
      setBusy(false)
    }
  }
  const copy = async (value: string) => {
    try {
      unwrap(await window.yuki.client.copy(value))
      setNotice({ section: 'codes', message: t('devices:copied') })
    } catch (error) {
      setError({
        section: 'codes',
        message: error instanceof Error ? error.message : t('devices:copyFailed'),
      })
    }
  }
  const pending =
    commands.data?.filter(
      (item) =>
        (item.command.kind === 'device-revoke' || item.command.kind === 'device-delete') &&
        item.state !== 'result',
    ) ?? []
  const waiting = (deviceId: string) =>
    pending.some(
      (item) =>
        (item.command.kind === 'device-revoke' || item.command.kind === 'device-delete') &&
        item.command.deviceId === deviceId,
    )
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
      <p className={styles.notice}>{t('devices:intro', { name: connection.name })}</p>
      {[
        { purpose: 'chat', title: t('devices:signedIn') },
        { purpose: 'connector', title: t('devices:connectors') },
      ].map(({ purpose, title }) => {
        const devices = data?.devices.filter(
          (device) => device.purpose === purpose && (purpose !== 'connector' || !device.revoked_at),
        )
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
                title={
                  device.device_id === connection.deviceId
                    ? t('devices:currentDevice', { name: device.label || t('devices:unnamed') })
                    : device.label || t('devices:unnamed')
                }
                description={
                  device.revoked_at
                    ? t('devices:createdRevoked', {
                        created: date(device.created_at),
                        revoked: date(device.revoked_at),
                      })
                    : t('devices:created', { date: date(device.created_at) })
                }
              >
                {device.revoked_at ? (
                  <>
                    <span className={styles.notice}>{t('devices:revoked')}</span>
                    {deletable && (
                      <Button
                        disabled={busy || waiting(device.device_id)}
                        onClick={() => setConfirm({ device, kind: 'device-delete' })}
                        aria-label={t('devices:deleteNamed', {
                          name: device.label || t('devices:unnamed'),
                        })}
                      >
                        {t('devices:delete')}
                      </Button>
                    )}
                  </>
                ) : device.device_id !== connection.deviceId ? (
                  <Button
                    disabled={busy || waiting(device.device_id)}
                    onClick={() => setConfirm({ device, kind: 'device-revoke' })}
                    aria-label={t(
                      purpose === 'connector' ? 'devices:removeNamed' : 'devices:revokeNamed',
                      { name: device.label || t('devices:unnamed') },
                    )}
                  >
                    {purpose === 'connector' ? t('devices:remove') : t('devices:revoke')}
                  </Button>
                ) : (
                  <span className={styles.notice}>{t('devices:inUse')}</span>
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
              text={
                item.command.kind === 'device-delete'
                  ? t('devices:deletePending')
                  : t('devices:revokePending')
              }
              busy={busy}
              onVerify={() => {
                if (item.command.kind === 'device-revoke' || item.command.kind === 'device-delete')
                  void deviceCommand(
                    item.command.kind,
                    item.command.deviceId,
                    'pending',
                    item.requestId,
                  )
              }}
            />
          ))}
        </SettingsSection>
      )}
      <SettingsSection title={t('devices:connectAnother')}>
        {!open && feedback('codes')}
        <Row title={t('devices:oneTimeCode')} description={t('devices:oneTimeCodeDescription')}>
          <Button disabled={busy || !data} onClick={() => void issue()}>
            {t('devices:createCode')}
          </Button>
          {codes.data?.at(-1) && (
            <Button
              variant="plain"
              disabled={busy || !data}
              onClick={() => void issue(codes.data!.at(-1)!.requestId)}
            >
              {t('devices:lastResult')}
            </Button>
          )}
        </Row>
        {codes.data
          ?.filter((item) => item.state !== 'result')
          .map((item) => (
            <PendingRequest
              key={item.requestId}
              text={t('devices:issuePending')}
              busy={busy}
              onVerify={() => void issue(item.requestId)}
            />
          ))}
      </SettingsSection>
      <Sheet
        title={
          confirm?.kind === 'device-delete'
            ? t('devices:deleteDeviceTitle')
            : confirm?.device.purpose === 'connector'
              ? t('devices:removeComputerTitle')
              : t('devices:revokeDeviceTitle')
        }
        open={!!confirm}
        onClose={() => {
          if (!busy) setConfirm(undefined)
        }}
        actions={
          <>
            <Button disabled={busy} onClick={() => setConfirm(undefined)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={() =>
                void deviceCommand(
                  confirm!.kind,
                  confirm!.device.device_id,
                  confirm!.device.purpose,
                )
              }
            >
              {confirm?.kind === 'device-delete'
                ? t('devices:deleteDevice')
                : confirm?.device.purpose === 'connector'
                  ? t('devices:removeComputer')
                  : t('devices:revokeDevice')}
            </Button>
          </>
        }
      >
        {confirm?.kind === 'device-delete' ? (
          <p>{t('devices:deleteBody', { name: confirm.device.label || t('devices:unnamed') })}</p>
        ) : (
          <>
            <p>
              {t('devices:revokeBody', { name: confirm?.device.label || t('devices:unnamed') })}
            </p>
            {confirm?.device.purpose === 'connector' && <p>{t('devices:removeBody')}</p>}
          </>
        )}
      </Sheet>
      <Sheet
        title={t('devices:connectAnother')}
        open={open}
        onClose={close}
        actions={
          <Button variant="primary" autoFocus onClick={close}>
            {t('common:action.done')}
          </Button>
        }
      >
        <p>{t('devices:codeHint')}</p>
        {open && notice?.section === 'codes' && (
          <p role="status" className={styles.notice}>
            {notice.message}
          </p>
        )}
        {busy && <Spinner />}
        {open && error?.section === 'codes' && <Banner status="failed">{error.message}</Banner>}
        {issued &&
          (issued.request.problem ? (
            <Banner status="failed">
              {issued.request.state === 'result'
                ? problemText(issued.request.problem)
                : t('devices:issueUnconfirmed')}
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
                      alt={t('devices:qrAlt')}
                    />
                  ) : (
                    !qrFailed && <Spinner />
                  )}
                </div>
                <div>
                  {qrFailed && <p className={styles.notice}>{t('devices:qrFailed')}</p>}
                  <p className={styles.secret} aria-label={t('devices:codeLabel')}>
                    {issued.code}
                  </p>
                  <p className={styles.link} aria-label={t('devices:linkLabel')}>
                    {link}
                  </p>
                  <p className={styles.notice}>
                    {t('devices:validUntil', { date: date(expires ?? null) })}
                  </p>
                  <div className={styles.actions}>
                    <Button onClick={() => void copy(issued.code!)}>{t('devices:copyCode')}</Button>
                    <Button onClick={() => void copy(link)}>{t('devices:copyLink')}</Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p role="status">{expired ? t('devices:expired') : t('devices:confirmedHidden')}</p>
          ))}
        <Button variant="plain" disabled={busy || lost} onClick={() => void issue()}>
          {t('devices:another')}
        </Button>
      </Sheet>
    </>
  )
}
