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
  CharacterStatus,
} from '../../shared/api'
import type { Preferences } from '../../shared/desktop'
import type { components } from '../../shared/contract.gen'
import { Composer } from '../components/Composer'
import { Banner, Button, EmptyState, IconButton } from '../components/Controls'
import { CharacterAvatar, CharacterVisuals } from '../components/CharacterAvatar'
import { characterPresence } from '../../shared/presence'
import { PromptEditor } from './PromptEditor'
import { useDisplayTime } from '../state/time'
import { Copy, Reply } from 'lucide-react'
import { Workspace } from '../components/Workspace'
import { unwrap, problemText, hidesPrivateData, ClientProblem } from '../queries/client'
import { useWorkspace } from '../state/workspace'
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
import { Files, ArtifactInspector } from './Files'
import { Computer, ComputerInspector } from './Computer'
import { About } from './About'

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
  const { dayKey, dayLabel } = useDisplayTime()
  const target = useWorkspace((state) => state.target)
  const focusMode = useWorkspace((state) => state.focusMode)
  const [promptEditing, setPromptEditing] = useState(false)
  const [promptToolbar, setPromptToolbar] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (view !== 'about' || focusMode) setPromptEditing(false)
  }, [view, focusMode])
  const [artifact, setArtifact] = useState<ArtifactSource>()
  const [conversation, setConversation] = useState(connection.conversationId),
    [draft, setDraft] = useState('')
  const currentDraft = useRef(draft)
  const [preview, setPreview] = useState<AttachmentSource>(),
    [dragging, setDragging] = useState(false),
    [mediaError, setMediaError] = useState(''),
    [recording, setRecording] = useState(false)
  const finishRecording = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    void window.yuki.client.selected(id)
  }, [id])
  useEffect(() => {
    if (target?.characterId === id && target.conversationId) {
      setAnchor(null)
      setConversation(target.conversationId)
      setSelection(undefined)
      bottom.current = true
    }
  }, [id, target])
  const [online, setOnline] = useState<'connecting' | 'online' | 'offline'>('connecting'),
    [connectionProblem, setConnectionProblem] = useState('')
  const [references, setReferences] = useState<MessageReference[]>([]),
    [selection, setSelection] = useState<number>()
  const [selectedWork, setSelectedWork] = useState<string>()
  const [replyWork, setReplyWork] = useState<Work>()
  const currentReferences = useRef<MessageReference[]>([])
  const [search, setSearch] = useState<string | null>(null)
  const [palette, setPalette] = useState(false),
    [messageStage, setMessageStage] = useState<MessageReference>()
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [id])
  const list = useRef<HTMLDivElement>(null),
    bottom = useRef(true),
    [newMessages, setNewMessages] = useState(false)
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
  useEffect(() => {
    if (view === 'files') {
      setSelectedWork(undefined)
      setPreview(undefined)
      useWorkspace.setState({ inspector: false })
    }
  }, [view])
  useEffect(() => {
    if (target?.characterId === id && target.workId) {
      setSelectedWork(target.workId)
      useWorkspace.setState({ inspector: true })
    }
  }, [id, target])
  const accessLost = hidesPrivateData(new ClientProblem(connectionProblem))
  const eventData = accessLost || hidesPrivateData(events.error) ? undefined : events.data,
    homeData = accessLost || hidesPrivateData(home.error) ? undefined : home.data,
    profileData = accessLost || hidesPrivateData(profile.error) ? undefined : profile.data
  const refresh = useCallback(() => {
    void query.invalidateQueries({ queryKey: [id, 'home'] })
    void query.invalidateQueries({ queryKey: [id, 'character'] })
    void query.invalidateQueries({ queryKey: [id, 'character-status'] })
    void query.invalidateQueries({ queryKey: [id, 'events'] })
    void query.invalidateQueries({ queryKey: [id, 'reference'] })
    void query.invalidateQueries({ queryKey: [id, 'outbox'] })
    void query.invalidateQueries({ queryKey: [id, 'uploads'] })
    void query.invalidateQueries({ queryKey: [id, 'content'] })
    void query.invalidateQueries({ queryKey: [id, 'activity'] })
    void query.invalidateQueries({ queryKey: [id, 'work'] })
    for (const key of [
      'memory',
      'automations',
      'capabilities',
      'character-commands',
      'avatar-commands',
    ])
      void query.invalidateQueries({ queryKey: [id, key] })
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
    setMessageStage(undefined)
    setArtifact(undefined)
    setSelectedWork(undefined)
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
        if (kind === 'sync') query.setQueryData([id, 'sync'], data)
        if (kind === 'conversation' || kind === 'work') {
          query.setQueryData<components['schemas']['SyncHint']>([id, 'sync'], (current) => {
            if (!current) return current
            if (kind === 'conversation') {
              const entry = data as components['schemas']['Entry']
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
            const work = data as components['schemas']['WorkHint']
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
    const search = () => setPalette(true)
    window.addEventListener('yuki:search', search)
    return () => window.removeEventListener('yuki:search', search)
  }, [])
  useCommands((command) => {
    if (command === 'focus-composer')
      document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    if (command === 'search') setPalette(true)
    if (command === 'find' && !promptEditing) {
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
    needsEarlier.current = false
    setAnchor(null)
    setHistoryError('')
    setNewMessages(false)
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
      setConversation(reference.conversationId)
    }
    setSearch(null)
    bottom.current = false
    setJump(reference)
    useWorkspace.getState().setView('chat')
    setMessageStage(stage ? reference : undefined)
    if (stage) {
      setSelectedWork(undefined)
      setArtifact(undefined)
      setPreview(undefined)
      query.setQueryData([id, 'reference', reference.conversationId, reference.eventId], event)
      useWorkspace.setState({ inspector: true, focusMode: true })
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
  const openWork = (workId: string) => {
    setMessageStage(undefined)
    setArtifact(undefined)
    setPreview(undefined)
    setSelectedWork(workId)
    useWorkspace.setState({ inspector: true })
  }
  const openArtifact = (source: ArtifactSource) => {
    setMessageStage(undefined)
    setArtifact(source)
    setSelectedWork(undefined)
    setPreview(undefined)
    useWorkspace.setState({ inspector: true })
  }
  const selectArtifact = (source: ArtifactSource) => {
    setMessageStage(undefined)
    setArtifact(source)
    setSelectedWork(undefined)
    setPreview(undefined)
  }
  const answerWork = (work: Work) => {
    setReplyWork(work)
    choose(connection.conversationId)
    useWorkspace.setState({ inspector: false, focusMode: false })
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
        useWorkspace.getState().setView(stage ? 'chat' : 'works')
        openWork(item.work.work_id)
        if (stage) useWorkspace.setState({ focusMode: true })
      })
    else
      paletteNavigate(() => {
        useWorkspace.getState().setView(stage ? 'chat' : 'files')
        if (stage) {
          openArtifact(item.source)
          useWorkspace.setState({ focusMode: true })
        } else selectArtifact(item.source)
      })
  }
  const paletteCommands: PaletteCommand[] = [
    ...(['chat', 'works', 'files', 'about'] as const).map((view, index) => ({
      id: `command/${view}`,
      title: ['開啟對話', '開啟工作', '開啟檔案與成果', '開啟角色資料'][index]!,
      run: () => paletteNavigate(() => useWorkspace.getState().setView(view)),
    })),
    {
      id: 'command/inspector',
      title: '開合檢視器',
      run: () => paletteNavigate(() => useWorkspace.getState().toggle('inspector')),
    },
    {
      id: 'command/sidebar',
      title: '開合側邊欄',
      run: () => paletteNavigate(() => useWorkspace.getState().toggle('sidebar')),
    },
    {
      id: 'command/stage',
      title: '展開或收合工作區',
      run: () => paletteNavigate(() => useWorkspace.getState().toggle('focusMode')),
    },
    { id: 'command/settings', title: '開啟設定', run: () => paletteNavigate(onSettings) },
    ...(profileData?.viewer.is_owner && !accessLost
      ? [
          {
            id: 'command/computer',
            title: `觀看 ${name} 的電腦`,
            run: (stage: boolean) =>
              paletteNavigate(() => {
                useWorkspace.getState().setView('computer')
                if (stage) useWorkspace.setState({ focusMode: true, inspector: true })
              }),
          },
          {
            id: 'command/wake',
            title: `喚醒 ${name} 的電腦`,
            run: (stage: boolean) =>
              paletteNavigate(() => {
                useWorkspace.getState().setView('computer')
                if (stage) useWorkspace.setState({ focusMode: true, inspector: true })
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
  return (
    <CharacterVisuals.Provider value={{ id, name, profile: profileData, presence }}>
      <Workspace
        toolbar={
          promptEditing && view === 'about' && !focusMode ? (
            <div className={styles.promptToolbar} ref={setPromptToolbar} />
          ) : undefined
        }
        name={name}
        avatar={<CharacterAvatar />}
        status={presence.text}
        presence={presence.color}
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
          view === 'computer' && !accessLost && profileData?.viewer.is_owner ? (
            focusMode ? (
              <Computer key={id} connection={connection} name={name} work={openWork} />
            ) : (
              <ComputerInspector key={id} id={id} work={openWork} />
            )
          ) : messageStage && !accessLost ? (
            <MessageStage
              id={id}
              reference={messageStage}
              render={(event) => (
                <Message
                  characterId={id}
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
          ) : artifact && !accessLost ? (
            <ArtifactInspector
              key={`${artifact.artifactId}/${artifact.version}`}
              id={id}
              source={artifact}
              library={() => useWorkspace.getState().setView('files')}
            />
          ) : selectedWork && !accessLost ? (
            <WorkDetail
              key={selectedWork}
              id={id}
              workId={selectedWork}
              open={openWork}
              replyInChat={answerWork}
              commandEnter={preferences.sendKey === 'command-enter'}
              artifact={openArtifact}
              computer={
                profileData?.viewer.is_owner
                  ? () => {
                      const state = useWorkspace.getState()
                      state.setView('computer')
                      if (!state.focusMode) state.toggle('focusMode')
                    }
                  : undefined
              }
            />
          ) : preview ? (
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
        {mediaError && view !== 'chat' && <Banner status="failed">{mediaError}</Banner>}
        {view === 'computer' && !focusMode ? (
          accessLost || !profileData?.viewer.is_owner ? (
            <Banner status="failed">
              {accessLost ? problemText(connectionProblem) : '這項操作需要角色擁有者權限。'}
            </Banner>
          ) : (
            <Computer key={id} connection={connection} name={name} work={openWork} />
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
            promptEditing && profileData.viewer.is_owner ? (
              <PromptEditor
                key={id}
                id={id}
                name={name}
                platform={platform}
                back={() => setPromptEditing(false)}
                toolbar={promptToolbar}
              />
            ) : (
              <About
                key={id}
                id={id}
                profile={profileData}
                jump={jumpTo}
                editPrompts={() => setPromptEditing(true)}
              />
            )
          ) : (
            <EmptyState title="角色資料">{profile.error?.message ?? '正在讀取…'}</EmptyState>
          )
        ) : view !== 'chat' && !focusMode ? (
          <EmptyState
            title={
              view === 'settings' ? '設定' : view === 'computer' ? `${name} 的電腦` : '檔案與成果'
            }
          >
            <span>正在接入此單元的伺服器介面。</span>
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
            {historyError && <Banner status="failed">{historyError}</Banner>}
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
                      dayKey(event.created_at) === dayKey(visible[index - 1]!.created_at)
                    }
                    onJump={(reference) => void jumpTo(reference)}
                    characterId={id}
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
                    (event.work_ids ?? []).map((workId) => (
                      <ConversationWork
                        key={workId}
                        id={id}
                        work={workId}
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
  onArtifact,
  onJump,
  consecutive,
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
  onArtifact(source: ArtifactSource): void
  onJump(reference: MessageReference): void
  consecutive: boolean
}) {
  const own = event.direction === 'inbound'
  const { timeLabel } = useDisplayTime()
  const html = useMarkdown(parseMessage(event.display_text ?? event.text).text)
  const [error, setError] = useState('')
  const action = (work: Promise<unknown>) =>
    void work.catch((error) => setError(error instanceof Error ? error.message : '操作未完成。'))
  return (
    <article
      data-event-id={event.event_id}
      tabIndex={0}
      aria-label={`${own ? '你' : name}的訊息`}
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
        (!consecutive ? <CharacterAvatar size={28} /> : <span className={styles.avatarSpace} />)}
      <div className={styles.messageBody}>
        <header>
          <strong>{own ? '你' : name}</strong>
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
            ? `引用：${parseMessage(event.data.display_text ?? event.data.text).text.slice(0, 120)}`
            : '引用的訊息無法讀取'}
      </span>
    </button>
  )
}
