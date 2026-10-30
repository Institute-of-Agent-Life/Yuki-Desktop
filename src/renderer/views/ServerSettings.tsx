import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection, Me, ProactiveRoute, CharacterCommandItem } from '../../shared/api'
import { Banner, Button, Sheet, TextField } from '../components/Controls'
import { unwrap, problemText, hidesPrivateData } from '../queries/client'
import { Row } from './SettingsRow'
import styles from './Settings.module.css'

export function ServerSettings({
  connection,
  onConnection,
  about,
}: {
  connection: Connection
  onConnection(connection: Connection): void
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
    else if (item.problem)
      setError(
        item.details?.reason === 'route_unavailable'
          ? '這個入口目前沒有可用的接收連線。請選擇其他入口。'
          : item.details?.reason === 'route_ambiguous'
            ? '這個入口有多個接收連線，需要先在伺服器確認目的地。'
            : problemText(item.problem),
      )
    else {
      setDraft(undefined)
      setNotice('主動訊息目的地已更新。')
    }
  }
  const run = async (requestId?: string) => {
    if (!requestId && !draft) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await outcome(
        unwrap(
          requestId
            ? await window.yuki.client.verifyCharacterCommand(id, requestId)
            : await window.yuki.client.characterCommand(id, {
                kind: 'proactive-route',
                expectedRevision: draft!.revision,
                bindingId: draft!.binding,
              }),
        ),
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成。')
    } finally {
      setBusy(false)
    }
  }
  const reloadRoute = async () => {
    setBusy(true)
    setDraft(undefined)
    setError('')
    try {
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  if (hidesPrivateData(me.error) || hidesPrivateData(route.error))
    return <Banner status="failed">{(me.error ?? route.error)?.message}</Banner>
  return (
    <>
      <div className={styles.group}>
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
        <Row title="伺服器版本">
          <span>{info.data?.server_version ?? '—'}</span>
        </Row>
        <Row title="API 版本">
          <span>{info.data?.api_revision ?? '—'}</span>
        </Row>
        <Row title="連線狀態">
          <span role="status">
            {info.isFetching || me.isFetching
              ? '正在確認…'
              : info.isError || me.isError
                ? '無法確認連線'
                : '已連線'}
          </span>
          <Button
            onClick={() => {
              void info.refetch()
              void refresh()
            }}
          >
            重新讀取
          </Button>
        </Row>
      </div>
      {(info.error || me.error) && (
        <Banner status="failed">{(info.error ?? me.error)?.message}</Banner>
      )}
      <h3>主動訊息送到哪裡</h3>
      <p className={styles.notice}>選擇 Yuki 主動找你時使用的入口。</p>
      {route.isError && <Banner status="failed">{route.error.message}</Banner>}
      {error && <Banner status="failed">{error}</Banner>}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}
      <div className={styles.group}>
        <Row
          title="目前目的地"
          description={route.data?.paused ? '目前已暫停；選擇可用入口並儲存可恢復。' : undefined}
        >
          <span>
            {route.data?.binding_id
              ? me.data?.bindings.find((item) => item.binding_id === route.data?.binding_id)
                  ?.display_name ||
                route.data.platform?.toUpperCase() ||
                '原入口'
              : route.data
                ? '尚未設定'
                : route.isPending
                  ? '讀取中…'
                  : '無法確認'}
          </span>
        </Row>
        <Row title="接收入口">
          <select
            aria-label="主動訊息接收入口"
            disabled={!route.data || !me.data || busy || pending.length > 0}
            value={draft?.binding ?? route.data?.binding_id ?? ''}
            onChange={(event) => {
              setDraft((previous) => ({
                binding: event.target.value,
                revision: previous?.revision ?? route.data!.revision,
              }))
              setNotice('')
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
      </div>
      <div className={styles.actions}>
        <Button disabled={!draft || pending.length > 0} loading={busy} onClick={() => void run()}>
          儲存目的地
        </Button>
        <Button disabled={busy || pending.length > 0} onClick={() => void reloadRoute()}>
          重新讀取目的地
        </Button>
      </div>
      {pending.map((item) => (
        <div key={item.requestId} className={styles.actions}>
          <p className={styles.notice}>主動路由變更：結果尚未確認。</p>
          <Button loading={busy} onClick={() => void run(item.requestId)}>
            查證原請求
          </Button>
        </div>
      ))}
      <h3>資料</h3>
      <p className={styles.notice}>名稱、頭像與人格會隨這個 Yuki 保留。</p>
      <Button onClick={about}>開啟資料</Button>
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
  )
}
