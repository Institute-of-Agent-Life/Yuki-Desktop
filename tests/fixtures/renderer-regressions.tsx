import { Fragment, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SoulEditor } from '../../src/renderer/views/SoulEditor'
import { Composer } from '../../src/renderer/components/Composer'
import { CommandPalette } from '../../src/renderer/components/CommandPalette'
import { ConversationWork, WorkList, WorkDetail } from '../../src/renderer/views/Works'
import { MessageAttachment, AttachmentPreview } from '../../src/renderer/views/Media'
import { Conversation, Message } from '../../src/renderer/views/Conversation'
import { ComputerInspector } from '../../src/renderer/views/Computer'
import { Settings, type SettingsCategory } from '../../src/renderer/views/Settings'
import { Workspace } from '../../src/renderer/components/Workspace'
import { useCommands } from '../../src/renderer/state/commands'
import { WorkspaceSession, workspaceFor } from '../../src/renderer/state/workspace'
import { defaultPreferences } from '../../src/shared/desktop'
import appStyles from '../../src/renderer/App.module.css'
import messageStyles from '../../src/renderer/views/Conversation.module.css'
import type {
  ApiRead,
  Activity,
  AttachmentSource,
  ConversationBridge,
  Connection,
  Computer,
  CharacterStatus,
  CachedContent,
  EventsPage,
  Home,
  OutboxItem,
  PublicEvent,
  Profile,
  SoulDocument,
  SoulDraft,
  Work,
  WorkPage,
  WorkSteps,
} from '../../src/shared/api'
import '../../src/renderer/tokens.css'
import '../../src/renderer/materials/materials.css'

