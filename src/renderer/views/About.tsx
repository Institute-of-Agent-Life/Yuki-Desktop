import { useTabMotion } from '../motion/tab'
import { usePress } from '../motion/hooks'
import { useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Pencil, RefreshCw } from 'lucide-react'
import type {
  Automation,
  AutomationPage,
  Capabilities,
  CharacterCommand,
  CharacterCommandItem,
  MemoryDetail,
  MemoryFact,
  MemoryPage,
  Profile,
  AvatarCommandItem,
} from '../../shared/api'
import type { MessageReference } from '../../shared/message'
import {
  Banner,
  Button,
  EmptyState,
  Segmented,
  Sheet,
  Spinner,
  TextField,
} from '../components/Controls'
import { hidesPrivateData, problemText, unwrap, useMe } from '../queries/client'
import styles from './About.module.css'
import { CharacterAvatar } from '../components/CharacterAvatar'
import { AvatarEditor, AvatarPending } from './AvatarEditor'
import { AvatarStatus } from './AvatarStatus'
import { useDisplayTime } from '../state/time'
import { useTranslation } from '../i18n'

const kinds = ['fact', 'preference', 'episode'] as const
const states = ['active', 'paused', 'completed', 'cancelled', 'failed', 'blocked'] as const
const known = <K extends string>(keys: readonly K[], value: string): value is K =>
  (keys as readonly string[]).includes(value)
const read = <T,>(id: string, route: Parameters<typeof window.yuki.client.read>[1]) =>
  window.yuki.client.read<T>(id, route).then(unwrap)

