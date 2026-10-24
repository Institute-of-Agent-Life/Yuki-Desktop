import { useFloatingInsets } from '../materials/floating'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
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
} from '../../shared/api'
import type { Preferences } from '../../shared/desktop'
import type { SyncHint } from '../../shared/sync'
import { Composer } from '../components/Composer'
import { Avatar, Banner, Button, EmptyState, IconButton } from '../components/Controls'
import { CharacterAvatar, CharacterVisuals } from '../components/CharacterAvatar'
import { characterPresence } from '../../shared/presence'
import { SoulEditor } from './SoulEditor'
import { useDisplayTime } from '../state/time'
import { ArrowLeft, Copy, Reply } from 'lucide-react'
import { Workspace } from '../components/Workspace'
import { unwrap, problemText, hidesPrivateData, ClientProblem } from '../queries/client'
import { useWorkspace, useSessionActive } from '../state/workspace'
import { useCommands } from '../state/commands'
import styles from './Conversation.module.css'
import { parseMessage, referencedMessage, type MessageReference } from '../../shared/message'
import { AttachmentPreview, DraftAttachments, MessageAttachment } from './Media'
import { VoiceRecorder } from './VoiceRecorder'
import mediaStyles from './Media.module.css'
import { useMarkdown } from '../text/markdown'
import { useHistory } from '../queries/history'
import { CommandPalette, type PaletteCommand } from '../components/CommandPalette'
import type { LoadedItem } from '../state/loaded'
import { requestNavigation } from '../state/navigation'
import { ConversationWork, WorkDetail, WorkList, WorkReply } from './Works'
import { ArtifactInspector } from './Files'
import { About } from './About'

const read = <T,>(id: string, route: Parameters<typeof window.yuki.client.read>[1]) =>
  window.yuki.client.read<T>(id, route).then(unwrap)