const document: SoulDocument = {
  file_name: 'SOUL.md',
  revision: 'original',
  active_revision: 'original',
  content: 'original content',
  writable: true,
  reason: null,
  updated_at: null,
  updated_by: '',
}
let draft: SoulDraft = {
  baseRevision: document.revision,
  baseContent: document.content,
  draft: 'unsaved original draft',
  remote: document,
}
let attempts = 0
let conversationDraft = ''
let reconnects = 0
let failReconnect = false
let submissions = 0
const reads: string[] = []
let mainHistoryReads = 0
const contentReads: AttachmentSource[] = []
const lateWorkReads: { kind: 'work' | 'steps'; workId: string }[] = []
const hintListeners = new Set<Parameters<ConversationBridge['onHint']>[0]>()
let lateReceipt = false
let holdNextSecondPage = false
let releaseSecondPage: (() => void) | undefined
const queries = new QueryClient()
const source = {
  binding_id: 'binding',
  conversation_id: 'conversation',
  display_name: 'original source',
  kind: 'private',
  platform: 'app',
  space_id: null,
}
const work: Work = {
  work_id: 'original-work',
  goal: 'Original active work',
  state: 'running',
  revision: 2,
  updated_at: 12345,
  generation: 1,
  child_count: 0,
  conversation_id: 'conversation',
  source,
  result_delivery: source,
  results: [
    { event_id: 31, conversation_id: 'conversation', text: 'Original result', artifacts: [] },
  ],
  budget: { models: 3, tools: 2, root_id: 'original-work', model_limit: null, tool_limit: null },
  waiting_kind: null,
  waiting_question: null,
  wait: null,
  help_requested: false,
  step_count: 1,
}
const home: Home = {
  main: {
    binding_id: 'binding',
    conversation_id: 'conversation',
    display_name: 'original entry',
    platform: 'app',
    generation: 1,
    revision: 1,
    latest_event_id: 31,
    status: 'active',
  },
  entries: [],
  snapshot_at: '2026-10-24T00:00:00Z',
  works: [
    work,
    { ...work, work_id: 'finished', goal: 'Original completed work', state: 'completed' },
  ],
}
const event: PublicEvent = {
  id: 31,
  event_id: 31,
  asr: [],
  attachments: [
    {
      attachment_index: 0,
      segment_index: 4,
      kind: 'record',
      filename: 'original.wav',
      sticker: false,
    },
  ],
  author_kind: 'person',
  author_person_id: 'person',
  binding_id: 'binding',
  conversation_id: 'conversation',
  content: '',
  text: '',
  event_kind: 'message',
  origin: 'user_message',
  direction: 'inbound',
  platform: 'app',
  created_at: '2026-10-24T00:00:00Z',
  observed_at: '2026-10-24T00:00:00Z',
  occurred_at: null,
}
const historicalWork: Work = {
  ...work,
  work_id: 'historical-work',
  goal: 'Completed work from the original message',
  state: 'completed',
}
const computerView: Computer = {
  snowluma_display: false,
  revision: 1,
  environment: 'running',
  display: 'running',
  control: { holder: 'none' },
  resources: { cpus: 1, memory_mib: 512 },
  help_requests: [],
  tabs_available: true,
  tabs: [
    {
      target_id: 'owned-tab',
      title: 'Original owned browser tab',
      url_host: 'example.invalid',
      ownership: 'work',
      work_id: work.work_id,
      work_state: work.state,
    },
    {
      target_id: 'completed-tab',
      title: 'Original completed browser tab',
      url_host: 'example.invalid',
      ownership: 'work',
      work_id: historicalWork.work_id,
      work_state: historicalWork.state,
    },
    {
      target_id: 'unknown-tab',
      title: 'Original unassigned browser tab',
      url_host: 'example.invalid',
      ownership: 'unknown',
      work_id: null,
      work_state: null,
    },
  ],
}
const activeWorkPage: WorkPage = { works: [work], next_before: null }
const historicalEvents: EventsPage = {
  generation: 1,
  revision: 3,
  latest_event_id: 32,
  next_after: 32,
  next_before: null,
  has_more: false,
  items: [
    {
      ...event,
      content: 'The original message still owns its completed work',
      attachments: [],
      work_ids: [historicalWork.work_id],
    },
    {
      ...event,
      id: 32,
      event_id: 32,
      direction: 'outbound',
      author_kind: 'yuki',
      author_person_id: null,
      content: 'The original result remains a separate message',
      attachments: [],
      work_ids: [historicalWork.work_id],
    },
  ],
}
const glassCase = 'conversation-glass'
// README images: the glass conversation with realistic work data (case=showcase).
const showcase = () => new URLSearchParams(location.search).get('case') === 'showcase'
const scene = () => (showcase() ? glassCase : new URLSearchParams(location.search).get('case'))
const showcaseTime = Date.parse('2026-11-11T08:00:00Z') / 1000
const showcaseAvatar = fetch(new URL('./showcase-avatar.png', import.meta.url))
  .then((response) => response.arrayBuffer())
  .then((buffer) => new Uint8Array(buffer))
const showcaseWorks: Work[] = [
  { goal: '每天早上 8 點整理科技新聞簡報', state: 'running', hours: 0.2 },
  { goal: '監督 Codex 修好登入頁的錯誤，跑完測試再回報', state: 'running', hours: 0.6 },
  { goal: '整理訪談筆記', state: 'completed', hours: 1 },
  { goal: '把週會錄音轉成逐字稿並列出待辦', state: 'completed', hours: 5 },
  { goal: '比較三家雲端主機的價格和流量限制', state: 'completed', hours: 26 },
].map(({ goal, state, hours }, index) => ({
  ...work,
  work_id: index === 2 ? 'historical-work' : `showcase-${index}`,
  goal,
  state,
  updated_at: showcaseTime - hours * 3600,
  results: [],
}))
const showcaseSteps = [
  ['terminal', '讀取 workspace/interviews 裡的 6 份訪談筆記'],
  ['terminal', '按主題分組：上手難度、價格、團隊協作'],
  ['terminal', '標出三個值得回訪的問題，附上原始段落'],
  ['terminal', '寫入 workspace/interviews/summary.md'],
].map(([category, label], index) => ({
  step_id: `showcase-step-${index}`,
  category,
  label,
  record: 'committed',
  status: 'succeeded',
  created_at: '2026-11-11T07:5' + index + ':00Z',
  updated_at: '2026-11-11T07:5' + index + ':30Z',
  artifacts: [],
}))
const glassConversation = '22222222-2222-4222-8222-222222222222'
const glassEntry = { ...home.main, conversation_id: glassConversation }
// `readonly=1` opens a QQ conversation of the same Yuki, which only the desktop one can continue.
const readonlyEntry = {
  ...home.main,
  conversation_id: '33333333-3333-4333-8333-333333333333',
  platform: 'qq',
  display_name: 'QQ 私聊',
}
if (new URLSearchParams(location.search).get('readonly'))
  workspaceFor('conversation-fixture')
    .getState()
    .patch({ conversationId: readonlyEntry.conversation_id })
