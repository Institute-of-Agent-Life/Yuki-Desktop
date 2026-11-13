import { useFloatingInsets } from '../materials/floating'
import { ConversationGlass } from '../materials/ConversationGlass'
import glassStyles from '../materials/ConversationGlass.module.css'
import { reducedMotion } from '../motion/hooks'
import { animateBubble, releaseDraft } from '../motion/bubble'
import { glide, gliding, movedByApp, movedByOther, place } from '../motion/glide'
import { sampleSpring, springs } from '../motion/spring'
import { useGlass } from '../materials/glass'
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Connection,
  EventsPage,
  Home,
  OutboxItem,
  Profile,
  PublicEvent,
  AttachmentSource,
  Activity,
  Work,
  ArtifactSource,
  CharacterStatus,
} from '../../shared/api'
import type { Preferences } from '../../shared/desktop'
import type { SyncHint } from '../../shared/sync'
import { Composer } from '../components/Composer'
import { Avatar, Banner, Button, EmptyState, IconButton } from '../components/Controls'
import { CharacterAvatar, CharacterVisuals } from '../components/CharacterAvatar'
import { characterPresence } from '../../shared/presence'
import { SoulEditor } from './SoulEditor'
import { useDisplayTime } from '../state/time'
import { Copy, MessageCircle, Reply, X } from 'lucide-react'
import { Workspace } from '../components/Workspace'
import { PresenceCard } from '../components/PresenceCard'
import { unwrap, problemText, hidesPrivateData, ClientProblem, useMe } from '../queries/client'
import { useWorkspace, useSessionActive } from '../state/workspace'
import { useCommands } from '../state/commands'
import styles from './Conversation.module.css'
import appStyles from '../App.module.css'
import { parseMessage, referencedMessage, type MessageReference } from '../../shared/message'
import { AttachmentPreview, DraftAttachments, MessageAttachment } from './Media'
import { VoiceRecorder } from './VoiceRecorder'
import mediaStyles from './Media.module.css'
import { Markdown } from '../text/RichMarkdown'
import { useHistory } from '../queries/history'
import { CommandPalette, type PaletteCommand } from '../components/CommandPalette'
import type { LoadedItem } from '../state/loaded'
import { requestNavigation } from '../state/navigation'
import { ConversationWork, WorkDetail, WorkList, WorkReply } from './Works'
import { Files, ArtifactInspector } from './Files'
import { Computer, ComputerInspector } from './Computer'
import { About } from './About'
import type { SettingsCategory } from './Settings'
import { LocalComputer } from './LocalComputer'

// Keeps the end of the conversation in view. Something arriving glides there on the bubbles'
// spring; anything else, like opening the conversation or content settling, stays there at once.
const followEnd = (log: HTMLElement, arriving: boolean) => {
  if (arriving && !reducedMotion()) glide(log, 'end')
  else if (!gliding(log)) place(log, log.scrollHeight - log.clientHeight)
}

