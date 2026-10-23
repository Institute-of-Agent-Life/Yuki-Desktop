import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SoulEditor } from '../../src/renderer/views/SoulEditor'
import { Composer } from '../../src/renderer/components/Composer'
import { CommandPalette } from '../../src/renderer/components/CommandPalette'
import { WorkList, WorkDetail } from '../../src/renderer/views/Works'
import { MessageAttachment, AttachmentPreview } from '../../src/renderer/views/Media'
import type { ApiRead, AttachmentSource, ConversationBridge, Home, PublicEvent, SoulDocument, SoulDraft, Work } from '../../src/shared/api'
import '../../src/renderer/tokens.css'

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
const reads: string[] = []
const contentReads: AttachmentSource[] = []
const source = { binding_id: 'binding', conversation_id: 'conversation', display_name: 'original source', kind: 'private', platform: 'app', space_id: null }
const work: Work = {
  work_id: 'original-work', goal: 'Original active work', state: 'running', revision: 2,
  updated_at: 12345, generation: 1, child_count: 0, conversation_id: 'conversation',
  source, result_delivery: source, results: [{ event_id: 31, conversation_id: 'conversation', text: 'Original result', artifacts: [] }],
  budget: { models: 3, tools: 2, root_id: 'original-work', model_limit: null, tool_limit: null },
  waiting_kind: null, waiting_question: null,
}
const home: Home = {
  main: { binding_id: 'binding', conversation_id: 'conversation', display_name: 'original entry', platform: 'app', generation: 1, revision: 1, latest_event_id: 31, status: 'active' },
  entries: [], snapshot_at: '2026-10-24T00:00:00Z', works: [work, { ...work, work_id: 'finished', goal: 'Original completed work', state: 'completed' }],
}
const event: PublicEvent = {
  id: 31, event_id: 31, asr: [], attachments: [{ attachment_index: 0, segment_index: 4, kind: 'record', filename: 'original.wav' }],
  author_kind: 'person', author_person_id: 'person', binding_id: 'binding', conversation_id: 'conversation',
  content: '', text: '', event_kind: 'message', origin: 'user_message', direction: 'inbound', platform: 'app',
  created_at: '2026-10-24T00:00:00Z', observed_at: '2026-10-24T00:00:00Z', occurred_at: null,
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
  onHint: () => () => {},
}
Object.assign(window, {
  yuki: { client: { ...client,
    read: async (_id: string, route: ApiRead) => { reads.push(route.kind); if (route.kind === 'home') return { ok: true, value: home }; if (route.kind === 'work') return { ok: true, value: work }; throw Error('unexpected route') },
    workCommands: async () => ({ ok: true, value: [] }),
    workQuestionDrafts: async () => ({ ok: true, value: [] }),
    workDraft: async () => ({ ok: true, value: '' }),
    content: async (_id: string, value: AttachmentSource) => { contentReads.push(value); return { ok: false, code: 'media_unavailable' } },
  }, onCommand: () => () => {} },
  regression: { snapshot: () => ({ draft, attempts, reads, contentReads }) },
})

function Case() {
  const [value, setValue] = useState('original message')
  const [calls, setCalls] = useState(0)
  const [selected, setSelected] = useState('')
  const [attachment, setAttachment] = useState<AttachmentSource>()
  const mode = new URLSearchParams(location.search).get('case')
  if (mode === 'soul') return <SoulEditor id="role" name="Yuki" platform="win32" back={() => {}} />
  if (mode === 'work') return <><WorkList id="role" open={setSelected} />{selected && <WorkDetail id="role" workId={selected} replyInChat={() => {}} artifact={() => {}} />}</>
  if (mode === 'media') return <><MessageAttachment id="role" event={event} attachment={event.attachments[0]!} open={setAttachment} />{attachment && <AttachmentPreview id="role" source={attachment} close={() => setAttachment(undefined)} />}</>
  if (mode === 'palette')
    return (
      <>
        <output data-testid="calls">{calls}</output>
        <CommandPalette
          character="role"
          commands={[
            { id: 'command', title: 'Open current work', run: () => setCalls((n) => n + 1) },
          ]}
          pick={async () => {}}
          close={() => {}}
        />
      </>
    )
  return (
    <>
      <output data-testid="calls">{calls}</output>
      <Composer
        name="Yuki"
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
  <QueryClientProvider client={new QueryClient()}>
    <Case />
  </QueryClientProvider>,
)