const glassItems = [
  '幫我整理一下這週的訪談筆記。',
  '我先按主題分組，原始筆記和摘要會一起留著。',
  '好，請把值得回訪的問題另外標出來。',
  '已經標出三個可以追問的問題。原始訪談的來源也保留在各段下方。',
].map((content, index): PublicEvent => ({
  ...historicalEvents.items[index % 2]!,
  id: 31 + index,
  event_id: 31 + index,
  conversation_id: glassConversation,
  content,
  text: content,
  work_ids: index < 2 ? [historicalWork.work_id] : [],
}))
let glassOutbox: OutboxItem | undefined
let glassExecuting = false
function appendGlassMessage(
  content: string,
  incoming: boolean,
  picture?: { sticker: boolean; filename: string },
) {
  const eventId = glassItems.at(-1)!.event_id + 1
  glassItems.push({
    ...historicalEvents.items[incoming ? 1 : 0]!,
    id: eventId,
    event_id: eventId,
    conversation_id: glassConversation,
    content,
    // A sticker carries no text of its own; its content names it.
    text: picture?.sticker ? '' : content,
    work_ids: [],
    attachments: picture
      ? [
          {
            attachment_index: 0,
            segment_index: 0,
            kind: 'image',
            mime_type: 'image/svg+xml',
            ...picture,
          },
        ]
      : [],
  })
  for (const listener of hintListeners)
    listener('role', 'conversation', { ...glassEntry, latest_event_id: eventId })
}

const imageConversation = '11111111-1111-4111-8111-111111111111'
let imageAppended = false
let pendingConversationImage: { eventId: number; release(): void } | undefined
function imageEvents(last = imageAppended ? 1025 : 1024, only = false): EventsPage {
  const length = only ? 1 : last === 1025 ? 26 : 25
  const items = Array.from({ length }, (_, index) => {
    const eventId = only ? last : last - length + 1 + index
    const content =
      eventId === 900
        ? 'Original quoted image'
        : `${eventId === 1024 ? `[[yuki-ref conversation=${imageConversation} event=900]]\n` : ''}${eventId}: ${'original fixture message '.repeat(20)}`
    return {
      ...historicalEvents.items[1]!,
      id: eventId,
      event_id: eventId,
      conversation_id: imageConversation,
      content,
      text: content,
      work_ids: [],
      attachments: [900, 1024].includes(eventId)
        ? [
            {
              attachment_index: 0,
              segment_index: 0,
              kind: 'image' as const,
              filename: 'controlled.svg',
              sticker: false,
            },
          ]
        : [],
    }
  })
  return {
    ...historicalEvents,
    revision: imageAppended ? 2 : 1,
    latest_event_id: imageAppended ? 1025 : 1024,
    next_after: last,
    items,
  }
}
const profile: Profile = {
  id: 'role',
  display_name: 'Yuki',
  slug: 'yuki',
  bio: '',
  revision: 1,
  avatar_revision: 0,
  avatar: null,
  default_avatar: null,
  accent: { light: '#3a6bd6', dark: '#80a6ff' },
}
const characterStatus: CharacterStatus = {
  observed_at: '2026-10-25T00:00:00Z',
  revision: 1,
  mine: { live_conversations: [], works: {} },
  environment: {
    control: null,
    display: 'unavailable',
    generation: null,
    help_requested: null,
    state: 'unavailable',
  },
}
const activity: Activity = {
  conversation_id: 'conversation',
  evidence: 'idle',
  revision: 1,
  sources: [],
  step_kind: null,
}
const client: Pick<
  ConversationBridge,
  'soulDraft' | 'soulDocument' | 'soulCommands' | 'soulEdit' | 'onHint'