export function About({
  id,
  server,
  profile,
  jump,
  editSoul,
}: {
  id: string
  server: string
  profile: Profile
  jump: (source: MessageReference) => Promise<boolean>
  editSoul(): void
}) {
  const { t } = useTranslation(['about', 'common', 'errors'])
  const query = useQueryClient()
  const me = useMe(id)
  const administrator = me.data?.is_superuser === true && !hidesPrivateData(me.error)
  const info = useQuery({
    queryKey: [id, 'server-info', server],
    queryFn: () => window.yuki.client.serverInfo(id).then(unwrap),
  })
  const avatarSupported =
    info.status === 'success' && info.data.capabilities.includes('character_avatar')
  const [tab, setTab] = useState<'me' | 'self' | 'arrangements' | 'capabilities'>('me')
  const panelMotion = useTabMotion<HTMLDivElement>(tab, [
    'me',
    'self',
    'arrangements',
    'capabilities',
  ])
  const [editing, setEditing] = useState(false)
  const avatarPress = usePress<HTMLButtonElement>()
  const [avatarEditing, setAvatarEditing] = useState(false)
  const [avatarRestore, setAvatarRestore] = useState<AvatarCommandItem>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const commands = useQuery({
    queryKey: [id, 'character-commands'],
    queryFn: () => window.yuki.client.characterCommands(id).then(unwrap),
  })
  const refresh = async () => {
    await Promise.all(
      ['character', 'memory', 'automations', 'capabilities', 'character-commands', 'events'].map(
        (key) => query.invalidateQueries({ queryKey: [id, key] }),
      ),
    )
  }
  const run = async (command: CharacterCommand) => {
    setBusy(true)
    setError('')
    try {
      const item = unwrap(await window.yuki.client.characterCommand(id, command))
      await refresh()
      if (item.problem || item.state !== 'result')
        setError(item.state !== 'result' ? t('about:unconfirmed') : problemText(item.problem!))
      return item
    } catch (error) {
      setError(error instanceof Error ? error.message : t('errors:notCompleted'))
      return undefined
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.about}>
      <div className={styles.inner}>
        <header className={styles.hero}>
          <div className={styles.portrait}>
            <CharacterAvatar size={200} />
            {avatarSupported && administrator && (
              <button
                ref={avatarPress}
                data-press="icon"
                className={styles.avatarEdit}
                aria-label={t('about:changeAvatar')}
                onClick={() => {
                  setAvatarRestore(undefined)
                  setAvatarEditing(true)
                }}
              >
                <Pencil size={14} />
                <span>{t('about:changeAvatar')}</span>
              </button>
            )}
          </div>
          <div className={styles.introduction}>
            <div className={styles.name}>
              <h1>{profile.display_name}</h1>
              {!editing && administrator && (
                <Button
                  variant="plain"
                  aria-label={t('about:editProfile')}
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} />
                  {t('about:edit')}
                </Button>
              )}
            </div>
            {editing && administrator ? (
              <ProfileEditor
                key={profile.id}
                profile={profile}
                busy={busy}
                save={run}
                close={() => setEditing(false)}
                refresh={refresh}
              />
            ) : (
              <>
                <h2 className={styles.sectionTitle}>{t('about:bio')}</h2>
                <p>{profile.bio || t('about:noBio')}</p>
                <p className={styles.description}>{t('about:shared')}</p>
                <div className={styles.heroActions}>
                  {administrator ? (
                    <Button onClick={editSoul}>{t('about:editPrompt')}</Button>
                  ) : (
                    <p>{t('about:adminOnly')}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </header>
        <AvatarStatus
          profile={profile}
          status={info.status}
          supported={avatarSupported}
          editable={administrator}
          edit={() => {
            setAvatarRestore(undefined)
            setAvatarEditing(true)
          }}
          retry={() => void info.refetch()}
        />
        {administrator && (
          <AvatarPending
            id={id}
            open={(item) => {
              setAvatarRestore(item)
              setAvatarEditing(true)
            }}
          />
        )}
        {avatarEditing && avatarSupported && administrator && (
          <AvatarEditor
            id={id}
            profile={profile}
            restore={avatarRestore}
            close={() => setAvatarEditing(false)}
          />
        )}
        <Segmented
          label={t('about:profileOf', { name: profile.display_name })}
          value={tab}
          onChange={setTab}
          items={(['me', 'self', 'arrangements', 'capabilities'] as const).map((value) => ({
            value,
            label: t(`about:tab.${value}`),
          }))}
        />
        {error && <Banner status="failed">{error}</Banner>}
        {commands.data
          ?.filter(
            (item) =>
              item.state !== 'result' &&
              ['profile', 'memory', 'automation'].includes(item.command.kind),
          )
          .map((item) => (
            <div key={item.requestId} className={styles.pending} role="status">
              <span>
                {t(
                  item.command.kind === 'memory'
                    ? 'about:pending.memory'
                    : item.command.kind === 'automation'
                      ? 'about:pending.automation'
                      : 'about:pending.profile',
                )}
              </span>
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const result = unwrap(
                      await window.yuki.client.verifyCharacterCommand(id, item.requestId),
                    )
                    setError(
                      result.problem
                        ? problemText(result.problem)
                        : result.state === 'result'
                          ? ''
                          : t('about:stillProcessing'),
                    )
                    await refresh()
                  } catch (error) {
                    setError(error instanceof Error ? error.message : t('about:verifyFailed'))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {t('about:verify')}
              </Button>
            </div>
          ))}
        <div
          ref={panelMotion}
          role="tabpanel"
          aria-label={t(`about:tab.${tab}`)}
          className={styles.panel}
        >
          {tab === 'me' || tab === 'self' ? (
            <Memories
              name={profile.display_name}
              key={tab}
              id={id}
              about={tab}
              run={run}
              busy={busy}
              jump={jump}
            />
          ) : tab === 'arrangements' ? (
            <Arrangements id={id} run={run} busy={busy} />
          ) : (
            <CapabilityList id={id} />
          )}
        </div>
      </div>
    </div>
  )
}

type Run = (command: CharacterCommand) => Promise<CharacterCommandItem | undefined>
function ProfileEditor({
  profile,
  busy,
  save,
  close,
  refresh,
}: {
  profile: Profile
  busy: boolean
  save: Run
  close: () => void
  refresh: () => Promise<void>
}) {
  // Capture the document shown when editing began. A remote refresh cannot change this CAS baseline.
  const [base] = useState(profile)
  const [name, setName] = useState(base.display_name)
  const [bio, setBio] = useState(base.bio)
  const [light, setLight] = useState(base.accent.light)
  const [dark, setDark] = useState(base.accent.dark)
  const [conflict, setConflict] = useState(false)
  const { t } = useTranslation(['about', 'common'])
  return (
    <form
      className={styles.editor}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.stopPropagation()
          close()
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault()
        const result = await save({
          kind: 'profile',
          expectedRevision: base.revision,
          displayName: name,
          bio,
          accent: { light, dark },
        })
        if (result?.state === 'result' && !result.problem) close()
        else setConflict(result?.problem === 'version_conflict')
      }}
    >
      <label>
        {t('about:name')}
        <TextField autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        {t('about:bio')}
        <textarea value={bio} onChange={(event) => setBio(event.target.value)} />
      </label>
      <div className={styles.colors}>
        <label>
          {t('about:lightAccent')}
          <input type="color" value={light} onChange={(event) => setLight(event.target.value)} />
        </label>
        <label>
          {t('about:darkAccent')}
          <input type="color" value={dark} onChange={(event) => setDark(event.target.value)} />
        </label>
      </div>
      {conflict && <Banner status="waiting">{t('about:profileConflict')}</Banner>}
      <div className={styles.actions}>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            void refresh()
            close()
          }}
        >
          {conflict ? t('about:discardAndReload') : t('common:action.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {t('common:action.save')}
        </Button>
      </div>
    </form>
  )
}

function Memories({
  name,
  id,
  about,
  run,
  busy,
  jump,
}: {
  name: string
  id: string
  about: 'me' | 'self'
  run: Run
  busy: boolean
  jump: (source: MessageReference) => Promise<boolean>
}) {
  const { date } = useDisplayTime()
  const { t } = useTranslation(['about', 'common'])
  const query = useQueryClient()
  const facts = useInfiniteQuery({
    queryKey: [id, 'memory', about],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => read<MemoryPage>(id, { kind: 'memory', about, cursor: pageParam }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const [expanded, setExpanded] = useState<number>()
  const [edit, setEdit] = useState<{ fact: MemoryFact; action: 'correct' | 'retract' }>()
  const [text, setText] = useState('')
  const [conflict, setConflict] = useState(false)
  const [replacement, setReplacement] = useState<number>()
  const [sourceError, setSourceError] = useState('')
  const detail = useQuery({
    queryKey: [id, 'memory', 'fact', expanded],
    queryFn: () => read<MemoryDetail>(id, { kind: 'memory-fact', factId: expanded! }),
    enabled: expanded !== undefined,
  })
  const rows = hidesPrivateData(facts.error)
    ? []
    : [
        ...new Map(
          facts.data?.pages.flatMap((page) => page.items).map((fact) => [fact.fact_id, fact]) ?? [],
        ).values(),
      ]
  return (
    <>
      {about === 'self' && <p className={styles.description}>{t('about:selfRecord', { name })}</p>}
      {facts.isPending && <Spinner />}
      {facts.error && <Banner status="failed">{facts.error.message}</Banner>}
      {sourceError && <Banner status="failed">{sourceError}</Banner>}
      {rows.map((fact) => (
        <article className={styles.row} key={fact.fact_id}>
          <button
            className={styles.fact}
            aria-expanded={expanded === fact.fact_id}
            onClick={() => {
              setExpanded(expanded === fact.fact_id ? undefined : fact.fact_id)
              setSourceError('')
            }}
          >
            <span className={styles.factContent}>{fact.text}</span>
            <span className={styles.meta}>
              <span className={styles.tag}>
                {known(kinds, fact.kind) ? t(`about:kind.${fact.kind}`) : fact.kind}
              </span>
              <time dateTime={fact.updated_at}>{date(fact.updated_at)}</time>
              <span>{t('about:evidence', { count: fact.evidence_count })}</span>
              {expanded === fact.fact_id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          </button>
          {expanded === fact.fact_id && (
            <div className={styles.evidence}>
              {detail.isPending && <Spinner />}
              {detail.error && <Banner status="failed">{detail.error.message}</Banner>}
              {!hidesPrivateData(detail.error) &&
                detail.data?.evidence.map((source) => (
                  <button
                    className={styles.source}
                    key={`${source.conversation_id}/${source.event_id}`}
                    onClick={async () => {
                      if (
                        !(await jump({
                          conversationId: source.conversation_id,
                          eventId: source.event_id,
                        }))
                      )
                        setSourceError(t('about:sourceUnavailable'))
                    }}
                  >
                    {source.excerpt || t('about:viewSource')}
                  </button>
                ))}
              {!detail.error && detail.data && (
                <small>
                  {detail.data.evidence.length === 0 ? t('about:noSources') : ''}
                  {fact.evidence_count > detail.data.evidence.length
                    ? t('about:hiddenEvidence', {
                        count: fact.evidence_count - detail.data.evidence.length,
                      })
                    : ''}
                </small>
              )}
              {fact.writable && (
                <div className={styles.actions}>
                  <Button
                    variant="plain"
                    disabled={busy}
                    onClick={() => {
                      setEdit({ fact, action: 'correct' })
                      setText(fact.text)
                      setConflict(false)
                      setReplacement(undefined)
                    }}
                  >
                    {t('about:correct')}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      setEdit({ fact, action: 'retract' })
                      setConflict(false)
                      setReplacement(undefined)
                    }}
                  >
                    {t('about:forget')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </article>
      ))}
      {!facts.isPending && !facts.error && !rows.length && (
        <EmptyState title={t('about:noMemories')}>{t('about:noMemoriesDescription')}</EmptyState>
      )}
      {facts.hasNextPage && (
        <Button loading={facts.isFetchingNextPage} onClick={() => void facts.fetchNextPage()}>
          {t('about:moreMemories')}
        </Button>
      )}
      <Sheet
        title={edit?.action === 'retract' ? t('about:forget') : t('about:correctMemory')}
        open={!!edit}
        onClose={() => {
          if (!busy) setEdit(undefined)
        }}
        actions={
          <>
            <Button
              disabled={busy}
              onClick={() => {
                setEdit(undefined)
                void query.invalidateQueries({ queryKey: [id, 'memory'] })
              }}
            >
              {conflict ? t('about:keepAndClose') : t('common:action.cancel')}
            </Button>
            {conflict ? (
              <Button
                variant="primary"
                onClick={() => {
                  setExpanded(replacement ?? edit?.fact.fact_id)
                  setEdit(undefined)
                  void query.invalidateQueries({ queryKey: [id, 'memory'] })
                }}
              >
                {t('about:reloadMemories')}
              </Button>
            ) : (
              <Button
                variant={edit?.action === 'retract' ? 'destructive' : 'primary'}
                loading={busy}
                disabled={edit?.action === 'correct' && !text.trim()}
                onClick={async () => {
                  if (!edit) return
                  const result = await run({
                    kind: 'memory',
                    factId: edit.fact.fact_id,
                    expectedRevision: edit.fact.revision,
                    action: edit.action,
                    ...(edit.action === 'correct' ? { text } : {}),
                  })
                  if (result?.state === 'result' && !result.problem) {
                    setExpanded(undefined)
                    setEdit(undefined)
                  } else if (result?.problem === 'version_conflict') {
                    setConflict(true)
                    const replacement = result.details?.replacement_fact_id
                    setReplacement(typeof replacement === 'number' ? replacement : undefined)
                  }
                }}
              >
                {edit?.action === 'retract'
                  ? t('about:confirmForget')
                  : t('about:submitCorrection')}
              </Button>
            )}
          </>
        }
      >
        <p className={styles.original}>{edit?.fact.text}</p>
        {edit?.action === 'correct' ? (
          <label className={styles.editor}>
            {t('about:newContent')}
            <textarea
              aria-label={t('about:correctedMemory')}
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <small>{t('about:correctionNote', { name })}</small>
          </label>
        ) : (
          <p>{t('about:forgetNote')}</p>
        )}
        {conflict && (
          <Banner status="waiting">
            {t(replacement ? 'about:memoryReplaced' : 'about:memoryChanged')}
            {edit?.action === 'correct' && t('about:yourInput', { text })}
          </Banner>
        )}
      </Sheet>
    </>
  )
}

function Arrangements({ id, run, busy }: { id: string; run: Run; busy: boolean }) {
  const { date } = useDisplayTime()
  const { t } = useTranslation(['about', 'common'])
  const me = useMe(id)
  const administrator = me.data?.is_superuser === true && !hidesPrivateData(me.error)
  const [scope, setScope] = useState<'mine' | 'self'>('mine')
  const [remove, setRemove] = useState<Automation>()
  const items = useQuery({
    queryKey: [id, 'automations', scope],
    queryFn: () => read<AutomationPage>(id, { kind: 'automations', scope }),
    enabled: scope === 'mine' || administrator,
  })
  const act = (item: Automation, action: 'pause' | 'resume' | 'delete') =>
    run({
      kind: 'automation',
      automationId: item.automation_id,
      expectedRevision: item.revision,
      action,
    })
  return (
    <>
      <Segmented
        label={t('about:scope')}
        value={scope}
        onChange={setScope}
        items={[
          { value: 'mine', label: t('about:yours') },
          { value: 'self', label: t('about:hers') },
        ]}
      />
      {scope === 'self' && !administrator ? (
        <Banner>{t('about:adminOnlyArrangements')}</Banner>
      ) : items.isPending ? (
        <Spinner />
      ) : null}
      {(scope === 'mine' || administrator) && items.error && (
        <Banner status="failed">{items.error.message}</Banner>
      )}
      {(scope === 'mine' || administrator) &&
        !hidesPrivateData(items.error) &&
        items.data?.items.map((item) => (
          <article key={item.automation_id} className={styles.row}>
            <div className={styles.arrangement}>
              <div>
                <h2>{item.title}</h2>
                <p>{item.schedule_text}</p>
                <small>
                  {item.next_run_at
                    ? t('about:nextRun', { time: date(item.next_run_at) })
                    : t('about:noNextRun')}
                </small>
              </div>
              <span className={styles.tag}>
                {known(states, item.state) ? t(`about:state.${item.state}`) : item.state}
              </span>
            </div>
            {scope === 'mine' && !['completed', 'cancelled'].includes(item.state) && (
              <div className={styles.actions}>
                <Button
                  loading={busy}
                  onClick={() => void act(item, item.state === 'active' ? 'pause' : 'resume')}
                >
                  {item.state === 'active' ? t('about:pause') : t('about:resume')}
                </Button>
                <Button variant="destructive" disabled={busy} onClick={() => setRemove(item)}>
                  {t('about:deleteArrangement')}
                </Button>
              </div>
            )}
          </article>
        ))}
      {(scope === 'mine' || administrator) &&
        !items.isPending &&
        !items.error &&
        !items.data?.items.length && (
          <EmptyState title={t('about:noArrangements')}>
            {t('about:noArrangementsDescription')}
          </EmptyState>
        )}
      <Sheet
        title={t('about:deleteArrangement')}
        open={!!remove}
        onClose={() => {
          if (!busy) setRemove(undefined)
        }}
        actions={
          <>
            <Button disabled={busy} onClick={() => setRemove(undefined)}>
              {t('about:keep')}
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={async () => {
                if (remove) {
                  await act(remove, 'delete')
                  setRemove(undefined)
                }
              }}
            >
              {t('about:deleteArrangement')}
            </Button>
          </>
        }
      >
        <p>{t('about:deleteArrangementNote', { title: remove?.title ?? '' })}</p>
      </Sheet>
    </>
  )
}

function CapabilityList({ id }: { id: string }) {
  const { t } = useTranslation(['about', 'common'])
  const capability = useQuery({
    queryKey: [id, 'capabilities'],
    queryFn: () => read<Capabilities>(id, { kind: 'capabilities' }),
  })
  return (
    <>
      {capability.isPending && <Spinner />}
      {capability.error && (
        <Banner status="failed">
          {capability.error.message}
          <Button variant="plain" onClick={() => void capability.refetch()}>
            <RefreshCw size={14} />
            {t('common:action.retry')}
          </Button>
        </Banner>
      )}
      {!hidesPrivateData(capability.error) && capability.data && (
        <>
          <h2 className={styles.sectionTitle}>{t('about:extensions')}</h2>
          {capability.data.plugins.map((plugin) => (
            <article className={styles.row} key={plugin.id}>
              <h3>{plugin.name}</h3>
              <p>{plugin.description}</p>
            </article>
          ))}
          {!capability.data.plugins.length && (
            <p className={styles.description}>{t('about:noExtensions')}</p>
          )}
          <h2 className={styles.sectionTitle}>{t('about:environment')}</h2>
          <p>
            {capability.data.environment.desktop
              ? t('about:remoteComputer')
              : t('about:noComputerInfo')}
          </p>
          <div className={styles.tools}>
            {capability.data.environment.tools.map((tool) => (
              <span className={styles.tag} key={tool.name}>
                {tool.name} · {tool.version}
              </span>
            ))}
          </div>
          {!capability.data.environment.tools.length && (
            <p className={styles.description}>{t('about:noTools')}</p>
          )}
        </>
      )}
    </>
  )
}