export function Conversation({
  connection,
  platform,
  preferences,
  onSettings,
  onPairAgain,
  roleSwitcher,
  settings,
  onSettingsBack,
}: {
  connection: Connection
  platform: string
  preferences: Preferences
  onSettings(): void
  onPairAgain(): void
  roleSwitcher?: React.ReactNode
  settings?: React.ReactNode
  onSettingsBack?(): void
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
  useEffect(() => {
    if (settings || view !== 'about' || focusMode) setSoulEditing(false)
  }, [view, focusMode, settings])
  const { artifact, preview, selectedWork, messageStage } = workspace
  const conversation = workspace.conversationId ?? connection.conversationId
  const [draft, setDraft] = useState('')
  const currentDraft = useRef(draft)
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
    bottom = useRef(true),
    [newMessages, setNewMessages] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const attachList = useCallback((element: HTMLDivElement | null) => {
    list.current = element
    setScrolled((element?.scrollTop ?? 0) > 0)
  }, [])
  const [anchor, setAnchor] = useState<number | null>(null)
  const [jump, setJump] = useState<MessageReference>()
  const [historyError, setHistoryError] = useState('')
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const earlierBusy = useRef(false)
  const needsEarlier = useRef(false)
  const activeRange = useRef('')
  activeRange.current = `${conversation}/${anchor}`
  const latestSeen = useRef<{ range: string; event: number }>({ range: '', event: 0 })
  const home = useQuery({ queryKey: [id, 'home'], queryFn: () => read<Home>(id, { kind: 'home' }) })
  const profile = useQuery({
    queryKey: [id, 'character'],
    queryFn: () => read<Profile>(id, { kind: 'character' }),
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
  useEffect(() => {
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
  const eventData = accessLost || hidesPrivateData(events.error) ? undefined : events.data,
    homeData = accessLost || hidesPrivateData(home.error) ? undefined : home.data,
    profileData = accessLost || hidesPrivateData(profile.error) ? undefined : profile.data
  const refresh = useCallback(() => {
    for (const key of [
      'home',
      'character',
      'events',
      'reference',
      'outbox',
      'uploads',
      'content',
      'activity',
      'work',
      'character-commands',
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
        if (kind === 'sync') query.setQueryData([id, 'sync'], data)
        if (kind === 'conversation' || kind === 'work') {
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
        } else {
          if (kind !== 'outbox') setOnline('online')
          refresh()
        }
      }),
    [id, refresh],
  )
  useEffect(() => {
    if (!active || settings) return
    const search = () => setPalette(true)
    window.addEventListener('yuki:search', search)
    return () => window.removeEventListener('yuki:search', search)
  }, [active, settings])
  useCommands((command) => {
    if (settings) return
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
  useEffect(() => {
    const range = `${conversation}/${anchor}`
    const last = events.data?.items.at(-1)?.event_id ?? 0
    const previous = latestSeen.current
    latestSeen.current = { range, event: last }
    if (bottom.current && anchor === null) {
      requestAnimationFrame(() => list.current?.scrollTo({ top: list.current.scrollHeight }))
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
    if (!active || settings) setPalette(false)
  }, [active, settings])
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
    if (earlierBusy.current || !eventData?.has_more || events.isFetching) return
    needsEarlier.current = false
    const element = list.current,
      height = element?.scrollHeight ?? 0,
      top = element?.scrollTop ?? 0,
      range = activeRange.current
    earlierBusy.current = true
    setLoadingEarlier(true)
    setHistoryError('')
    try {
      const page = await events.earlier(eventData)
      query.setQueryData(events.key, page)
      if (activeRange.current === range)
        requestAnimationFrame(() => element?.scrollTo({ top: top + element.scrollHeight - height }))
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
  const answerWork = (work: Work) => {
    setReplyWork(work)
    choose(connection.conversationId)
    workspace.patch({ inspector: false, focusMode: false })
  }
  const entry = homeData?.entries.find((item) => item.conversation_id === conversation)
  const pending = isMain
    ? (outbox.data ?? []).filter(
        (item) => (item.state !== 'result' || item.problem) && !item.eventId,
      )
    : []
  const visible = (eventData?.items ?? []).filter(
    (item) => search === null || item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  )
  const presence = characterPresence(online, homeData?.works)
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
        openArtifact(item.source)
        if (stage) workspace.patch({ focusMode: true })
      })
  }
  const paletteCommands: PaletteCommand[] = [
    ...(['chat', 'works', 'about'] as const).map((view, index) => ({
      id: `command/${view}`,
      title: ['開啟對話', '開啟工作', '開啟角色資料'][index]!,
      run: () =>
        paletteNavigate(() =>
          view === 'chat' ? choose(connection.conversationId) : workspace.setView(view),
        ),
    })),
    {
      id: 'command/inspector',
      title: '開合檢視器',
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
      title: '展開或收合工作區',
      run: () => paletteNavigate(() => workspace.toggle('focusMode')),
    },
    { id: 'command/settings', title: '開啟設定', run: () => paletteNavigate(onSettings) },
  ]
  const upgradeNotice = updateRequired && (
    <Banner status="failed">
      {problemText('client_upgrade_required')}
      <Button variant="plain" onClick={onSettings}>
        查看 App 更新
      </Button>
    </Banner>
  )
  return (
    <CharacterVisuals.Provider value={{ id, name, profile: profileData, presence }}>
      <Workspace
        scrolled={scrolled}
        mainConversation={isMain}
        onChat={() => choose(connection.conversationId)}
        settings={settings}
        onView={settings ? onSettingsBack : undefined}
        toolbar={
          settings ? (
            <>
              <Button variant="plain" onClick={onSettingsBack}>
                <ArrowLeft size={16} />
                返回
              </Button>
              <strong>設定</strong>
            </>
          ) : soulEditing && view === 'about' && !focusMode ? (
            <div className={styles.soulToolbar} ref={setSoulToolbar} />
          ) : undefined
        }
        roleSwitcher={roleSwitcher}
        name={name}
        avatar={<CharacterAvatar />}
        status={presence.text}
        presence={presence.color}
        owner={profileData?.viewer.is_owner ?? false}
        platform={platform}
        inspectorTitle={messageStage && view === 'chat' ? '原訊息' : undefined}
        onSettings={onSettings}
        entries={
          <>
            {homeData?.entries
              .filter((item) => item.conversation_id !== connection.conversationId)
              .map((item) => (
                <button
                  className={styles.entry}
                  key={item.conversation_id}
                  aria-current={
                    !settings && view === 'chat' && item.conversation_id === conversation
                      ? 'page'
                      : undefined
                  }
                  onClick={() =>
                    requestNavigation(() => {
                      choose(item.conversation_id)
                      if (settings) onSettingsBack?.()
                    })
                  }
                >
                  {item.platform.toUpperCase()} · {item.display_name}
                </button>
              ))}
          </>
        }
        inspector={
          messageStage && view === 'chat' && !accessLost ? (
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
            />
          ) : inspectorTab === 'work' && selectedWork && !accessLost ? (
            <WorkDetail
              key={selectedWork}
              id={id}
              workId={selectedWork}
              replyInChat={answerWork}
              commandEnter={preferences.sendKey === 'command-enter'}
              artifact={openArtifact}
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
              <p>從對話附件或工作成果選取一項，查看原版本。</p>
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
        {view === 'works' && !focusMode ? (
          accessLost ? (
            <Banner status="failed">{problemText(connectionProblem)}</Banner>
          ) : (
            <WorkList id={id} selected={selectedWork} open={openWork} />
          )
        ) : view === 'about' && !focusMode ? (
          accessLost ? (
            <Banner status="failed">{problemText(connectionProblem)}</Banner>
          ) : profileData ? (
            soulEditing && profileData.viewer.is_owner ? (
              <SoulEditor
                key={id}
                id={id}
                name={name}
                platform={platform}
                back={() => setSoulEditing(false)}
                toolbar={soulToolbar}
              />
            ) : (
              <About key={id} id={id} profile={profileData} editSoul={() => setSoulEditing(true)} />
            )
          ) : (
            <EmptyState title="角色資料">{profile.error?.message ?? '正在讀取…'}</EmptyState>
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
              {online !== 'online' && !updateRequired && (
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
            </div>
            <div
              className={styles.messages}
              role="log"
              aria-label="對話訊息"
              aria-live="polite"
              ref={attachList}
              onScroll={(event) => {
                const node = event.currentTarget
                setScrolled(node.scrollTop > 0)
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
              {eventData && !eventData.has_more && visible.length > 0 && search === null && (
                <header className={styles.conversationIntroduction}>
                  <CharacterAvatar size={64} />
                  <h2>{name}</h2>
                  <p>
                    {isMain
                      ? `這是你與 ${name} 的桌面對話`
                      : `${entry?.platform.toUpperCase() ?? ''} · ${entry?.display_name ?? ''}`}
                  </p>
                </header>
              )}
              {eventData && !events.isPending && !visible.length && !pending.length && (
                <div className={styles.emptyConversation}>
                  <CharacterAvatar size={120} />
                  <h2>和 {name} 聊聊</h2>
                  <p>說一聲你好，或交給她一件事。</p>
                </div>
              )}
              {visible.map((event, index) => (
                <Fragment key={event.event_id}>
                  {(!index ||
                    dayKey(event.created_at) !== dayKey(visible[index - 1]!.created_at)) && (
                    <div className={styles.dateSeparator}>{dayLabel(event.created_at)}</div>
                  )}
                  <Message
                    consecutive={
                      index > 0 &&
                      event.direction === visible[index - 1]!.direction &&
                      event.author_kind === visible[index - 1]!.author_kind &&
                      (event.author_kind === 'yuki' ||
                        (event.author_person_id !== null &&
                          event.author_person_id === visible[index - 1]!.author_person_id)) &&
                      dayKey(event.created_at) === dayKey(visible[index - 1]!.created_at)
                    }
                    onJump={(reference) => void jumpTo(reference)}
                    characterId={id}
                    viewerPersonId={connection.personId}
                    receipt={(outbox.data ?? []).find((item) => item.eventId === event.event_id)}
                    verify={async (requestId) => {
                      unwrap(await window.yuki.client.verify(id, requestId))
                      refresh()
                    }}
                    event={event}
                    name={name}
                    selected={selection === event.event_id}
                    onSelect={() => setSelection(event.event_id)}
                    onReference={() => {
                      addReference(event)
                    }}
                    onAttachment={openAttachment}
                    onArtifact={openArtifact}
                  />
                  {!accessLost &&
                    (homeData?.works ?? [])
                      .filter((work) =>
                        work.results.some(
                          (result) =>
                            result.event_id === event.event_id &&
                            result.conversation_id === event.conversation_id,
                        ),
                      )
                      .map((work) => (
                        <ConversationWork
                          key={work.work_id}
                          id={id}
                          work={work}
                          open={openWork}
                          reply={answerWork}
                          artifact={openArtifact}
                        />
                      ))}
                </Fragment>
              ))}
              {pending.map((item) => (
                <div key={item.requestId} className={styles.ownMessage}>
                  <References
                    characterId={id}
                    text={item.body.text}
                    onJump={(ref) => void jumpTo(ref)}
                  />
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
            {(newMessages || anchor !== null) && (
              <button
                className={styles.newMessages}
                onClick={() => {
                  if (anchor !== null) setAnchor(null)
                  bottom.current = true
                  list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
                  setNewMessages(false)
                }}
              >
                {anchor !== null ? '回到最新訊息' : '↓ 新訊息'}
              </button>
            )}
            {online === 'online' && !activity.error && activity.data?.evidence === 'executing' && (
              <div className={styles.processing} role="status">
                <span aria-hidden="true">
                  <CharacterAvatar size={20} />
                </span>
                <span aria-hidden="true">•••</span>
                <span>{name} 正在處理</span>
              </div>
            )}
            {isMain && replyWork ? (
              <WorkReply
                key={replyWork.work_id}
                id={id}
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
              <Composer
                name={name}
                draft={draft}
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
              <div className={styles.readonly} data-floating-footer>
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
}: {
  characterId: string
  viewerPersonId: string
  receipt?: OutboxItem
  verify(requestId: string): Promise<void>
  event: PublicEvent
  name: string
  selected: boolean
  onSelect(): void
  onReference(): void
  onAttachment(source: AttachmentSource): void
  onArtifact(source: ArtifactSource): void
  onJump(reference: MessageReference): void
  consecutive: boolean
}) {
  const own = event.direction === 'inbound' && event.author_person_id === viewerPersonId
  const yuki = event.author_kind === 'yuki'
  const author = own ? '你' : yuki ? name : (event.sender_display_name ?? '參與者')
  const { timeLabel } = useDisplayTime()
  const html = useMarkdown(parseMessage(event.text).text)
  const [error, setError] = useState('')
  const action = (work: Promise<unknown>) =>
    void work.catch((error) => setError(error instanceof Error ? error.message : '操作未完成。'))
  return (
    <article
      data-event-id={event.event_id}
      tabIndex={0}
      aria-label={`${author}的訊息`}
      className={`${styles.message} ${own ? styles.ownMessage : ''} ${selected ? styles.selected : ''} ${consecutive ? styles.consecutive : ''}`}
      onClick={onSelect}
      onContextMenu={(click) => {
        click.preventDefault()
        const link = (click.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
        action(
          window.yuki.client
            .contextMenu({
              text: event.text,
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
        <header>
          <strong>{author}</strong>
          <time dateTime={event.created_at}>{timeLabel(event.created_at)}</time>
        </header>
        <References characterId={characterId} text={event.text} onJump={onJump} />
        <div
          className={styles.markdown}
          onClick={(event) => {
            const copy = (event.target as HTMLElement).closest('button[data-code-copy]')
            if (copy) {
              event.stopPropagation()
              const text = copy.parentElement?.querySelector('pre code')?.textContent
              if (text !== undefined && text !== null)
                action(window.yuki.client.copy(text).then(unwrap))
              return
            }
            const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
            if (link) {
              event.preventDefault()
              event.stopPropagation()
              action(window.yuki.client.external(link.href).then(unwrap))
            }
          }}
          dangerouslySetInnerHTML={{
            __html: html,
          }}
        />
        {error && <Banner status="failed">{error}</Banner>}
        {own && receipt && <Pending item={receipt} verify={() => verify(receipt.requestId)} />}
        {event.attachments.map((attachment) => (
          <MessageAttachment
            key={attachment.attachment_index}
            id={characterId}
            event={event}
            attachment={attachment}
            open={onAttachment}
            artifact={onArtifact}
          />
        ))}
        {event.asr.map((transcript) => (
          <p key={transcript.segment_index} data-transcript-segment={transcript.segment_index}>
            {transcript.text}
          </p>
        ))}
        <div className={styles.messageActions}>
          <IconButton
            label="複製訊息"
            onClick={(click) => {
              click.stopPropagation()
              action(window.yuki.client.copy(event.text).then(unwrap))
            }}
          >
            <Copy size={15} />
          </IconButton>
          <IconButton
            label="引用回覆"
            onClick={(event) => {
              event.stopPropagation()
              onReference()
            }}
          >
            <Reply size={15} />
          </IconButton>
        </div>
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
            ? `引用：${parseMessage(event.data.text).text.slice(0, 120)}`
            : '引用的訊息無法讀取'}
      </span>
    </button>
  )
}
