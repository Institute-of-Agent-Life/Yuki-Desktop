import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import MarkdownIt from 'markdown-it'
import type {
  Connection,
  EventsPage,
  Home,
  OutboxItem,
  Profile,
  PublicEvent,
  AttachmentSource,
} from '../../shared/api'
import type { Preferences } from '../../shared/desktop'
import { Composer } from '../components/Composer'
import { Avatar, Banner, Button, EmptyState } from '../components/Controls'
import { Workspace } from '../components/Workspace'
import { unwrap, problemText, hidesPrivateData, ClientProblem } from '../queries/client'
import { useWorkspace } from '../state/workspace'
import { useCommands } from '../state/commands'
import styles from './Conversation.module.css'
import { parseMessage, referencedMessage, type MessageReference } from '../../shared/message'
import { AttachmentPreview, DraftAttachments, MessageAttachment } from './Media'
import { VoiceRecorder } from './VoiceRecorder'
import mediaStyles from './Media.module.css'

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: false })
markdown.disable(['image', 'html_block', 'html_inline'])
const read = <T,>(id: string, route: Parameters<typeof window.yuki.client.read>[1]) =>
  window.yuki.client.read<T>(id, route).then(unwrap)

export function Conversation({
  connection,
  platform,
  preferences,
  save,
  onSettings,
  onPairAgain,
}: {
  connection: Connection
  platform: string
  preferences: Preferences
  save(patch: Partial<Preferences>): void
  onSettings(): void
  onPairAgain(): void
}) {
  const id = connection.characterId,
    query = useQueryClient(),
    view = useWorkspace((state) => state.view)
  const [conversation, setConversation] = useState(connection.conversationId),
    [draft, setDraft] = useState('')
  const currentDraft = useRef(draft)
  const [preview, setPreview] = useState<AttachmentSource>(),
    [dragging, setDragging] = useState(false),
    [mediaError, setMediaError] = useState(''),
    [recording, setRecording] = useState(false)
  const finishRecording = useRef<(() => void) | undefined>(undefined)
  const [online, setOnline] = useState<'connecting' | 'online' | 'offline'>('connecting'),
    [connectionProblem, setConnectionProblem] = useState('')
  const [references, setReferences] = useState<MessageReference[]>([]),
    [selection, setSelection] = useState<number>()
  const currentReferences = useRef<MessageReference[]>([])
  const [search, setSearch] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null),
    floor = useRef<number | null>(null),
    bottom = useRef(true),
    [newMessages, setNewMessages] = useState(false)
  const home = useQuery({ queryKey: [id, 'home'], queryFn: () => read<Home>(id, { kind: 'home' }) })
  const profile = useQuery({
    queryKey: [id, 'character'],
    queryFn: () => read<Profile>(id, { kind: 'character' }),
  })
  const outbox = useQuery({
    queryKey: [id, 'outbox'],
    queryFn: () => window.yuki.client.outbox(id).then(unwrap),
  })
  const uploads = useQuery({
    queryKey: [id, 'uploads'],
    queryFn: () => window.yuki.client.uploads(id).then(unwrap),
  })
  const events = useQuery({
    queryKey: [id, 'events', conversation],
    queryFn: async () => {
      const first = await read<EventsPage>(id, {
        kind: 'events',
        conversationId: conversation,
        before: Number.MAX_SAFE_INTEGER,
      })
      let current = first,
        items = first.items
      // Re-read the loaded range from authoritative pages, including deletions and edits.
      while (
        floor.current !== null &&
        current.has_more &&
        current.next_before !== null &&
        Math.min(...items.map((item) => item.event_id)) > floor.current
      ) {
        current = await read<EventsPage>(id, {
          kind: 'events',
          conversationId: conversation,
          before: current.next_before,
        })
        items = [...current.items, ...items]
      }
      return {
        ...first,
        has_more: current.has_more,
        next_before: current.next_before,
        items: [...new Map(items.map((item) => [item.event_id, item])).values()].sort(
          (a, b) => a.event_id - b.event_id,
        ),
      }
    },
  })
  const accessLost = hidesPrivateData(new ClientProblem(connectionProblem))
  const eventData = accessLost || hidesPrivateData(events.error) ? undefined : events.data,
    homeData = accessLost || hidesPrivateData(home.error) ? undefined : home.data,
    profileData = accessLost || hidesPrivateData(profile.error) ? undefined : profile.data
  const refresh = useCallback(() => {
    void query.invalidateQueries({ queryKey: [id, 'home'] })
    void query.invalidateQueries({ queryKey: [id, 'character'] })
    void query.invalidateQueries({ queryKey: [id, 'events'] })
    void query.invalidateQueries({ queryKey: [id, 'reference'] })
    void query.invalidateQueries({ queryKey: [id, 'outbox'] })
    void query.invalidateQueries({ queryKey: [id, 'uploads'] })
    void query.invalidateQueries({ queryKey: [id, 'content'] })
  }, [id, query])
  useEffect(() => {
    const deadlines = (eventData?.items ?? [])
      .flatMap((event) =>
        event.attachments.map((item) => (item.expires_at ? Date.parse(item.expires_at) : NaN)),
      )
      .filter((time) => time > Date.now())
    if (!deadlines.length) return
    const timer = setTimeout(
      refresh,
      Math.min(Math.max(1, Math.min(...deadlines) - Date.now()), 2147483647),
    )
    return () => clearTimeout(timer)
  }, [eventData, refresh])
  const finishVoice = useCallback(() => {
    setRecording(false)
    refresh()
  }, [refresh])
  const cancelVoice = useCallback(() => setRecording(false), [])
  const mediaAction = async (work: Promise<unknown>) => {
    try {
      setMediaError('')
      await work
      refresh()
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : '無法附加檔案。')
    }
  }
  const openAttachment = (source: AttachmentSource) => {
    setPreview(source)
    useWorkspace.setState({ inspector: true })
  }
  useEffect(() => {
    const wake = () => {
      void window.yuki.client.reconnect()
      refresh()
    }
    window.addEventListener('online', wake)
    return () => window.removeEventListener('online', wake)
  }, [refresh])
  useEffect(() => {
    let active = true
    void window.yuki.client.draft(id).then((result) => {
      if (active && result.ok) {
        const parsed = parseMessage(result.value)
        currentDraft.current = parsed.text
        currentReferences.current = parsed.references
        setDraft(parsed.text)
        setReferences(parsed.references)
      }
    })
    return () => {
      active = false
    }
  }, [id])
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind, data) => {
        if (character !== id) return
        if (kind === 'connection') {
          const state = data as { state: 'online' | 'offline'; code?: string }
          setOnline(state.state)
          setConnectionProblem(state.code ?? '')
        } else {
          if (kind !== 'outbox') setOnline('online')
          refresh()
        }
      }),
    [id, refresh],
  )
  useEffect(() => {
    const search = () => setSearch('')
    window.addEventListener('yuki:search', search)
    return () => window.removeEventListener('yuki:search', search)
  }, [])
  useCommands((command) => {
    if (command === 'focus-composer')
      document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    if (command === 'search' || command === 'find') setSearch('')
  })
  useEffect(() => {
    if (bottom.current) {
      list.current?.scrollTo({ top: list.current.scrollHeight })
      setNewMessages(false)
    } else setNewMessages(true)
  }, [events.data, outbox.data])
  useEffect(() => {
    const accent = profileData?.accent
    if (!accent) return
    const root = document.documentElement
    root.style.setProperty(
      '--accent',
      preferences.theme === 'dark' ||
        (preferences.theme === 'system' && root.dataset.theme === 'dark')
        ? accent.dark
        : accent.light,
    )
    return () => {
      root.style.removeProperty('--accent')
    }
  }, [profileData?.accent, preferences.theme])
  const choose = (next: string) => {
    floor.current = null
    setConversation(next)
    setSelection(undefined)
    bottom.current = true
    useWorkspace.getState().setView('chat')
  }
  const updateDraft = (value: string) => {
    currentDraft.current = value
    setDraft(value)
    void window.yuki.client.draft(id, referencedMessage(currentReferences.current, value))
  }
  const updateReferences = (next: MessageReference[]) => {
    currentReferences.current = next
    setReferences(next)
    void window.yuki.client.draft(id, referencedMessage(next, currentDraft.current))
  }
  const addReference = (event: PublicEvent) => {
    if (
      !currentReferences.current.some(
        (item) => item.conversationId === event.conversation_id && item.eventId === event.event_id,
      )
    )
      updateReferences([
        ...currentReferences.current,
        { conversationId: event.conversation_id, eventId: event.event_id },
      ])
    choose(connection.conversationId)
  }
  const send = async () => {
    const submittedDraft = currentDraft.current
    const sentReferences = currentReferences.current
    const text = referencedMessage(sentReferences, submittedDraft)
    unwrap(
      await window.yuki.client.send(
        id,
        text,
        uploads.data?.map((item) => item.requestId),
      ),
    )
    if (currentDraft.current === submittedDraft) {
      currentDraft.current = ''
      setDraft('')
    }
    updateReferences(currentReferences.current.filter((item) => !sentReferences.includes(item)))
    bottom.current = true
    refresh()
  }
  const more = async () => {
    if (!eventData?.has_more || eventData.next_before === null) return
    const element = list.current,
      height = element?.scrollHeight ?? 0,
      top = element?.scrollTop ?? 0
    const page = await read<EventsPage>(id, {
      kind: 'events',
      conversationId: conversation,
      before: eventData.next_before,
    })
    floor.current = Math.min(
      ...page.items.map((item) => item.event_id),
      ...eventData.items.map((item) => item.event_id),
    )
    query.setQueryData([id, 'events', conversation], {
      ...eventData,
      has_more: page.has_more,
      next_before: page.next_before,
      items: [...page.items, ...eventData.items],
    })
    requestAnimationFrame(() => element?.scrollTo({ top: top + element.scrollHeight - height }))
  }
  const name = profileData?.display_name ?? connection.name,
    isMain = conversation === connection.conversationId
  const entry = homeData?.entries.find((item) => item.conversation_id === conversation)
  const pending = isMain
    ? (outbox.data ?? []).filter(
        (item) => (item.state !== 'result' || item.problem) && !item.eventId,
      )
    : []
  const visible = (eventData?.items ?? []).filter(
    (item) => search === null || item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  )
  return (
    <Workspace
      name={name}
      status={online === 'online' ? '已連線' : online === 'offline' ? '離線' : '連線中'}
      owner={profileData?.viewer.is_owner ?? false}
      platform={platform}
      preferences={preferences}
      savePreferences={save}
      onSettings={onSettings}
      entries={
        <>
          {homeData?.entries
            .filter((item) => item.conversation_id !== connection.conversationId)
            .map((item) => (
              <button
                className={styles.entry}
                key={item.conversation_id}
                aria-current={item.conversation_id === conversation ? 'page' : undefined}
                onClick={() => choose(item.conversation_id)}
              >
                {item.platform.toUpperCase()} · {item.display_name}
              </button>
            ))}
          {!isMain && (
            <Button variant="plain" onClick={() => choose(connection.conversationId)}>
              回到桌面對話
            </Button>
          )}
        </>
      }
      inspector={
        preview ? (
          <AttachmentPreview id={id} source={preview} close={() => setPreview(undefined)} />
        ) : (
          <div className={styles.inspector}>
            <h3>
              {isMain ? '桌面對話' : `${entry?.platform.toUpperCase()} · ${entry?.display_name}`}
            </h3>
            <p>這裡的內容來自原入口的對話紀錄。</p>
            {outbox.data
              ?.filter((item) => item.state !== 'result' || item.problem)
              .map((item) => (
                <Pending
                  key={item.requestId}
                  item={item}
                  verify={async () => {
                    unwrap(await window.yuki.client.verify(id, item.requestId))
                    refresh()
                  }}
                />
              ))}
          </div>
        )
      }
    >
      {view !== 'chat' ? (
        <EmptyState
          title={
            view === 'settings'
              ? '設定'
              : view === 'about'
                ? name
                : view === 'works'
                  ? '工作'
                  : view === 'computer'
                    ? `${name} 的電腦`
                    : '檔案與成果'
          }
        >
          <span>{view === 'about' ? profileData?.bio : '正在接入此單元的伺服器介面。'}</span>
        </EmptyState>
      ) : (
        <div
          className={styles.chat}
          onDragOver={(event) => {
            if (isMain && event.dataTransfer.types.includes('Files')) {
              event.preventDefault()
              setDragging(true)
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            if (isMain)
              void mediaAction(
                window.yuki.client.drop(id, Array.from(event.dataTransfer.files)).then(unwrap),
              )
          }}
        >
          {dragging && <div className={mediaStyles.drop}>放開以附加</div>}
          {mediaError && <Banner status="failed">{mediaError}</Banner>}
          {online !== 'online' && (
            <Banner>
              {connectionProblem
                ? problemText(connectionProblem)
                : '正在連接伺服器。草稿保存在這台電腦。'}
            </Banner>
          )}
          {(events.error || home.error || profile.error) && (
            <Banner status="failed">
              {(events.error ?? home.error ?? profile.error)?.message}
              <Button variant="plain" onClick={refresh}>
                重新連線
              </Button>
              <Button variant="plain" onClick={onPairAgain}>
                重新配對
              </Button>
            </Banner>
          )}
          {search !== null && (
            <div className={styles.search}>
              <input
                autoFocus
                aria-label="搜尋已載入內容"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearch(null)
                }}
              />
              <Button variant="plain" onClick={() => setSearch(null)}>
                完成
              </Button>
              <small>只搜尋已載入的內容</small>
            </div>
          )}
          <div
            className={styles.messages}
            role="log"
            aria-label="對話訊息"
            aria-live="polite"
            ref={list}
            onScroll={(event) => {
              const node = event.currentTarget
              bottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
            }}
          >
            {eventData?.has_more && (
              <Button variant="plain" onClick={() => void more()}>
                載入更早訊息
              </Button>
            )}
            {eventData && !events.isPending && !visible.length && !pending.length && (
              <EmptyState title={`和 ${name} 聊聊`}>說一聲你好，或交給她一件事。</EmptyState>
            )}
            {visible.map((event) => (
              <Message
                characterId={id}
                receipt={(outbox.data ?? []).find((item) => item.eventId === event.event_id)}
                verify={async (requestId) => {
                  unwrap(await window.yuki.client.verify(id, requestId))
                  refresh()
                }}
                key={event.event_id}
                event={event}
                name={name}
                selected={selection === event.event_id}
                onSelect={() => setSelection(event.event_id)}
                onReference={() => {
                  addReference(event)
                }}
                onAttachment={openAttachment}
              />
            ))}
            {pending.map((item) => (
              <div key={item.requestId} className={styles.ownMessage}>
                <References characterId={id} text={item.body.text} />
                <p>{parseMessage(item.body.text).text}</p>
                <Pending
                  item={item}
                  verify={async () => {
                    unwrap(await window.yuki.client.verify(id, item.requestId))
                    refresh()
                  }}
                />
              </div>
            ))}
          </div>
          {newMessages && (
            <button
              className={styles.newMessages}
              onClick={() => {
                bottom.current = true
                list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
                setNewMessages(false)
              }}
            >
              ↓ 新訊息
            </button>
          )}
          {isMain ? (
            <Composer
              name={name}
              draft={draft}
              onDraft={updateDraft}
              onSubmit={send}
              hasContent={references.length > 0 || !!uploads.data?.length}
              blocked={recording || uploads.data?.some((item) => item.state !== 'ready')}
              onAttach={() => void mediaAction(window.yuki.client.attach(id).then(unwrap))}
              onRecord={() => (recording ? finishRecording.current?.() : setRecording(true))}
            >
              <DraftAttachments id={id} items={uploads.data ?? []} refresh={refresh} />
              {recording && (
                <VoiceRecorder
                  id={id}
                  done={finishVoice}
                  cancel={cancelVoice}
                  finish={finishRecording}
                />
              )}
              {references.map((reference, index) => (
                <div
                  key={`${reference.conversationId}/${reference.eventId}/${index}`}
                  className={styles.reference}
                >
                  <Reference
                    id={id}
                    conversation={reference.conversationId}
                    eventId={reference.eventId}
                  />
                  <Button
                    variant="plain"
                    onClick={() =>
                      updateReferences(
                        currentReferences.current.filter((item) => item !== reference),
                      )
                    }
                  >
                    移除引用
                  </Button>
                </div>
              ))}
            </Composer>
          ) : (
            <div className={styles.readonly}>
              <p>
                這是你在 {entry?.platform.toUpperCase()} 與 {name}{' '}
                的對話。要在這裡繼續，請到桌面對話。
              </p>
              <Button
                disabled={!visible.length}
                onClick={() => {
                  const event =
                    visible.find((item) => item.event_id === selection) ?? visible.at(-1)
                  if (event) {
                    addReference(event)
                  }
                }}
              >
                在桌面對話中提到這段
              </Button>
            </div>
          )}
        </div>
      )}
    </Workspace>
  )
}

