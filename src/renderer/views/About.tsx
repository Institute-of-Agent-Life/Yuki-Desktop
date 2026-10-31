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

const kinds: Record<string, string> = { fact: '記錄', preference: '偏好', episode: '經歷' }
const states: Record<string, string> = {
  active: '已安排',
  paused: '已暫停',
  completed: '已完成',
  cancelled: '已取消',
  failed: '未完成',
  blocked: '需要處理',
}
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
        setError(
          item.state !== 'result'
            ? '送出結果尚未確認。請查證原請求；內容已保留在這台電腦。'
            : problemText(item.problem!),
        )
      return item
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成。')
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
                aria-label="更換頭像"
                onClick={() => {
                  setAvatarRestore(undefined)
                  setAvatarEditing(true)
                }}
              >
                <Pencil size={14} />
                <span>更換頭像</span>
              </button>
            )}
          </div>
          <div className={styles.introduction}>
            <div className={styles.name}>
              <h1>{profile.display_name}</h1>
              {!editing && administrator && (
                <Button
                  variant="plain"
                  aria-label="編輯名稱與簡介"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} />
                  編輯
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
                <h2 className={styles.sectionTitle}>簡介</h2>
                <p>{profile.bio || '尚未設定簡介。'}</p>
                <p className={styles.description}>
                  名稱、簡介、頭像與提示詞由連接這個 Yuki 的使用者共享。
                </p>
                <div className={styles.heroActions}>
                  {administrator ? (
                    <Button onClick={editSoul}>編輯提示詞</Button>
                  ) : (
                    <p>只有 Yuki 的管理員可以修改</p>
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
          label={`${profile.display_name} 的資料`}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'me', label: '她記得的你' },
            { value: 'self', label: '她自己' },
            { value: 'arrangements', label: '安排' },
            { value: 'capabilities', label: '能力' },
          ]}
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
                {item.command.kind === 'memory'
                  ? '記憶修正'
                  : item.command.kind === 'automation'
                    ? '安排變更'
                    : '資料變更'}
                ：結果尚未確認
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
                          : '原請求仍在處理中。',
                    )
                    await refresh()
                  } catch (error) {
                    setError(error instanceof Error ? error.message : '無法查證原請求。')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                查證原請求
              </Button>
            </div>
          ))}
        <div
          ref={panelMotion}
          role="tabpanel"
          aria-label={
            tab === 'me'
              ? '她記得的你'
              : tab === 'self'
                ? '她自己'
                : tab === 'arrangements'
                  ? '安排'
                  : '能力'
          }
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
        名稱
        <TextField autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        簡介
        <textarea value={bio} onChange={(event) => setBio(event.target.value)} />
      </label>
      <div className={styles.colors}>
        <label>
          淺色外觀
          <input type="color" value={light} onChange={(event) => setLight(event.target.value)} />
        </label>
        <label>
          深色外觀
          <input type="color" value={dark} onChange={(event) => setDark(event.target.value)} />
        </label>
      </div>
      {conflict && (
        <Banner status="waiting">
          資料已在其他地方更新。你的輸入仍保留，儲存仍使用編輯前的版本。
        </Banner>
      )}
      <div className={styles.actions}>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            void refresh()
            close()
          }}
        >
          {conflict ? '放棄並重新讀取' : '取消'}
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          儲存
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
      {about === 'self' && <p className={styles.description}>這是 {name} 對自己的記錄。</p>}
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
              <span className={styles.tag}>{kinds[fact.kind] ?? fact.kind}</span>
              <time dateTime={fact.updated_at}>{date(fact.updated_at)}</time>
              <span>{fact.evidence_count} 則依據</span>
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
                        setSourceError('這則原訊息已刪除或無法讀取。')
                    }}
                  >
                    {source.excerpt || '查看原訊息'}
                  </button>
                ))}
              {!detail.error && detail.data && (
                <small>
                  {detail.data.evidence.length === 0 ? '目前沒有可讀的來源。' : ''}
                  {Math.max(0, fact.evidence_count - detail.data.evidence.length) > 0
                    ? `另有 ${Math.max(0, fact.evidence_count - detail.data.evidence.length)} 則依據未公開。`
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
                    更正
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
                    請她忘記這件事
                  </Button>
                </div>
              )}
            </div>
          )}
        </article>
      ))}
      {!facts.isPending && !facts.error && !rows.length && (
        <EmptyState title="還沒有記憶">這裡會顯示已保存的記錄。</EmptyState>
      )}
      {facts.hasNextPage && (
        <Button loading={facts.isFetchingNextPage} onClick={() => void facts.fetchNextPage()}>
          載入更多記憶
        </Button>
      )}
      <Sheet
        title={edit?.action === 'retract' ? '請她忘記這件事' : '更正記憶'}
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
              {conflict ? '保留現有記憶並關閉' : '取消'}
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
                重新讀取記憶
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
                {edit?.action === 'retract' ? '確認忘記' : '送出更正'}
              </Button>
            )}
          </>
        }
      >
        <p className={styles.original}>{edit?.fact.text}</p>
        {edit?.action === 'correct' ? (
          <label className={styles.editor}>
            新內容
            <textarea
              aria-label="更正後的記憶"
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <small>這會成為 {name} 記憶的修正依據。</small>
          </label>
        ) : (
          <p>確認後，這件事將從目前的記憶中撤回。</p>
        )}
        {conflict && (
          <Banner status="waiting">
            這則記憶已變更{replacement ? '，並被新的記憶取代' : ''}
            。請重新讀取，再選擇要修正的記錄。{edit?.action === 'correct' && <>你的輸入：{text}</>}
          </Banner>
        )}
      </Sheet>
    </>
  )
}

