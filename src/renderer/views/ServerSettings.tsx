import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection, Me, ProactiveRoute, CharacterCommandItem } from '../../shared/api'
import { Banner, Button } from '../components/Controls'
import { unwrap, problemText, hidesPrivateData } from '../queries/client'
import { useTranslation } from '../i18n'
import { PendingRequest, Row, SettingsSection } from './SettingsRow'
import { LogoutFlow } from './LogoutFlow'
import { ServerManagement, TransportSettings } from './TransportSettings'
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
  const { t } = useTranslation(['connection', 'errors', 'common'])
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
          ? t('connection:routeUnavailable')
          : item.details?.reason === 'route_ambiguous'
            ? t('connection:routeAmbiguous')
            : problemText(item.problem),
      )
    } else {
      setDraft(undefined)
      setNotice(t('connection:routeUpdated'))
    }
  }
  const run = async (requestId: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await outcome(unwrap(await window.yuki.client.verifyCharacterCommand(id, requestId)))
    } catch (error) {
      setError(error instanceof Error ? error.message : t('errors:notCompleted'))
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
      setError(error instanceof Error ? error.message : t('errors:notCompleted'))
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
          <SettingsSection title={t('connection:server')}>
            {(info.error || me.error) && (
              <Banner status="failed">{(info.error ?? me.error)?.message}</Banner>
            )}
            <TransportSettings connection={connection} onConnection={onConnection} />
            <Row title={t('connection:status')}>
              <span role="status">
                {info.isFetching || me.isFetching
                  ? t('connection:checking')
                  : info.isError || me.isError
                    ? t('connection:unreachable')
                    : t('connection:connected')}
              </span>
              {(info.isError || me.isError) && (
                <Button
                  onClick={() => {
                    void info.refetch()
                    void refresh()
                  }}
                >
                  {t('connection:recheck')}
                </Button>
              )}
            </Row>
            {connection.transport?.kind === 'ssh' && <ServerManagement connection={connection} />}
          </SettingsSection>
          <SettingsSection title={t('connection:proactive')}>
            {route.isError && <Banner status="failed">{route.error.message}</Banner>}
            {error && <Banner status="failed">{error}</Banner>}
            {notice && (
              <p role="status" className={styles.notice}>
                {notice}
              </p>
            )}
            <Row
              title={t('connection:proactiveTo', { name: connection.name })}
              description={route.data?.paused ? t('connection:paused') : undefined}
            >
              {busy && draft && <span role="status">{t('connection:updating')}</span>}
              <select
                aria-label={t('connection:entryLabel')}
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
                  {t('connection:chooseEntry')}
                </option>
                {me.data?.bindings
                  .filter((item) => item.status === 'active')
                  .map((item) => (
                    <option key={item.binding_id} value={item.binding_id}>
                      {t(
                        item.binding_id === connection.bindingId
                          ? 'connection:entryThisApp'
                          : 'connection:entry',
                        {
                          platform: item.platform.toUpperCase(),
                          name: item.display_name || t('connection:ownEntry'),
                        },
                      )}
                    </option>
                  ))}
              </select>
            </Row>
            {pending.map((item) => (
              <PendingRequest
                key={item.requestId}
                text={t('connection:routePending')}
                busy={busy}
                onVerify={() => void run(item.requestId)}
              />
            ))}
          </SettingsSection>
          <SettingsSection title={t('connection:data')}>
            <Row title={t('connection:about', { name: connection.name })}>
              <Button onClick={about}>{t('common:action.open')}</Button>
            </Row>
          </SettingsSection>
          <details className={styles.section}>
            <summary>{t('connection:technical')}</summary>
            <Row title={t('connection:serverVersion')}>
              <span>{info.data?.server_version ?? '—'}</span>
            </Row>
            <Row title={t('connection:apiVersion')}>
              <span>{info.data?.api_revision ?? '—'}</span>
            </Row>
          </details>
        </>
      )}
      <SettingsSection title={t('connection:logout.title')} danger>
        <LogoutFlow connection={connection} onConnection={onConnection} onLoggedOut={onLoggedOut} />
      </SettingsSection>
    </>
  )
}