> = {
  soulDraft: async () => ({ ok: true, value: draft }),
  soulDocument: async () => ({ ok: true, value: { document, draft } }),
  soulCommands: async () => ({ ok: true, value: [] }),
  soulEdit: async (_id, value) => {
    attempts++
    if (attempts === 1) return { ok: false, code: 'fixture_write_failed' }
    draft = { ...value, remote: document }
    return { ok: true, value: draft }
  },
  onHint: (listener) => {
    hintListeners.add(listener)
    return () => {
      hintListeners.delete(listener)
    }
  },
}
Object.assign(window, {
  yuki: {
    connector: { state: async () => ({ ok: true, value: { available: false, bundled: true } }) },
    client: {
      ...client,
      avatarBytes: async () => ({ ok: true, value: await showcaseAvatar }),
      read: async (_id: string, route: ApiRead) => {
        reads.push(route.kind)
        if (route.kind === 'me') return { ok: true, value: { is_superuser: true } }
        if (showcase() && route.kind === 'works')
          return {
            ok: true,
            value: {
              works: showcaseWorks.filter((item) =>
                route.group === 'active' ? item.state !== 'completed' : item.state === 'completed',
              ),
              next_before: null,
            },
          }
        if (showcase() && route.kind === 'steps')
          return {
            ok: true,
            value: {
              steps: showcaseSteps,
              children: [],
              wait: null,
              work_revision: historicalWork.revision,
              steps_token: 'showcase',
              next_after: null,
            } as WorkSteps,
          }
        if (route.kind === 'events' && route.limit !== 1) mainHistoryReads++
        const mode = scene()
        if (mode === 'conversation-scroll') {
          if (route.kind === 'home')
            return {
              ok: true,
              value: {
                ...home,
                main: { ...home.main, conversation_id: imageConversation },
                works: [],
              },
            }
          if (route.kind === 'events')
            return {
              ok: true,
              value: imageEvents(
                route.before === 901 || route.after === 899 ? 900 : undefined,
                route.limit === 1,
              ),
            }
        }
        if (mode === 'late-work' || mode === 'late-work-combined') {
          if (route.kind === 'work' || route.kind === 'steps')
            lateWorkReads.push({ kind: route.kind, workId: route.workId })
          const token = lateReceipt ? 'with-original-late-receipt' : 'before-original-late-receipt'
          if (route.kind === 'work')
            return {
              ok: true,
              value: {
                ...historicalWork,
                step_count: lateReceipt ? 3 : 2,
                steps_token: token,
              } satisfies Work,
            }
          if (route.kind === 'steps') {
            const value = {
              steps: (route.after
                ? [
                    {
                      step_id: 'original-second-step',
                      label: 'Previously loaded second page step',
                    },
                    ...(lateReceipt
                      ? [
                          {
                            step_id: 'original-late-effect',
                            label: 'Original late effect receipt',
                          },
                        ]
                      : []),
                  ]
                : [{ step_id: 'original-first-step', label: 'Original first page step' }]
              ).map((step) => ({
                ...step,
                category: 'terminal',
                record: 'committed',
                status: 'succeeded',
                created_at: '2026-10-24T00:00:00Z',
                updated_at: '2026-10-24T00:00:00Z',
                artifacts: [],
              })),
              children: [],
              wait: null,
              work_revision: historicalWork.revision,
              steps_token: token,
              next_after: route.after ? null : 'original-second-page',
            } satisfies WorkSteps
            if (route.after && holdNextSecondPage) {
              holdNextSecondPage = false
              await new Promise<void>((resolve) => {
                releaseSecondPage = resolve
              })
            }
            return { ok: true, value }
          }
        }
        if (scene() === 'computer-inspector') {
          if (route.kind === 'computer') return { ok: true, value: computerView }
          if (route.kind === 'works') return { ok: true, value: activeWorkPage }
          if (route.kind === 'computer-files')
            return { ok: true, value: { path: '', items: [], next_cursor: null } }
        }
        if (
          [
            glassCase,
            'historical-work',
            'late-work-combined',
            'connection-reconnect',
            'conversation-scroll',
          ].includes(mode ?? '')
        ) {
          if (route.kind === 'home')
            return {
              ok: true,
              value: {
                ...home,
                main: mode === glassCase ? glassEntry : home.main,
                entries:
                  mode === glassCase && new URLSearchParams(location.search).get('readonly')
                    ? [readonlyEntry]
                    : home.entries,
                works: [],
              },
            }
          if (mode === glassCase && route.kind === 'events') {
            const latest = glassItems.at(-1)!.event_id
            return {
              ok: true,
              value: {
                ...historicalEvents,
                revision: latest,
                latest_event_id: latest,
                next_after: latest,
                items:
                  route.after === undefined
                    ? [...glassItems]
                    : glassItems
                        .filter((item) => item.event_id > route.after!)
                        .slice(0, route.limit),
              },
            }
          }
          if (route.kind === 'events')
            return {
              ok: true,
              value: {
                ...historicalEvents,
                items:
                  new URLSearchParams(location.search).get('events') === 'result'
                    ? historicalEvents.items.slice(1)
                    : historicalEvents.items,
              },
            }
          if (route.kind === 'work')
            return {
              ok: true,
              value:
                mode === glassCase
                  ? { ...historicalWork, goal: '整理訪談筆記', results: [] }
                  : historicalWork,
            }
          if (route.kind === 'character')
            return {
              ok: true,
              value: showcase()
                ? {
                    ...profile,
                    avatar: { sha256: 'showcase-avatar', sizes: {} } as Profile['avatar'],
                  }
                : profile,
            }
          if (route.kind === 'character-status') return { ok: true, value: characterStatus }
          if (route.kind === 'activity')
            return {
              ok: true,
              value: {
                ...activity,
                conversation_id: route.conversationId,
                evidence: mode === glassCase && glassExecuting ? 'executing' : 'idle',
              },
            }
        }
        if (route.kind === 'home') return { ok: true, value: home }
        if (route.kind === 'computer')
          return {
            ok: true,
            value: {
              // Another device holds the computer: this one may take it over or hand it back.
              control: {
                holder: 'human',
                device_id: 'other-device',
                device_label: '另一台電腦',
                device_online: true,
                lease_id: 'fixture-lease',
              },
              display: 'stopped',
              environment: 'running',
              help_requests: [],
              resources: null,
              revision: 1,
              snowluma_display: true,
              tabs: [],
              tabs_available: false,
            },
          }
        if (route.kind === 'work')
          return {
            ok: true,
            value: {
              ...work,
              ...(mode === 'work-help'
                ? { help_requested: new URLSearchParams(location.search).get('help') === 'true' }
                : {}),
            } satisfies Work,
          }
        if (route.kind === 'works')
          return {
            ok: true,
            value: {
              works: home.works.filter((item) =>
                route.group === 'active' ? item.state !== 'completed' : item.state === 'completed',
              ),
              next_before: null,
            },
          }
        if (route.kind === 'steps')
          return {
            ok: true,
            value: {
              steps: [
                {
                  step_id: 'original-public-step',
                  category: 'terminal',
                  label: 'Original terminal step',
                  record: 'committed',
                  status: 'succeeded',
                  created_at: '2026-10-24T00:00:00Z',
                  updated_at: '2026-10-24T00:00:00Z',
                  artifacts: [],
                },
              ],
              children: [],
              wait: null,
              next_after: null,
              steps_token: 'original-steps',
              work_revision: work.revision,
            },
          }
        throw Error('unexpected route')
      },
      workCommands: async () => ({ ok: true, value: [] }),
      computerCommands: async () => ({ ok: true, value: [] }),
      computerTicket: async () => ({ ok: false, code: 'fixture_only' }),
      keyboardCapture: async () => ({ ok: true, value: undefined }),
      workQuestionDrafts: async () => ({ ok: true, value: [] }),
      workDraft: async () => ({ ok: true, value: '' }),
      selected: async () => ({ ok: true, value: null }),
      draft: async (_id: string, value?: string) => {
        if (value !== undefined) conversationDraft = value
        return { ok: true, value: conversationDraft }
      },
      reconnect: async () => {
        reconnects++
        if (failReconnect) {
          failReconnect = false
          return { ok: false, code: 'fixture_reconnect_failed' }
        }
        for (const listener of hintListeners) listener('role', 'connection', { state: 'online' })
        return { ok: true, value: undefined }
      },
      submit: async () => {
        submissions++
        return { ok: false, code: 'fixture_only' }
      },
      send: async (_id: string, text: string) => {
        if (scene() !== glassCase) return { ok: false, code: 'fixture_only' }
        const requestId = crypto.randomUUID()
        submissions++
        glassOutbox = {
          requestId,
          body: { request_id: requestId, text, attachments: [] },
          payloadHash: '0'.repeat(64),
          state: 'accepted',
          eventId: glassItems.at(-1)!.event_id + 1,
          problem: null,
          createdAt: Date.parse(glassItems.at(-1)!.created_at),
        }
        return { ok: true, value: glassOutbox }
      },
      outbox: async () => ({ ok: true, value: glassOutbox ? [glassOutbox] : [] }),
      uploads: async () => ({ ok: true, value: [] }),
      letterDecoration: async () => ({ ok: true, value: null }),
      content: async (_id: string, value: AttachmentSource) => {
        contentReads.push(value)
        if (scene() === 'conversation-scroll')
          return new Promise((resolve) => {
            pendingConversationImage = {
              eventId: value.eventId,
              release: () =>
                resolve({
                  ok: true,
                  value: {
                    bytes: null,
                    filename: 'controlled.svg',
                    mime: 'image/svg+xml',
                    sha256: '0'.repeat(64),
                    preview: {
                      id: `controlled-${value.eventId}`,
                      url: '/delayed-conversation-image.svg',
                    },
                  } satisfies CachedContent,
                }),
            }
          })
        // The glass conversation's pictures: a tall sticker and a wide ordinary picture.
        const picture = glassItems.find((item) => item.event_id === value.eventId)?.attachments[0]
        if (picture)
          return {
            ok: true,
            value: {
              bytes: null,
              filename: picture.filename!,
              mime: 'image/svg+xml',
              sha256: '0'.repeat(64),
              preview: { id: `glass-${value.eventId}`, url: `/${picture.filename}` },
            } satisfies CachedContent,
          }
        return { ok: false, code: 'media_unavailable' }
      },
      releasePreview: async () => ({ ok: true, value: undefined }),
    },
    onCommand: () => () => {},
    loginItem: async () => ({
      ok: true,
      value: { enabled: false, available: false, reason: 'install-required' },
    }),
  },
  regression: {
    snapshot: () => ({
      draft,
      attempts,
      conversationDraft,
      reconnects,
      submissions,
      reads,
      mainHistoryReads,
      contentReads,
      lateWorkReads,
      heldSecondPage: !!releaseSecondPage,
      workStepsToken: queries.getQueryData<Work>(['role', 'work', historicalWork.work_id])
        ?.steps_token,
    }),
    holdNextSecondPage: () => {
      holdNextSecondPage = true
    },
    releaseSecondPage: () => {
      const release = releaseSecondPage
      releaseSecondPage = undefined
      release?.()
    },
    settleLateEffect: () => {
      lateReceipt = true
      for (const listener of hintListeners) listener('role', 'refresh', {})
    },
    connection: (state: 'online' | 'offline') => {
      for (const listener of hintListeners)
        listener('role', 'connection', {
          state,
          ...(state === 'offline' ? { code: 'transport_unknown' } : {}),
        })
    },
    failNextReconnect: () => {
      failReconnect = true
    },
    imagePending: (eventId: number) => pendingConversationImage?.eventId === eventId,
    releaseImage: () => pendingConversationImage!.release(),
    appendImageConversation: () => {
      imageAppended = true
      for (const listener of hintListeners) listener('role', 'refresh', {})
    },
    confirmGlassSend: () => {
      glassExecuting = true
      appendGlassMessage(glassOutbox!.body.text, false)
    },
    receiveGlassPicture: (content: string, sticker: boolean) =>
      appendGlassMessage(content, true, {
        sticker,
        filename: sticker ? 'sticker.svg' : 'picture.svg',
      }),
    receiveGlassReply: (text: string) => {
      glassExecuting = false
      appendGlassMessage(text, true)
      // The finished turn is the original request's result.
      if (glassOutbox) glassOutbox = { ...glassOutbox, state: 'result' }
      for (const listener of hintListeners) listener('role', 'outbox', {})
    },
  },
})

