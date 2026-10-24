import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection, Me } from '../../shared/api'
import { Banner, Button, Sheet, TextField } from '../components/Controls'
import { unwrap, hidesPrivateData } from '../queries/client'
import { Row } from './Settings'
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
  const [address, setAddress] = useState<string>(),
    [addressError, setAddressError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = () => query.invalidateQueries({ queryKey: [id, 'me'] })
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (character === id && kind === 'sync') void refresh()
      }),
    [id, query],
  )
  if (hidesPrivateData(me.error)) return <Banner status="failed">{me.error?.message}</Banner>
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
      <h3>角色資料</h3>
      <p className={styles.notice}>名稱、頭像與提示詞會隨角色保留。</p>
      <Button onClick={about}>開啟角色資料</Button>
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
        <p>先確認這是同一個角色與原本的本人入口，再更新連線位址。待確認內容會以原請求繼續查證。</p>
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