function Pending({ item, verify }: { item: OutboxItem; verify(): Promise<void> }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  return (
    <div className={styles.pending}>
      <span>
        {item.problem
          ? problemText(item.problem)
          : item.state === 'draft'
            ? '連線後送出'
            : item.state === 'submitted'
              ? '狀態未確認'
              : item.state === 'accepted'
                ? '已接收'
                : '已取得原回執'}
      </span>
      {item.state !== 'result' && (
        <Button
          variant="plain"
          loading={busy}
          onClick={() => {
            setBusy(true)
            void verify()
              .catch((error) => setError(error.message))
              .finally(() => setBusy(false))
          }}
        >
          查詢
        </Button>
      )}
      {error && <span>{error}</span>}
    </div>
  )
}

function Message({
  characterId,
  receipt,
  verify,
  event,
  name,
  selected,
  onSelect,
  onReference,
  onAttachment,
}: {
  characterId: string
  receipt?: OutboxItem
  verify(requestId: string): Promise<void>
  event: PublicEvent
  name: string
  selected: boolean
  onSelect(): void
  onReference(): void
  onAttachment(source: AttachmentSource): void
}) {
  const own = event.direction === 'inbound'
  return (
    <article
      className={`${styles.message} ${own ? styles.ownMessage : ''} ${selected ? styles.selected : ''}`}
      onClick={onSelect}
    >
      {!own && <Avatar name={name} size={28} />}
      <div className={styles.messageBody}>
        <header>
          <strong>{own ? '你' : name}</strong>
          <time dateTime={event.created_at}>
            {new Date(event.created_at).toLocaleString(undefined, {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </header>
        <References characterId={characterId} text={event.text} />
        <div
          className={styles.markdown}
          onClick={(event) => {
            const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
            if (link) {
              event.preventDefault()
              event.stopPropagation()
              void window.yuki.client.external(link.href)
            }
          }}
          dangerouslySetInnerHTML={{
            __html: markdown.render(parseMessage(event.text).text),
          }}
        />
        {own && receipt && <Pending item={receipt} verify={() => verify(receipt.requestId)} />}
        {event.attachments.map((attachment) => (
          <MessageAttachment
            key={attachment.attachment_index}
            id={characterId}
            event={event}
            attachment={attachment}
            open={onAttachment}
          />
        ))}
        <div className={styles.messageActions}>
          <Button
            variant="plain"
            onClick={(event) => {
              event.stopPropagation()
              onReference()
            }}
          >
            引用回覆
          </Button>
        </div>
      </div>
    </article>
  )
}

function References({ characterId, text }: { characterId: string; text: string }) {
  const refs = parseMessage(text).references
  return refs.map((item, index) => (
    <Reference
      key={index}
      id={characterId}
      conversation={item.conversationId}
      eventId={item.eventId}
    />
  ))
}
function Reference({
  id,
  conversation,
  eventId,
}: {
  id: string
  conversation: string
  eventId: number
}) {
  const event = useQuery({
    queryKey: [id, 'reference', conversation, eventId],
    queryFn: async () => {
      const page = await read<EventsPage>(id, {
        kind: 'events',
        conversationId: conversation,
        after: eventId - 1,
        limit: 1,
      })
      return page.items.find((item) => item.event_id === eventId) ?? null
    },
  })
  return (
    <div className={styles.reference}>
      {event.isPending
        ? '正在讀取引用…'
        : !event.error && event.data
          ? `引用：${event.data.text.slice(0, 120)}`
          : '引用的訊息無法讀取'}
    </div>
  )
}