function Case() {
  const parameters = new URLSearchParams(location.search)
  const mode = scene()
  const [value, setValue] = useState('original message')
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [calls, setCalls] = useState(0)
  const [palette, setPalette] = useState(true)
  const [conversationSettings, setConversationSettings] = useState(false)
  const [category, setCategory] = useState<SettingsCategory>(
    parameters.get('category') === 'computer' ? 'computer' : 'general',
  )
  const [modelPage, setModelPage] = useState<'connections' | 'purposes' | 'usage'>('connections')
  const [selected, setSelected] = useState('')
  const [attachment, setAttachment] = useState<AttachmentSource>()
  const connection: Connection = {
    characterId: 'role',
    name: 'Yuki',
    baseUrl: 'https://example.invalid',
    personId: 'person',
    bindingId: 'binding',
    conversationId:
      mode === 'conversation-scroll'
        ? imageConversation
        : mode === glassCase
          ? glassConversation
          : 'conversation',
    persistentCredentials: false,
    ...(parameters.get('logout') === 'true'
      ? {
          deviceId: 'desktop-device',
          persistentCredentials: true,
          logout: { drafts: 1, pending: 0, attachments: 0 },
        }
      : {}),
  }
  const settingsConnection = mode === 'settings' && !connection.logout ? undefined : connection
  const openSettings = (next?: SettingsCategory) => {
    if (next) setCategory(next)
    setConversationSettings(true)
  }
  useCommands((command) => {
    if (command === 'settings') openSettings()
  })
  const settings = (
    <Settings
      boot={{
        nativeMaterial: 'none',
        platform: 'linux',
        version: 'fixture',
        deviceLabel: 'Fixture desktop',
        dark: false,
        reducedTransparency: false,
        highContrast: false,
        preferences,
        pairLink: null,
        openTarget: null,
      }}
      category={category}
      onCategory={setCategory}
      modelPage={modelPage}
      onModelPage={setModelPage}
      connections={settingsConnection ? [settingsConnection] : []}
      onSelect={() => {}}
      connection={settingsConnection}
      preferences={preferences}
      save={async (patch) => setPreferences((current) => ({ ...current, ...patch }))}
      back={() => setConversationSettings(false)}
      onConnection={() => {}}
      about={() => {}}
      onLoggedOut={async () => {}}
      onAddCharacter={() => setSelected('connect')}
      onDeployLocal={() => setSelected('deploy')}
    />
  )
  if (mode === 'settings-transition')
    return (
      <main className={appStyles.app}>
        <div
          data-testid="workspace-session"
          className={appStyles.roleSession}
          hidden={conversationSettings}
          inert={conversationSettings}
        >
          <WorkspaceSession scope="settings-transition-fixture" active={!conversationSettings}>
            <Workspace name="Yuki" status="" platform="linux" onSettings={() => openSettings()}>
              原對話內容
            </Workspace>
          </WorkspaceSession>
        </div>
        {conversationSettings && settings}
      </main>
    )
  if (mode === 'work-help')
    return (
      <>
        <WorkDetail
          id="role"
          platform="linux"
          workId={work.work_id}
          open={() => {}}
          replyInChat={() => {}}
          artifact={() => {}}
          computer={() => setCalls((value) => value + 1)}
        />
        <output data-testid="computer-open-count">{calls}</output>
      </>
    )
  if (mode === 'late-work')
    return (
      <WorkDetail
        id="role"
        platform="linux"
        workId={historicalWork.work_id}
        open={() => {}}
        replyInChat={() => {}}
        artifact={() => {}}
      />
    )
  if (mode === 'computer-inspector')
    return (
      <>
        <ComputerInspector id="role" work={setSelected} />
        <output data-testid="selected-work">{selected}</output>
      </>
    )
  if (
    [
      glassCase,
      'historical-work',
      'late-work-combined',
      'connection-reconnect',
      'conversation-scroll',
    ].includes(mode ?? '')
  )
    return (
      <main className={appStyles.app}>
        <div
          className={appStyles.roleSession}
          hidden={conversationSettings}
          inert={conversationSettings}
        >
          <WorkspaceSession scope="conversation-fixture" active={!conversationSettings}>
            <Conversation
              connection={connection}
              platform="linux"
              preferences={preferences}
              onSettings={openSettings}
              onPairAgain={() => {}}
            />
          </WorkspaceSession>
        </div>
        {conversationSettings && settings}
      </main>
    )
  if (mode === 'settings')
    return (
      <main className={appStyles.app}>
        {settings}
        <output data-testid="settings-action" hidden>
          {selected}
        </output>
      </main>
    )
  if (mode === 'messages') {
    const messages: PublicEvent[] = [
      { ...event, event_id: 1, content: 'First separate message', attachments: [] },
      { ...event, event_id: 2, content: 'Second separate message', attachments: [] },
      {
        ...event,
        event_id: 3,
        content:
          'A longer message\n\nWith a second paragraph and **Markdown**.\n\n```js\nconst value = 42\n```',
        attachments: [],
      },
      {
        ...event,
        event_id: 4,
        content: 'Another participant',
        asr: [
          { segment_index: 7, text: '第一段原始語音轉寫', source: 'fixture' },
          { segment_index: 9, text: '第二段原始語音轉寫', source: 'fixture' },
        ],
        author_person_id: 'other-person',
        sender_display_name: 'Other person',
        attachments: [],
      },
      {
        ...event,
        event_id: 5,
        content: 'First Yuki reply',
        direction: 'outbound',
        author_kind: 'yuki',
        author_person_id: null,
        attachments: [],
      },
      {
        ...event,
        event_id: 6,
        content: 'Second Yuki reply',
        direction: 'outbound',
        author_kind: 'yuki',
        author_person_id: null,
        attachments: [],
      },
    ]
    return (
      <div className={messageStyles.messages} role="log" aria-label="Message spacing sample">
        {messages.map((item, index) => (
          <Fragment key={item.event_id}>
            <Message
              characterId="role"
              viewerPersonId="person"
              event={item}
              name="Yuki"
              selected={false}
              consecutive={[1, 2, 5].includes(index)}
              onSelect={() => {}}
              onReference={() => {}}
              onAttachment={() => {}}
              onArtifact={() => {}}
              onJump={() => {}}
              verify={async () => {}}
            />
            {item.event_id === 5 && (
              <ConversationWork id="role" work={work} open={() => {}} reply={() => {}} />
            )}
          </Fragment>
        ))}
      </div>
    )
  }
  if (mode === 'soul') return <SoulEditor id="role" name="Yuki" platform="win32" back={() => {}} />
  if (mode === 'work')
    return (
      <>
        <WorkList id="role" open={setSelected} />
        {selected && (
          <WorkDetail
            id="role"
            platform="linux"
            workId={selected}
            open={setSelected}
            replyInChat={() => {}}
            artifact={() => {}}
          />
        )}
      </>
    )
  if (mode === 'media')
    return (
      <>
        <MessageAttachment
          id="role"
          event={event}
          attachment={event.attachments[0]!}
          open={setAttachment}
        />
        {attachment && (
          <AttachmentPreview id="role" source={attachment} close={() => setAttachment(undefined)} />
        )}
      </>
    )
  if (mode === 'palette')
    return (
      <>
        <output data-testid="calls">{calls}</output>
        {palette && (
          <CommandPalette
            character="role"
            commands={[
              { id: 'command', title: 'Open current work', run: () => setCalls((n) => n + 1) },
            ]}
            pick={async () => {}}
            close={() => setPalette(false)}
          />
        )}
      </>
    )
  return (
    <>
      <output data-testid="calls">{calls}</output>
      <Composer
        name="Yuki"
        platform="linux"
        draft={value}
        onDraft={setValue}
        onSubmit={async () => {
          setCalls((n) => n + 1)
          throw Error('fixture failure')
        }}
      />
    </>
  )
}
createRoot(window.document.getElementById('root')!).render(
  <QueryClientProvider client={queries}>
    <Case />
  </QueryClientProvider>,
)