function Arrangements({ id, run, busy }: { id: string; run: Run; busy: boolean }) {
  const { date } = useDisplayTime()
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
        label="安排歸屬"
        value={scope}
        onChange={setScope}
        items={[
          { value: 'mine', label: '你的安排' },
          { value: 'self', label: '她的安排' },
        ]}
      />
      {scope === 'self' && !administrator ? (
        <Banner>只有 Yuki 的管理員可以查看她的安排</Banner>
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
                  {item.next_run_at ? `下次執行 ${date(item.next_run_at)}` : '目前沒有下次執行時間'}
                </small>
              </div>
              <span className={styles.tag}>{states[item.state] ?? item.state}</span>
            </div>
            {scope === 'mine' && !['completed', 'cancelled'].includes(item.state) && (
              <div className={styles.actions}>
                <Button
                  loading={busy}
                  onClick={() => void act(item, item.state === 'active' ? 'pause' : 'resume')}
                >
                  {item.state === 'active' ? '暫停' : '恢復'}
                </Button>
                <Button variant="destructive" disabled={busy} onClick={() => setRemove(item)}>
                  刪除安排
                </Button>
              </div>
            )}
          </article>
        ))}
      {(scope === 'mine' || administrator) &&
        !items.isPending &&
        !items.error &&
        !items.data?.items.length && (
          <EmptyState title="還沒有安排">在對話中告訴她想安排的事情。</EmptyState>
        )}
      <Sheet
        title="刪除安排"
        open={!!remove}
        onClose={() => {
          if (!busy) setRemove(undefined)
        }}
        actions={
          <>
            <Button disabled={busy} onClick={() => setRemove(undefined)}>
              保留
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
              刪除安排
            </Button>
          </>
        }
      >
        <p>刪除「{remove?.title}」後，不會再按這個安排執行。已發生的紀錄會保留。</p>
      </Sheet>
    </>
  )
}

function CapabilityList({ id }: { id: string }) {
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
            重試
          </Button>
        </Banner>
      )}
      {!hidesPrivateData(capability.error) && capability.data && (
        <>
          <h2 className={styles.sectionTitle}>已啟用的擴充</h2>
          {capability.data.plugins.map((plugin) => (
            <article className={styles.row} key={plugin.id}>
              <h3>{plugin.name}</h3>
              <p>{plugin.description}</p>
            </article>
          ))}
          {!capability.data.plugins.length && (
            <p className={styles.description}>目前沒有已啟用的擴充。</p>
          )}
          <h2 className={styles.sectionTitle}>執行環境</h2>
          <p>{capability.data.environment.desktop ? '提供遠端電腦' : '環境尚未提供電腦資訊'}</p>
          <div className={styles.tools}>
            {capability.data.environment.tools.map((tool) => (
              <span className={styles.tag} key={tool.name}>
                {tool.name} · {tool.version}
              </span>
            ))}
          </div>
          {!capability.data.environment.tools.length && (
            <p className={styles.description}>目前沒有環境工具清單。</p>
          )}
        </>
      )}
    </>
  )
}
