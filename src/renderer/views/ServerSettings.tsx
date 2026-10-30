import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection, Me, ProactiveRoute, CharacterCommandItem } from '../../shared/api'
import { Banner, Button, Sheet, TextField } from '../components/Controls'
import { unwrap, problemText, hidesPrivateData } from '../queries/client'
import { PendingRequest, Row, SettingsSection } from './SettingsRow'
import { LogoutFlow } from './LogoutFlow'
import { TailscaleGuide } from './TailscaleGuide'
import styles from './Settings.module.css'

export function ServerSettings({
  connection,
  onConnection,
  onLoggedOut,
  about,
}: {
  connection: Connection
  onConnection(connection: Connection): void
  onLoggedOut(): Promise<void>
  about(): void
}) {
  const id = connection.characterId,
    query = useQueryClient()
  const info = useQuery({
    queryKey: [id, 'server-info', connection.baseUrl],
    queryFn: () => window.yuki.client.serverInfo(id).then(unwrap),
    retry: false,
  })
  const me = useQuery({
    queryKey: [id, 'me'],
    queryFn: () => window.yuki.client.read<Me>(id, { kind: 'me' }).then(unwrap),
    retry: false,
  })
  const route = useQuery({
    queryKey: [id, 'proactive-route'],
    queryFn: () =>
      window.yuki.client.read<ProactiveRoute>(id, { kind: 'proactive-route' }).then(unwrap),
    retry: false,
  })
  const commands = useQuery({
    queryKey: [id, 'character-commands'],
    queryFn: () => window.yuki.client.characterCommands(id).then(unwrap),
  })
  const [address, setAddress] = useState<string>(),
    [addressError, setAddressError] = useState('')
  const [draft, setDraft] = useState<{ binding: string; revision: number }>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const refresh = () =>
    Promise.all(
      ['me', 'proactive-route', 'character-commands'].map((key) =>
        query.invalidateQueries({ queryKey: [id, key] }),
      ),
    )
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (character === id && ['sync', 'refresh', 'character-command'].includes(kind))
          void refresh()
      }),
    [id, query],
  )
  const pending =
    commands.data?.filter(
      (item) => item.command.kind === 'proactive-route' && item.state !== 'result',
    ) ?? []
  useEffect(() => {
    if (
      draft &&
      commands.data?.some(
        (item) =>
          item.state === 'result' &&
          !item.problem &&
          item.command.kind === 'proactive-route' &&
          item.command.bindingId === draft.binding &&
          item.command.expectedRevision === draft.revision,
      )
    )
      setDraft(undefined)
  }, [commands.data, draft])
  const outcome = async (item: CharacterCommandItem) => {
    await refresh()
    if (item.state !== 'result') setError('')
    else if (item.problem) {
      setDraft(undefined)
      setError(
        item.details?.reason === 'route_unavailable'
          ? '這個入口目前沒有可用的接收連線。請選擇其他入口。'
          : item.details?.reason === 'route_ambiguous'
            ? '這個入口有多個接收連線，需要先在伺服器確認目的地。'
            : problemText(item.problem),
      )
    } else {
      setDraft(undefined)
      setNotice('主動訊息目的地已更新。')
    }
  }
  const run = async (requestId: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await outcome(unwrap(await window.yuki.client.verifyCharacterCommand(id, requestId)))
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成。')
    } finally {
      setBusy(false)
    }
  }
  const submitRoute = async (next: { binding: string; revision: number }) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await outcome(
        unwrap(
          await window.yuki.client.characterCommand(id, {
            kind: 'proactive-route',
            expectedRevision: next.revision,
            bindingId: next.binding,
          }),
        ),
      )
    } catch (error) {
      setDraft(undefined)
      setError(error instanceof Error ? error.message : '操作未完成。')
    } finally {
      setBusy(false)
    }
  }
  const lost = hidesPrivateData(me.error) || hidesPrivateData(route.error)
  return (
    <>
      {lost ? (
        <Banner status="failed">{(me.error ?? route.error)?.message}</Banner>
      ) : (
        <>
          <SettingsSection title="伺服器">
            {(info.error || me.error) && (
              <Banner status="failed">{(info.error ?? me.error)?.message}</Banner>
            )}
            <Row title="伺服器位址" description={connection.baseUrl}>
              <Button
                onClick={() => {
                  setAddress(connection.baseUrl)
                  setAddressError('')
                }}
              >
                更改…
              </Button>
            </Row>
            <Row title="狀態">
              <span role="status">
                {info.isFetching || me.isFetching
                  ? '正在確認…'
                  : info.isError || me.isError
                    ? '無法連線'
                    : '已連線'}
              </span>
              {(info.isError || me.isError) && (
                <Button
                  onClick={() => {
                    void info.refetch()
                    void refresh()
                  }}
                >
                  重新檢查
                </Button>
              )}
            </Row>
            <TailscaleGuide onError={setAddressError} />
            {address === undefined && addressError && (
              <Banner status="failed">{addressError}</Banner>
            )}
          </SettingsSection>
          <SettingsSection title="主動訊息">
            {route.isError && <Banner status="failed">{route.error.message}</Banner>}
            {error && <Banner status="failed">{error}</Banner>}
            {notice && (
              <p role="status" className={styles.notice}>
                {notice}
              </p>
            )}
            <Row
              title={`${connection.name} 主動找你時傳到`}
              description={route.data?.paused ? '目前已暫停；選擇可用入口即可恢復。' : undefined}
            >
              {busy && draft && <span role="status">正在更新…</span>}
              <select
                aria-label="主動訊息接收入口"
                disabled={!route.data || !me.data || busy || pending.length > 0}
                value={draft?.binding ?? route.data?.binding_id ?? ''}
                onChange={(event) => {
                  const next = {
                    binding: event.target.value,
                    revision: draft?.revision ?? route.data!.revision,
                  }
                  setDraft(next)
                  setNotice('')
                  void submitRoute(next)
                }}
              >
                <option value="" disabled>
                  選擇入口
                </option>
                {me.data?.bindings
                  .filter((item) => item.status === 'active')
                  .map((item) => (
                    <option key={item.binding_id} value={item.binding_id}>
                      {item.platform.toUpperCase()} · {item.display_name || '本人入口'}
                      {item.binding_id === connection.bindingId ? '（此 App）' : ''}
                    </option>
                  ))}
              </select>
            </Row>
            {pending.map((item) => (
              <PendingRequest
                key={item.requestId}
                text="主動路由變更：結果尚未確認。"
                busy={busy}
                onVerify={() => void run(item.requestId)}
              />
            ))}
          </SettingsSection>
          <SettingsSection title="資料">
            <Row title={`${connection.name} 的名稱、頭像與人格`}>
              <Button onClick={about}>開啟</Button>
            </Row>
          </SettingsSection>
          <details className={styles.section}>
            <summary>技術資訊</summary>
            <Row title="伺服器版本">
              <span>{info.data?.server_version ?? '—'}</span>
            </Row>
            <Row title="API 版本">
              <span>{info.data?.api_revision ?? '—'}</span>
            </Row>
          </details>
          <Sheet
            title="更改伺服器位址"
            open={address !== undefined}
            onClose={() => {
              if (!busy) setAddress(undefined)
            }}
            actions={
              <>
                <Button disabled={busy} onClick={() => setAddress(undefined)}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  disabled={!address?.trim()}
                  loading={busy}
                  onClick={async () => {
                    setBusy(true)
                    setAddressError('')
                    try {
                      const updated = unwrap(await window.yuki.client.changeAddress(id, address!))
                      onConnection(updated)
                      await query.invalidateQueries({ queryKey: [id] })
                      setAddress(undefined)
                    } catch (error) {
                      setAddressError(error instanceof Error ? error.message : '位址尚未變更。')
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  確認並連線
                </Button>
              </>
            }
          >
            <p>
              先確認這是同一個 Yuki 與原本的本人入口，再更新連線位址。待確認內容會以原請求繼續查證。
            </p>
            <TextField
              aria-label="新伺服器位址"
              value={address ?? ''}
              onChange={(event) => setAddress(event.target.value)}
              disabled={busy}
              autoFocus
            />
            {addressError && <Banner status="failed">{addressError}</Banner>}
          </Sheet>
        </>
      )}
      <SettingsSection title="登出" danger>
        <LogoutFlow connection={connection} onConnection={onConnection} onLoggedOut={onLoggedOut} />
      </SettingsSection>
    </>
  )
}