// The draft changes with every key. It is kept apart from the conversation, so typing re-renders
// the composer that shows it rather than every message above it.
function useDraft() {
  const [store] = useState(() => {
    let value = ''
    const listeners = new Set<() => void>()
    return {
      get: () => value,
      set(next: string) {
        value = next
        for (const listener of listeners) listener()
      },
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
  })
  return store
}
type Draft = ReturnType<typeof useDraft>
// The way back to the newest message floats over the conversation as a lens.
function NewMessagesPill(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const glass = useGlass<HTMLButtonElement>('toolbar')
  return <button ref={glass.ref} type="button" data-glass="toolbar" {...props} />
}
function DraftField({ draft, children }: { draft: Draft; children(text: string): ReactNode }) {
  return children(useSyncExternalStore(draft.subscribe, draft.get))
}

const read = <T,>(id: string, route: Parameters<typeof window.yuki.client.read>[1]) =>
  window.yuki.client.read<T>(id, route).then(unwrap)

type Receipt = OutboxItem & { sending: boolean }
type MessageRecord =
  { event: PublicEvent; receipt?: Receipt } | { event?: undefined; receipt: Receipt }

const messageTime = ({ event, receipt }: MessageRecord) =>
  event ? event.created_at : new Date(receipt.createdAt).toISOString()

function messageSender({ event }: MessageRecord, viewerPersonId: string) {
  if (!event) return `inbound/person/${viewerPersonId}`
  if (event.author_kind === 'yuki') return `${event.direction}/yuki`
  return event.author_person_id
    ? `${event.direction}/${event.author_kind}/${event.author_person_id}`
    : undefined
}

export function Conversation({
  connection,
  platform,
  preferences,
  onSettings,
  onPairAgain,
  roleSwitcher,
}: {
  connection: Connection
  platform: string
  preferences: Preferences
  onSettings(category?: SettingsCategory): void
  onPairAgain(): void
  roleSwitcher?: (trigger: React.ReactNode) => React.ReactNode
}) {
  const floatingRef = useFloatingInsets()
  const workspace = useWorkspace()
  const active = useSessionActive()
  const id = connection.characterId,
    query = useQueryClient(),
    view = useWorkspace((state) => state.view)
  const { dayKey, dayLabel } = useDisplayTime()
  const target = useWorkspace((state) => state.target)
  const focusMode = useWorkspace((state) => state.focusMode)
  const [soulEditing, setSoulEditing] = useState(false)
  const [soulToolbar, setSoulToolbar] = useState<HTMLDivElement | null>(null)
  const [computerToolbar, setComputerToolbar] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (view !== 'about' || focusMode) setSoulEditing(false)
  }, [view, focusMode])
  const { artifact, preview, selectedWork, messageStage } = workspace
  const conversation = workspace.conversationId ?? connection.conversationId
  const draft = useDraft()
  const [dragging, setDragging] = useState(false),
    [mediaError, setMediaError] = useState(''),
    [recording, setRecording] = useState(false)
  const finishRecording = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    if (active) void window.yuki.client.selected(id)
  }, [id, active])
  useEffect(() => {
    if (target?.characterId === id && target.conversationId) {
      setAnchor(null)
      workspace.patch({ conversationId: target.conversationId })
      setSelection(undefined)
      bottom.current = true
    }
  }, [id, target])
  const [online, setOnline] = useState<'connecting' | 'online' | 'offline'>('connecting'),
    [connectionProblem, setConnectionProblem] = useState('')
  const [reconnectError, setReconnectError] = useState('')
  const [references, setReferences] = useState<MessageReference[]>([]),
    [selection, setSelection] = useState<number>()
  const [replyWork, setReplyWork] = useState<Work>()
  const currentReferences = useRef<MessageReference[]>([])
  const [search, setSearch] = useState<string | null>(null)
  const [palette, setPalette] = useState(false)
  const alive = useRef(true)
  const invalidatedReads = useRef(new Set<Promise<unknown>>())
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [id])
  const list = useRef<HTMLDivElement>(null),
    scrollTop = useRef(0),
    bottom = useRef(true),
    [newMessages, setNewMessages] = useState(false)
  // At the end as last seen, unless something else moved the list since and its scroll event is
  // still on its way: then where the list stands now decides.
  const following = (log: HTMLElement) =>
    bottom.current &&
    (!movedByOther(log) || log.scrollHeight - log.scrollTop - log.clientHeight < 64)
  const [anchor, setAnchor] = useState<number | null>(null)
  const attachList = useCallback(
    (element: HTMLDivElement | null) => {
      if (list.current) scrollTop.current = list.current.scrollTop
      list.current = element
      if (element)
        element.scrollTo({
          top: bottom.current && anchor === null ? element.scrollHeight : scrollTop.current,
        })
    },
    [anchor],
  )
  const [jump, setJump] = useState<MessageReference>()
  const [historyError, setHistoryError] = useState('')
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const earlierBusy = useRef(false)
  const needsEarlier = useRef(false)
  const activeRange = useRef('')
  const prepend = useRef<{ range: string; eventId: string; top: number } | null>(null)
  activeRange.current = `${conversation}/${anchor}`
  const latestSeen = useRef<{ range: string; event: number; generation?: number }>({
    range: '',
    event: 0,
  })
  // Each sent request remembers where its words were typed, the start of its bubble.
  const sentMessages = useRef(new Map<string, DOMRect | undefined>())
  const readonlyGlass = useGlass<HTMLDivElement>('composer')
  const liveMessage = useRef<Home['main']>(undefined)
  const home = useQuery({ queryKey: [id, 'home'], queryFn: () => read<Home>(id, { kind: 'home' }) })
  const me = useMe(id)
  const administrator = me.data?.is_superuser === true && !hidesPrivateData(me.error)
  const profile = useQuery({
    queryKey: [id, 'character'],
    queryFn: () => read<Profile>(id, { kind: 'character' }),
  })
  const characterStatus = useQuery({
    queryKey: [id, 'character-status'],
    queryFn: () => read<CharacterStatus>(id, { kind: 'character-status' }),
  })
  useEffect(() => {
    if (!profile.data || profile.data.avatar || hidesPrivateData(profile.error)) return
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d', { colorSpace: 'srgb' })!
    context.beginPath()
    context.arc(64, 64, 64, 0, Math.PI * 2)
    context.clip()
    context.fillStyle = profile.data.accent.light
    context.fillRect(0, 0, 128, 128)
    context.fillStyle = '#fff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `600 ${128 * 0.42}px ${getComputedStyle(document.documentElement).fontFamily}`
    const letter =
      [
        ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
          profile.data.display_name.trim(),
        ),
      ][0]?.segment.toLocaleUpperCase() ?? ''
    context.fillText(letter, 64, 66)
    const source = profile.data
    canvas.toBlob((blob) => {
      if (blob)
        void blob
          .arrayBuffer()
          .then((buffer) =>
            window.yuki.client.letterDecoration(
              id,
              source.revision,
              source.avatar_revision,
              new Uint8Array(buffer),
            ),
          )
    }, 'image/png')
  }, [id, profile.data, profile.error])
  const outbox = useQuery({
    queryKey: [id, 'outbox'],
    queryFn: () => window.yuki.client.outbox(id).then(unwrap),
  })
  const uploads = useQuery({
    queryKey: [id, 'uploads'],
    queryFn: () => window.yuki.client.uploads(id).then(unwrap),
  })
  const activity = useQuery({
    queryKey: [id, 'activity', conversation],
    queryFn: () => read<Activity>(id, { kind: 'activity', conversationId: conversation }),
  })
  const events = useHistory(id, conversation, anchor)
  useLayoutEffect(() => {
    const snapshot = prepend.current
    prepend.current = null
    if (snapshot?.range === activeRange.current) {
      const element = list.current,
        article = element?.querySelector<HTMLElement>(
          `article[data-event-id="${snapshot.eventId}"]`,
        )
      if (element && article)
        element.scrollTo({
          top: element.scrollTop + article.getBoundingClientRect().top - snapshot.top,
        })
    }
  })
  useEffect(() => {
    if (view === 'files') {
      workspace.patch({ preview: undefined, inspector: false })
    }
    if (view !== 'chat') workspace.patch({ messageStage: undefined })
  }, [view])
  useEffect(() => {
    if (messageStage && !workspace.inspector && !focusMode)
      workspace.patch({ messageStage: undefined })
  }, [workspace.inspector, focusMode, messageStage])
  useEffect(() => {
    if (target?.characterId === id && target.workId) {
      workspace.patch({
        selectedWork: target.workId,
        messageStage: undefined,
        inspector: true,
        inspectorTab: 'work',
      })
    }
  }, [id, target])
  const accessLost = hidesPrivateData(new ClientProblem(connectionProblem))
  const updateRequired =
    connectionProblem === 'client_upgrade_required' ||
    [events.error, home.error, profile.error].some(
      (error) => error instanceof ClientProblem && error.code === 'client_upgrade_required',
    )
  const upgradeNotice = updateRequired && (
    <Banner status="failed">
      {problemText('client_upgrade_required')}
      <Button variant="plain" onClick={() => onSettings('updates')}>
        查看 App 更新
      </Button>
    </Banner>
  )
  const eventData = accessLost || hidesPrivateData(events.error) ? undefined : events.data,
    homeData = accessLost || hidesPrivateData(home.error) ? undefined : home.data,
    profileData = accessLost || hidesPrivateData(profile.error) ? undefined : profile.data
  const processing =
    online === 'online' && !activity.error && activity.data?.evidence === 'executing'
  const refresh = useCallback(() => {
    for (const key of [
      'home',
      'me',
      'character',
      'events',
      'reference',
      'outbox',
      'uploads',
      'content',
      'activity',
      'work',
      'steps',
      'character-commands',
      'character-status',
      'memory',
      'automations',
      'capabilities',
    ]) {
      const filter = { queryKey: [id, key] }
      for (const entry of query.getQueryCache().findAll({
        ...filter,
        type: 'active',
        fetchStatus: 'fetching',
      })) {
        const pending = entry.promise
        if (!pending || invalidatedReads.current.has(pending)) continue
        invalidatedReads.current.add(pending)
        // Initial fetches reuse their old response even when invalidated. Deliver it,
        // then honour the real change once without cancelling reads under frequent hints.
        void pending.then(
          () => {
            invalidatedReads.current.delete(pending)
            if (alive.current)
              void query.invalidateQueries(
                { queryKey: entry.queryKey, exact: true },
                { cancelRefetch: false },
              )
          },
          () => invalidatedReads.current.delete(pending),
        )
      }
      void query.invalidateQueries(filter, { cancelRefetch: false })
    }
  }, [id, query])
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
    workspace.patch({
      messageStage: undefined,
      artifact: undefined,
      preview: source,
      inspector: true,
      inspectorTab: 'files',
    })
  }
  const reconnect = useCallback(async () => {
    setReconnectError('')
    try {
      unwrap(await window.yuki.client.reconnect())
      refresh()
    } catch (error) {
      setReconnectError(error instanceof Error ? error.message : '無法重新連線。')
    }
  }, [refresh])
  useEffect(() => {
    const wake = () => void reconnect()
    window.addEventListener('online', wake)
    return () => window.removeEventListener('online', wake)
  }, [reconnect])
  useEffect(() => {
    let active = true
    void window.yuki.client.draft(id).then((result) => {
      if (active && result.ok) {
        const parsed = parseMessage(result.value)
        currentReferences.current = parsed.references
        draft.set(parsed.text)
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
        if (kind === 'sync' || kind === 'connection') liveMessage.current = undefined
        if (kind === 'sync') query.setQueryData([id, 'sync'], data)
        if (kind === 'conversation' || kind === 'work') {
          if (kind === 'conversation') {
            const entry = data as Home['main']
            if (activeRange.current === `${entry.conversation_id}/null`) liveMessage.current = entry
          }
          query.setQueryData<SyncHint>([id, 'sync'], (current) => {
            if (!current) return current
            if (kind === 'conversation') {
              const entry = data as Home['main']
              return {
                ...current,
                conversations: [
                  ...current.conversations.filter(
                    (item) => item.conversation_id !== entry.conversation_id,
                  ),
                  entry,
                ],
              }
            }
            const work = data as SyncHint['works'][number]
            return {
              ...current,
              works: [...current.works.filter((item) => item.work_id !== work.work_id), work],
            }
          })
        }
        if (kind === 'connection') {
          const state = data as { state: 'online' | 'offline'; code?: string }
          setOnline(state.state)
          setConnectionProblem(state.code ?? '')
          if (state.state === 'online') setReconnectError('')
        } else {
          if (kind !== 'outbox') {
            setOnline('online')
            setReconnectError('')
          }
          refresh()
        }
      }),
    [id, refresh],
  )
  useEffect(() => {
    if (!active) return
    const search = () => setPalette(true)
    window.addEventListener('yuki:search', search)
    return () => window.removeEventListener('yuki:search', search)
  }, [active])
  useCommands((command) => {
    if (command === 'focus-composer')
      document
        .querySelector<HTMLTextAreaElement>(`[data-character-session="${id}"] textarea`)
        ?.focus()
    if (command === 'search') setPalette(true)
    if (command === 'find' && !soulEditing) {
      if (view === 'chat') setSearch('')
      else setPalette(true)
    }
  })
  useEffect(() => {
    if (accessLost) setPalette(false)
  }, [accessLost])
  useLayoutEffect(() => {
    const log = list.current
    if (
      !log ||
      !active ||
      anchor !== null ||
      search !== null ||
      !bottom.current ||
      log.closest('[inert]') ||
      reducedMotion()
    ) {
      log?.querySelectorAll('[data-message-request] [data-liquid]').forEach((surface) => {
        for (const animation of surface.getAnimations()) animation.cancel()
      })
      sentMessages.current.clear()
      liveMessage.current = undefined
      return
    }
    for (const [requestId, origin] of sentMessages.current) {
      const row = log.querySelector(`[data-message-request="${CSS.escape(requestId)}"]`)
      if (!row) continue
      sentMessages.current.delete(requestId)
      // The bubble is measured where it is now; the list glides to its end on the same spring,
      // so together the bubble travels from the composer to its resting place.
      animateBubble(row, true, origin)
      glide(log, 'end')
    }
    const hint = liveMessage.current
    if (!hint || !eventData || eventData.latest_event_id < hint.latest_event_id) return
    liveMessage.current = undefined
    const previous = latestSeen.current
    if (
      hint.conversation_id !== conversation ||
      previous.range !== activeRange.current ||
      previous.generation !== eventData.generation ||
      hint.generation !== eventData.generation ||
      hint.latest_event_id <= previous.event
    )
      return
    const arrival = eventData.items.find((event) => event.event_id === hint.latest_event_id)
    if (arrival?.author_kind === 'yuki') {
      const row = log.querySelector(`[data-event-id="${arrival.event_id}"]`)
      if (row) {
        animateBubble(row, false)
        glide(log, 'end')
      }
    }
  })
  // Rows settling into their size, the room kept for the composer or a narrower window move the
  // end as well: a person at the end stays there.
  useEffect(() => {
    const log = list.current
    if (!log) return
    const sizes = new ResizeObserver(() => {
      if (following(log) && anchor === null) followEnd(log, false)
    })
    sizes.observe(log)
    for (const row of log.children) sizes.observe(row)
    const rows = new MutationObserver((records) => {
      for (const record of records)
        for (const row of record.addedNodes) if (row instanceof Element) sizes.observe(row)
    })
    rows.observe(log, { childList: true })
    return () => {
      sizes.disconnect()
      rows.disconnect()
    }
  }, [anchor])
  // Rows pushed down by something inserted above them slide there on the bubbles' spring;
  // the offsets add up, so a row pushed twice in a row still lands exactly.
  const rowTops = useRef(new WeakMap<Element, number>())
  useLayoutEffect(() => {
    const log = list.current
    if (!log) return
    const follow = following(log) && anchor === null && !reducedMotion()
    // Measured from the list's first row, so the room kept above it (a notice coming or going,
    // with no render of its own) is not taken for rows being pushed.
    const origin = (log.firstElementChild as HTMLElement).offsetTop
    for (const row of [...log.children].slice(-8) as HTMLElement[]) {
      const before = rowTops.current.get(row),
        now = row.offsetTop - origin
      rowTops.current.set(row, now)
      if (!follow || before === undefined || before === now || Math.abs(now - before) > 400)
        continue
      const samples = sampleSpring(springs.bubble),
        last = samples.length - 1
      row.animate(
        samples.map(({ value }, index) => ({
          offset: index / last,
          translate: `0 ${((before - now) * (1 - value)).toFixed(2)}px`,
        })),
        { duration: (last * 1000) / 60, easing: 'linear', composite: 'add' },
      )
    }
  })
  // The processing note has its own place below the last message, in the room kept above the
  // composer: it fades in and out there, so it never moves the list or anything in it, and a
  // send scrolls once.
  const [noteShown, setNoteShown] = useState(processing)
  const note = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (processing) setNoteShown(true)
  }, [processing])
  useLayoutEffect(() => {
    const row = note.current
    if (!row) return
    if (reducedMotion()) return processing ? undefined : setNoteShown(false)
    // A new note fades in from nothing; starting again mid-fade carries on from where it is.
    const from = row.dataset.shown === undefined ? 0 : parseFloat(getComputedStyle(row).opacity),
      to = processing ? 1 : 0
    row.dataset.shown = ''
    for (const animation of row.getAnimations()) animation.cancel()
    if (from === to && processing) return
    const samples = sampleSpring(processing ? springs.emerge : springs.withdraw),
      last = samples.length - 1
    const fade = row.animate(
      samples.map(({ value }, index) => {
        const opacity = Math.min(1, Math.max(0, from + (to - from) * value))
        return { offset: index / last, opacity, transform: `translateY(${(1 - opacity) * 6}px)` }
      }),
      { duration: (last * 1000) / 60, easing: 'linear', fill: 'forwards' },
    )
    if (!processing)
      void fade.finished.then(
        () => setNoteShown(false),
        () => {},
      )
  }, [processing, noteShown])
  useEffect(() => {
    const range = `${conversation}/${anchor}`
    const last = events.data?.items.at(-1)?.event_id ?? 0
    const previous = latestSeen.current
    latestSeen.current = { range, event: last, generation: events.data?.generation }
    if ((list.current ? following(list.current) : bottom.current) && anchor === null) {
      // A later message in the same conversation arrives; opening one only lands at its end.
      const arriving = previous.range === range && previous.event > 0 && last > previous.event
      requestAnimationFrame(() => {
        const log = list.current
        if (log) followEnd(log, arriving)
      })
      setNewMessages(false)
    } else if (previous.range === range && previous.event > 0 && last > previous.event) {
      setNewMessages(true)
    }
  }, [events.data, outbox.data, conversation, anchor])
  useEffect(() => {
    if (!jump || jump.conversationId !== conversation || !events.data) return
    const original = events.data.items.find((item) => item.event_id === jump.eventId)
    if (original) {
      requestAnimationFrame(() => {
        list.current
          ?.querySelector<HTMLElement>(`[data-event-id="${jump.eventId}"]`)
          ?.scrollIntoView({ block: 'center' })
      })
      setSelection(jump.eventId)
    } else setHistoryError('引用的訊息無法讀取')
    setJump(undefined)
  }, [jump, conversation, events.data])
  useEffect(() => {
    const accent = profileData?.accent
    if (!active || !accent) return
    const root = document.documentElement
    const update = () => {
      const dark = root.dataset.theme === 'dark'
      root.style.setProperty('--accent', dark ? accent.dark : accent.light)
      root.style.setProperty(
        '--accent-strong',
        `color-mix(in srgb, ${dark ? accent.dark : accent.light} 85%, ${dark ? 'white' : 'black'})`,
      )
      root.style.setProperty(
        '--accent-subtle',
        (dark ? accent.dark : accent.light).toLowerCase() === (dark ? '#7fa4ff' : '#3a6bd6')
          ? dark
            ? '#263252'
            : '#e8eefc'
          : `color-mix(in srgb, ${dark ? accent.dark : accent.light} 12%, var(--bg-content))`,
      )
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      observer.disconnect()
      for (const key of ['--accent', '--accent-strong', '--accent-subtle'])
        root.style.removeProperty(key)
    }
  }, [profileData?.accent, preferences.theme, active])
  useEffect(() => {
    if (!active) setPalette(false)
  }, [active])
  const choose = (next: string) =>
    requestNavigation(() => {
      needsEarlier.current = false
      setAnchor(null)
      setHistoryError('')
      setNewMessages(false)
      workspace.patch({ conversationId: next })
      setSelection(undefined)
      bottom.current = true
      workspace.setView('chat')
    })
  const updateDraft = (value: string) => {
    draft.set(value)
    void window.yuki.client.draft(id, referencedMessage(currentReferences.current, value))
  }
  const updateReferences = (next: MessageReference[]) => {
    currentReferences.current = next
    setReferences(next)
    void window.yuki.client.draft(id, referencedMessage(next, draft.get()))
  }
  const addReference = (event: PublicEvent) => {
    setReplyWork(undefined)
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
    const field = list.current?.parentElement?.querySelector<HTMLTextAreaElement>(
      '[data-region="composer"] textarea',
    )
    const origin = field?.getBoundingClientRect()
    const submittedDraft = draft.get()
    const sentReferences = currentReferences.current
    const text = referencedMessage(sentReferences, submittedDraft)
    const receipt = unwrap(
      await window.yuki.client.send(
        id,
        text,
        uploads.data?.map((item) => item.requestId),
      ),
    )
    sentMessages.current.set(receipt.requestId, origin)
    if (draft.get() === submittedDraft) {
      if (field && !reducedMotion()) releaseDraft(field)
      draft.set('')
    }
    updateReferences(currentReferences.current.filter((item) => !sentReferences.includes(item)))
    bottom.current = true
    refresh()
  }
  const more = async () => {
    if (earlierBusy.current || !eventData?.has_more || events.isFetching) return
    needsEarlier.current = false
    const range = activeRange.current,
      article = list.current?.querySelector<HTMLElement>('article[data-event-id]'),
      snapshot = article
        ? {
            range,
            eventId: article.dataset.eventId!,
            top: article.getBoundingClientRect().top,
          }
        : null
    earlierBusy.current = true
    setLoadingEarlier(true)
    setHistoryError('')
    try {
      const page = await events.earlier(eventData)
      const entry = query.getQueryCache().find<EventsPage>({ queryKey: events.key, exact: true })!
      if (entry.state.fetchStatus !== 'idle' || entry.state.data !== eventData) {
        // Settle older Query delivery before reading the expanded range.
        await entry.cancel({ revert: true })
        await entry.fetch(undefined, { cancelRefetch: false })
      } else query.setQueryData(events.key, page)
      if (activeRange.current === range) prepend.current = snapshot
    } catch (error) {
      if (activeRange.current === range)
        setHistoryError(error instanceof Error ? error.message : '無法載入更早訊息。')
    } finally {
      earlierBusy.current = false
      setLoadingEarlier(false)
    }
  }
  useEffect(() => {
    if (needsEarlier.current && !events.isFetching) void more()
  })
  const applyJump = (reference: MessageReference, event: PublicEvent, stage = false) => {
    if (!alive.current) return false
    if (
      reference.conversationId !== conversation ||
      !eventData?.items.some((item) => item.event_id === reference.eventId)
    ) {
      setAnchor(reference.eventId + 1)
      workspace.patch({ conversationId: reference.conversationId })
    }
    setSearch(null)
    bottom.current = false
    setJump(reference)
    workspace.setView('chat')
    workspace.patch({ messageStage: stage ? reference : undefined })
    if (stage) {
      query.setQueryData([id, 'reference', reference.conversationId, reference.eventId], event)
      workspace.patch({ inspector: true, focusMode: true })
    }
    return true
  }
  const exactMessage = async (reference: MessageReference) => {
    const page = await read<EventsPage>(id, {
      kind: 'events',
      conversationId: reference.conversationId,
      after: reference.eventId - 1,
      limit: 1,
    })
    const event = page.items.find(
      (item) =>
        item.event_id === reference.eventId && item.conversation_id === reference.conversationId,
    )
    if (!event) {
      query.setQueriesData<EventsPage>(
        {
          predicate: (item) =>
            item.queryKey[0] === id &&
            item.queryKey[1] === 'events' &&
            item.queryKey[2] === reference.conversationId,
        },
        (previous) =>
          previous
            ? {
                ...previous,
                items: previous.items.filter((item) => item.event_id !== reference.eventId),
              }
            : previous,
      )
      query.setQueryData([id, 'reference', reference.conversationId, reference.eventId], null)
      throw new Error('引用的訊息無法讀取')
    }
    return event
  }
  const jumpTo = async (reference: MessageReference) => {
    setHistoryError('')
    try {
      return applyJump(reference, await exactMessage(reference))
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '引用的訊息無法讀取')
      return false
    }
  }
  const name = profileData?.display_name ?? connection.name,
    isMain = conversation === connection.conversationId
  const inspectorTab = workspace.inspectorTab
  const openWork = (workId: string) => {
    workspace.patch({
      selectedWork: workId,
      messageStage: undefined,
      inspector: true,
      inspectorTab: 'work',
    })
  }
  const openArtifact = (source: ArtifactSource) => {
    workspace.patch({
      messageStage: undefined,
      artifact: source,
      preview: undefined,
      inspector: true,
      inspectorTab: 'files',
    })
  }
  const selectArtifact = (source: ArtifactSource) => {
    workspace.patch({
      artifact: source,
      preview: undefined,
      messageStage: undefined,
      inspectorTab: 'files',
    })
  }
  const answerWork = (work: Work) => {
    setReplyWork(work)
    choose(connection.conversationId)
    workspace.patch({ inspector: false, focusMode: false })
  }
  const entry = homeData?.entries.find((item) => item.conversation_id === conversation)
  const pending = isMain
    ? (outbox.data ?? []).filter((item) =>
        item.eventId
          ? anchor === null && eventData && item.eventId > eventData.latest_event_id
          : item.state !== 'result' || item.problem,
      )
    : []
  const visible = (eventData?.items ?? []).filter(
    (item) =>
      search === null || item.content.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  )
  const messages: MessageRecord[] = [
    ...visible.map((event) => ({
      event,
      receipt: outbox.data?.find((item) => item.eventId === event.event_id),
    })),
    ...pending.map((receipt) => ({ receipt })),
  ]
  const presence = characterPresence(
    online,
    accessLost || hidesPrivateData(characterStatus.error) ? undefined : characterStatus.data,
  )
  const paletteNavigate = (run: () => void) => {
    setPalette(false)
    requestNavigation(() => {
      if (alive.current) run()
    })
  }
  const pickLoaded = async (item: LoadedItem, stage: boolean) => {
    if (item.kind === 'message') {
      const reference = { conversationId: item.conversationId, eventId: item.event.event_id }
      const event = await exactMessage(reference)
      if (alive.current) paletteNavigate(() => applyJump(reference, event, stage))
    } else if (item.kind === 'work')
      paletteNavigate(() => {
        workspace.setView(stage ? 'chat' : 'works')
        openWork(item.work.work_id)
        if (stage) workspace.patch({ focusMode: true })
      })
    else
      paletteNavigate(() => {
        workspace.setView(stage ? 'chat' : 'files')
        if (stage) {
          openArtifact(item.source)
          workspace.patch({ focusMode: true })
        } else selectArtifact(item.source)
      })
  }
  const paletteCommands: PaletteCommand[] = [
    ...(['chat', 'works', 'files', 'about'] as const).map((view) => ({
      id: `command/${view}`,
      title: {
        chat: '開啟對話',
        works: '開啟工作',
        files: '開啟檔案與成果',
        about: `開啟 ${name} 的資料`,
      }[view],
      run: () =>
        paletteNavigate(() =>
          view === 'chat' ? choose(connection.conversationId) : workspace.setView(view),
        ),
    })),
    {
      id: 'command/inspector',
      title: '開合詳情面板',
      run: () =>
        paletteNavigate(() =>
          window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'inspector' })),
        ),
    },
    {
      id: 'command/sidebar',
      title: '開合側邊欄',
      run: () =>
        paletteNavigate(() =>
          window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'sidebar' })),
        ),
    },
    {
      id: 'command/stage',
      title: '放大或還原詳情',
      run: () => paletteNavigate(() => workspace.toggle('focusMode')),
    },
    { id: 'command/settings', title: '開啟設定', run: () => paletteNavigate(onSettings) },
    {
      id: 'command/agent',
      title: '連接這台電腦',
      run: () => paletteNavigate(() => onSettings('computer')),
    },
    ...(!accessLost && administrator
      ? [
          {
            id: 'command/computer',
            title: `觀看 ${name} 的電腦`,
            run: (stage: boolean) =>
              paletteNavigate(() => {
                workspace.setView('computer')
                if (stage) workspace.patch({ focusMode: true, inspector: true })
              }),
          },
          {
            id: 'command/wake',
            title: `喚醒 ${name} 的電腦`,
            run: (stage: boolean) =>
              paletteNavigate(() => {
                workspace.setView('computer')
                if (stage) workspace.patch({ focusMode: true, inspector: true })
                void window.yuki.client
                  .computerCommand(id, { action: 'wake' })
                  .then(unwrap)
                  .then((result) => {
                    if (alive.current && (result.problem || result.state !== 'result'))
                      setMediaError(
                        result.state !== 'result'
                          ? '喚醒結果尚未確認，請在電腦頁查證原請求。'
                          : problemText(result.problem!),
                      )
                  })
                  .catch((error) => {
                    if (alive.current)
                      setMediaError(error instanceof Error ? error.message : '喚醒尚未確認。')
                  })
              }),
          },
        ]
      : []),
  ]
  const displayedWorks = new Set<string>()
  return (
    <CharacterVisuals.Provider value={{ id, name, profile: profileData, presence }}>
      <Workspace
        mainConversation={isMain}
        onChat={() => choose(connection.conversationId)}
        toolbar={
          soulEditing && administrator && view === 'about' && !focusMode ? (
            <div className={styles.soulToolbar} ref={setSoulToolbar} />
          ) : undefined
        }
        toolbarTitle={
          view === 'computer' && !focusMode && !accessLost ? (
            <div className={styles.computerToolbar} ref={setComputerToolbar}>
              <span className={styles.computerToolbarFallback}>{name} 的電腦</span>
            </div>
          ) : undefined
        }
        roleSwitcher={roleSwitcher?.(
          <PresenceCard
            name={name}
            status={presence.text}
            color={presence.color}
            avatar={<CharacterAvatar />}
          />,
        )}
        name={name}
        avatar={<CharacterAvatar />}
        status={presence.text}
        presence={presence.color}
        platform={platform}
        inspectorTitle={messageStage && view === 'chat' ? '原訊息' : undefined}
        onSettings={onSettings}
        entries={
          <>
            {homeData?.entries
              .filter((item) => item.conversation_id !== connection.conversationId)
              .map((item) => (
                <button
                  className={appStyles.nav}
                  key={item.conversation_id}
                  aria-current={
                    view === 'chat' && item.conversation_id === conversation ? 'page' : undefined
                  }
                  onClick={() =>
                    requestNavigation(() => {
                      choose(item.conversation_id)
                    })
                  }
                >
                  <MessageCircle size={16} strokeWidth={1.5} />
                  {item.platform.toUpperCase()} 私聊 · {item.display_name}
                </button>
              ))}
          </>
        }
        inspector={
          inspectorTab === 'computer' &&
          !(messageStage && view === 'chat') &&
          !accessLost &&
          administrator ? (
            focusMode ? (
              <Computer key={id} connection={connection} name={name} work={openWork} />
            ) : (
              <ComputerInspector
                key={id}
                id={id}
                work={openWork}
                preview={
                  view !== 'computer' ? (
                    <Computer
                      connection={connection}
                      name={name}
                      work={openWork}
                      compact={{
                        expand: () =>
                          requestNavigation(() =>
                            workspace.patch({ inspector: true, focusMode: true }),
                          ),
                      }}
                    />
                  ) : undefined
                }
              />
            )
          ) : messageStage && view === 'chat' && !accessLost ? (
            <MessageStage
              id={id}
              reference={messageStage}
              render={(event) => (
                <Message
                  characterId={id}
                  viewerPersonId={connection.personId}
                  event={event}
                  name={name}
                  selected={false}
                  consecutive={false}
                  onSelect={() => setSelection(event.event_id)}
                  onReference={() => addReference(event)}
                  onAttachment={openAttachment}
                  onArtifact={openArtifact}
                  onJump={(ref) => void jumpTo(ref)}
                  verify={async (requestId) => {
                    unwrap(await window.yuki.client.verify(id, requestId))
                    refresh()
                  }}
                />
              )}
            />
          ) : inspectorTab === 'files' && artifact && !accessLost ? (
            <ArtifactInspector
              key={`${artifact.artifactId}/${artifact.version}`}
              id={id}
              source={artifact}
              library={() => workspace.setView('files')}
            />
          ) : inspectorTab === 'work' && selectedWork && !accessLost ? (
            <WorkDetail
              key={selectedWork}
              id={id}
              platform={platform}
              workId={selectedWork}
              open={openWork}
              replyInChat={answerWork}
              commandEnter={preferences.sendKey === 'command-enter'}
              artifact={openArtifact}
              computer={() => {
                requestNavigation(() => {
                  workspace.setView('computer')
                  workspace.patch({ inspector: true, focusMode: true })
                })
              }}
            />
          ) : inspectorTab === 'files' && preview && !accessLost ? (
            <AttachmentPreview
              id={id}
              source={preview}
              close={() => workspace.patch({ preview: undefined })}
            />
          ) : inspectorTab === 'files' ? (
            <div className={styles.inspector}>
              <h3>尚未選取檔案</h3>
              <p>從對話附件或檔案與成果選取一項，查看原版本。</p>
              <Button variant="plain" onClick={() => workspace.setView('files')}>
                開啟檔案與成果
              </Button>
            </div>
          ) : (
            <div className={styles.inspector}>
              <h3>尚未選取工作</h3>
              <p>從對話中的工作卡或工作清單選取一項，查看進度與回覆。</p>
              <Button variant="plain" onClick={() => workspace.setView('works')}>
                開啟工作清單
              </Button>
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
        {view !== 'chat' && !focusMode && upgradeNotice}
        {mediaError && view !== 'chat' && <Banner status="failed">{mediaError}</Banner>}
        {view === 'computer' && !focusMode ? (
          accessLost ? (
            <Banner status="failed">{problemText(connectionProblem)}</Banner>
          ) : (
            <Computer
              key={id}
              connection={connection}
              name={name}
              work={openWork}
              toolbar={computerToolbar}
            />
          )
        ) : view === 'local' && !focusMode ? (
          accessLost ? (
            <Banner status="failed">{problemText(connectionProblem)}</Banner>
          ) : (
            <LocalComputer connection={connection} openSettings={() => onSettings('computer')} />
          )
        ) : view === 'files' && !focusMode ? (
          accessLost ? (
            <Banner status="failed">{problemText(connectionProblem)}</Banner>
          ) : (
            <Files
              id={id}
              initial={artifact}
              onSelect={selectArtifact}
              jump={(ref) => void jumpTo(ref)}
              work={openWork}
            />
          )
        ) : view === 'works' && !focusMode ? (
          accessLost ? (
            <Banner status="failed">{problemText(connectionProblem)}</Banner>
          ) : (
            <WorkList id={id} selected={selectedWork} open={openWork} />
          )
        ) : view === 'about' && !focusMode ? (
          accessLost ? (
            <Banner status="failed">{problemText(connectionProblem)}</Banner>
          ) : profileData ? (
            soulEditing && administrator ? (
              <SoulEditor
                key={id}
                id={id}
                name={name}
                platform={platform}
                back={() => setSoulEditing(false)}
                toolbar={soulToolbar}
              />
            ) : (
              <About
                key={id}
                id={id}
                server={connection.baseUrl}
                profile={profileData}
                jump={jumpTo}
                editSoul={() => setSoulEditing(true)}
              />
            )
          ) : (
            <EmptyState title={name}>{profile.error?.message ?? '正在讀取…'}</EmptyState>
          )
        ) : (
          <div
            ref={floatingRef}
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
            <div className={styles.notices} data-floating-notices>
              {upgradeNotice}
              {mediaError && <Banner status="failed">{mediaError}</Banner>}
              {historyError && <Banner status="failed">{historyError}</Banner>}
              {!updateRequired &&
                (online !== 'online' ||
                  events.error ||
                  home.error ||
                  profile.error ||
                  reconnectError) && (
                  <Banner
                    status={
                      reconnectError || events.error || home.error || profile.error
                        ? 'failed'
                        : 'offline'
                    }
                  >
                    {reconnectError ||
                      (events.error ?? home.error ?? profile.error)?.message ||
                      (connectionProblem
                        ? problemText(connectionProblem)
                        : '正在連接伺服器。草稿保存在這台電腦。')}
                    <Button variant="plain" onClick={() => void reconnect()}>
                      重新連線
                    </Button>
                    {(events.error || home.error || profile.error) && (
                      <Button variant="plain" onClick={onPairAgain}>
                        重新配對
                      </Button>
                    )}
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
            </div>
            <div
              className={styles.messages}
              role="log"
              aria-label="對話訊息"
              aria-live="polite"
              ref={attachList}
              onLoadCapture={(event) => {
                if (following(event.currentTarget) && anchor === null)
                  followEnd(event.currentTarget, false)
              }}
              onScroll={(event) => {
                const node = event.currentTarget
                // The app keeping the end in view is not the person leaving it.
                if (movedByApp(node)) return
                bottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
                needsEarlier.current = node.scrollTop < 48 && !bottom.current
                if (needsEarlier.current) void more()
              }}
            >
              {eventData?.has_more && (
                <Button variant="plain" loading={loadingEarlier} onClick={() => void more()}>
                  載入更早訊息
                </Button>
              )}
              {eventData && !eventData.has_more && messages.length > 0 && search === null && (
                <header className={styles.conversationIntroduction}>
                  <CharacterAvatar size={26} />
                  <h2>{name}</h2>
                  <p>
                    {isMain
                      ? '桌面對話'
                      : `${entry?.platform.toUpperCase() ?? ''} · ${entry?.display_name ?? ''}`}
                  </p>
                </header>
              )}
              {eventData && !events.isPending && !messages.length && (
                <div className={styles.emptyConversation}>
                  <CharacterAvatar size={120} />
                  <h2>和 {name} 聊聊</h2>
                  <p>說一聲你好，或交給她一件事。</p>
                </div>
              )}
              {messages.map((message, index) => {
                const { event, receipt } = message
                const time = messageTime(message)
                const previous = messages[index - 1]
                const sameDay =
                  previous !== undefined && dayKey(time) === dayKey(messageTime(previous))
                const sender = messageSender(message, connection.personId)
                const consecutive =
                  sameDay &&
                  sender !== undefined &&
                  sender === messageSender(previous, connection.personId)
                return (
                  <Fragment
                    key={receipt ? `request/${receipt.requestId}` : `event/${event!.event_id}`}
                  >
                    {!sameDay && <div className={styles.dateSeparator}>{dayLabel(time)}</div>}
                    <Message
                      {...message}
                      consecutive={consecutive}
                      onJump={(reference) => void jumpTo(reference)}
                      characterId={id}
                      viewerPersonId={connection.personId}
                      verify={async (requestId) => {
                        unwrap(await window.yuki.client.verify(id, requestId))
                        refresh()
                      }}
                      name={name}
                      selected={event !== undefined && selection === event.event_id}
                      onSelect={event ? () => setSelection(event.event_id) : undefined}
                      onReference={event ? () => addReference(event) : undefined}
                      onAttachment={openAttachment}
                      onArtifact={openArtifact}
                    />
                    {!accessLost &&
                      (event?.work_ids ?? [])
                        .filter((workId) => {
                          if (displayedWorks.has(workId)) return false
                          displayedWorks.add(workId)
                          return true
                        })
                        .map((workId) => (
                          <ConversationWork
                            key={workId}
                            id={id}
                            work={workId}
                            open={openWork}
                            reply={answerWork}
                          />
                        ))}
                  </Fragment>
                )
              })}
              <div className={styles.noteSlot}>
                {noteShown && (
                  <div
                    ref={note}
                    data-processing=""
                    className={`${styles.message} ${styles.processing}`}
                    role="status"
                  >
                    <CharacterAvatar size={22} />
                    <MessageBubble>
                      <span className={styles.waitDots} aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>{name} 正在處理</span>
                    </MessageBubble>
                  </div>
                )}
              </div>
            </div>
            {(newMessages || anchor !== null) && (
              <NewMessagesPill
                className={styles.newMessages}
                onClick={() => {
                  if (anchor !== null) setAnchor(null)
                  bottom.current = true
                  list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
                  setNewMessages(false)
                }}
              >
                {anchor !== null ? '回到最新訊息' : '↓ 新訊息'}
              </NewMessagesPill>
            )}
            {isMain && replyWork ? (
              <WorkReply
                key={replyWork.work_id}
                id={id}
                platform={platform}
                work={replyWork}
                done={refresh}
                close={() => setReplyWork(undefined)}
                commandEnter={preferences.sendKey === 'command-enter'}
                question={
                  replyWork.waiting_question
                    ? {
                        conversationId: replyWork.waiting_question.conversation_id,
                        eventId: replyWork.waiting_question.event_id,
                      }
                    : undefined
                }
              />
            ) : isMain ? (
              <DraftField draft={draft}>
                {(text) => (
                  <Composer
                    name={name}
                    platform={platform}
                    draft={text}
                    onDraft={updateDraft}
                    onSubmit={send}
                    hasContent={references.length > 0 || !!uploads.data?.length}
                    blocked={recording || uploads.data?.some((item) => item.state !== 'ready')}
                    commandEnter={preferences.sendKey === 'command-enter'}
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
                          onJump={(ref) => void jumpTo(ref)}
                        />
                        <IconButton
                          label="移除引用"
                          onClick={() =>
                            updateReferences(
                              currentReferences.current.filter((item) => item !== reference),
                            )
                          }
                        >
                          <X size={14} />
                        </IconButton>
                      </div>
                    ))}
                  </Composer>
                )}
              </DraftField>
            ) : (
              <div
                ref={readonlyGlass.ref}
                data-glass="composer"
                className={styles.readonly}
                data-floating-footer
              >
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
      {palette && !accessLost && (
        <CommandPalette
          character={id}
          commands={paletteCommands}
          pick={pickLoaded}
          close={() => setPalette(false)}
        />
      )}
    </CharacterVisuals.Provider>
  )
}

function MessageStage({
  id,
  reference,
  render,
}: {
  id: string
  reference: MessageReference
  render(event: PublicEvent): React.ReactNode
}) {
  const event = useQuery({
    queryKey: [id, 'reference', reference.conversationId, reference.eventId],
    staleTime: Infinity,
    queryFn: async () => {
      const page = await read<EventsPage>(id, {
        kind: 'events',
        conversationId: reference.conversationId,
        after: reference.eventId - 1,
        limit: 1,
      })
      return page.items.find((item) => item.event_id === reference.eventId) ?? null
    },
  })
  return (
    <section aria-label="原訊息舞台">
      <h2 className={styles.stageTitle}>原訊息</h2>
      {event.isPending ? (
        <p>正在讀取原訊息…</p>
      ) : event.error || !event.data ? (
        <Banner status="failed">引用的訊息無法讀取</Banner>
      ) : (
        render(event.data)
      )}
    </section>
  )
}

// A sent message shows its request's state only when the person may need to act on it: kept
// offline, unconfirmed, or stopped by a problem. Sending, accepted and finished pass silently.
const needsAttention = (item: Receipt) =>
  !!item.problem || ((item.state === 'submitted' || item.state === 'draft') && !item.sending)

function Pending({ item, verify }: { item: Receipt; verify(): Promise<void> }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const label = item.problem
    ? problemText(item.problem)
    : item.state === 'draft'
      ? item.sending
        ? '送出中'
        : '連線後送出'
      : item.state === 'submitted'
        ? '狀態未確認'
        : item.state === 'accepted'
          ? '已接收'
          : '已取得原回執'
  return (
    <div className={styles.pending}>
      <span>{label}</span>
      {item.state !== 'result' && !item.sending && (
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

// A message of stickers alone shows them as stickers; its content ("[表情: 开心]") names them.
const stickerName = (event: PublicEvent | undefined) => {
  if (!event || event.text.trim() || !event.attachments.length) return undefined
  if (!event.attachments.every((attachment) => attachment.sticker)) return undefined
  const tags = event.content.match(/^\[表情(?::\s*(.+))?\]$/)?.[1]
  return tags ? `表情：${tags}` : '表情'
}

function MessageBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${styles.bubble} ${glassStyles.root}`}>
      <ConversationGlass kind="bubble" />
      <div className={styles.bubbleCopy} data-bubble-copy>
        {children}
      </div>
    </div>
  )
}

export function Message({
  characterId,
  viewerPersonId,
  receipt,
  verify,
  event,
  name,
  selected,
  onSelect,
  onReference,
  onAttachment,
  onArtifact,
  onJump,
  consecutive,
}: MessageRecord & {
  characterId: string
  viewerPersonId: string
  verify(requestId: string): Promise<void>
  name: string
  selected: boolean
  onSelect?(): void
  onReference?(): void
  onAttachment(source: AttachmentSource): void
  onArtifact(source: ArtifactSource): void
  onJump(reference: MessageReference): void
  consecutive: boolean
}) {
  const own = !event || (event.direction === 'inbound' && event.author_person_id === viewerPersonId)
  const yuki = event?.author_kind === 'yuki'
  const author = own ? '你' : yuki ? name : (event?.sender_display_name ?? '參與者')
  const content = event ? event.content : receipt.body.text
  const time = event ? event.created_at : new Date(receipt.createdAt).toISOString()
  const { timeLabel } = useDisplayTime()
  const [error, setError] = useState('')
  const sticker = stickerName(event)
  const action = (work: Promise<unknown>) =>
    void work.catch((error) => setError(error instanceof Error ? error.message : '操作未完成。'))
  return (
    <article
      data-event-id={event?.event_id}
      data-message-request={own ? receipt?.requestId : undefined}
      tabIndex={event ? 0 : undefined}
      aria-label={event ? `${author}的訊息` : '待確認訊息'}
      className={`${styles.message} ${own ? styles.ownMessage : ''} ${selected ? styles.selected : ''} ${consecutive ? styles.consecutive : ''}`}
      onClick={onSelect}
      onContextMenu={(click) => {
        if (!event) return
        click.preventDefault()
        const link = (click.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
        const selection = window.getSelection()
        const selectedText =
          selection?.rangeCount && selection.getRangeAt(0).intersectsNode(click.currentTarget)
            ? selection.toString()
            : ''
        action(
          window.yuki.client
            .contextMenu({
              text: selectedText || event.content,
              ...(link ? { link: link.href } : {}),
            })
            .then(unwrap),
        )
      }}
    >
      {!own &&
        (consecutive ? (
          <span className={styles.avatarSpace} />
        ) : yuki ? (
          <CharacterAvatar size={28} />
        ) : (
          <Avatar name={author} size={28} />
        ))}
      <div className={styles.messageBody}>
        {sticker && event ? (
          <div className={styles.sticker} data-sticker="">
            <header>
              <strong>{author}</strong>
              <time dateTime={time}>{timeLabel(time)}</time>
            </header>
            {event.attachments.map((attachment) => (
              <MessageAttachment
                key={attachment.attachment_index}
                id={characterId}
                event={event}
                attachment={attachment}
                open={onAttachment}
                artifact={onArtifact}
                sticker={sticker}
              />
            ))}
            {error && <Banner status="failed">{error}</Banner>}
          </div>
        ) : (
          <MessageBubble>
            <header>
              <strong>{author}</strong>
              <time dateTime={time}>{timeLabel(time)}</time>
            </header>
            <References characterId={characterId} text={content} onJump={onJump} />
            <Markdown
              id={characterId}
              text={parseMessage(content).text}
              hydrate={!!event}
              className={styles.markdown}
              onProblem={setError}
            />
            {error && <Banner status="failed">{error}</Banner>}
            {own && receipt && needsAttention(receipt) && (
              <Pending item={receipt} verify={() => verify(receipt.requestId)} />
            )}
            {event?.attachments.map((attachment) => (
              <MessageAttachment
                key={attachment.attachment_index}
                id={characterId}
                event={event}
                attachment={attachment}
                open={onAttachment}
                artifact={onArtifact}
              />
            ))}
            {event?.asr.map((transcript) => (
              <p key={transcript.segment_index} data-transcript-segment={transcript.segment_index}>
                {transcript.text}
              </p>
            ))}
          </MessageBubble>
        )}
        {event && (
          <div className={styles.messageActions} data-message-actions>
            <IconButton
              label="複製訊息"
              onClick={(click) => {
                click.stopPropagation()
                action(window.yuki.client.copy(event.content).then(unwrap))
              }}
            >
              <Copy size={15} />
            </IconButton>
            <IconButton
              label="引用回覆"
              onClick={(event) => {
                event.stopPropagation()
                onReference?.()
              }}
            >
              <Reply size={15} />
            </IconButton>
          </div>
        )}
      </div>
    </article>
  )
}

function References({
  characterId,
  text,
  onJump,
}: {
  characterId: string
  text: string
  onJump(reference: MessageReference): void
}) {
  const refs = parseMessage(text).references
  return refs.map((item, index) => (
    <Reference
      key={index}
      id={characterId}
      conversation={item.conversationId}
      eventId={item.eventId}
      onJump={onJump}
    />
  ))
}
function Reference({
  id,
  conversation,
  eventId,
  onJump,
}: {
  id: string
  conversation: string
  eventId: number
  onJump(reference: MessageReference): void
}) {
  const { dayLabel, timeLabel } = useDisplayTime()
  const home = useQuery({ queryKey: [id, 'home'], queryFn: () => read<Home>(id, { kind: 'home' }) })
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
  const source = home.data?.entries.find((item) => item.conversation_id === conversation)
  const available = !event.error && !!event.data
  return (
    <button
      className={styles.referenceCapsule}
      disabled={!available}
      onClick={(click) => {
        click.stopPropagation()
        onJump({ conversationId: conversation, eventId })
      }}
    >
      {available && (
        <small>
          {source ? `${source.platform.toUpperCase()} 私聊` : '這個對話'} ·{' '}
          {dayLabel(event.data!.created_at)} {timeLabel(event.data!.created_at)}
        </small>
      )}
      <span>
        {event.isPending
          ? '正在讀取引用…'
          : !event.error && event.data
            ? `引用：${parseMessage(event.data.content).text.slice(0, 120)}`
            : '引用的訊息無法讀取'}
      </span>
    </button>
  )
}
