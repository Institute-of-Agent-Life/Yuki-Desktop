import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Home, PublicEvent, EventsPage, Work } from '../../src/shared/api'
import { loadedItems } from '../../src/renderer/state/loaded'
import { readHistoryRange, useHistory } from '../../src/renderer/queries/history'
const clients: QueryClient[] = []
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.unstubAllGlobals()
})
const a = '00000000-0000-4000-8000-000000000001',
  b = '00000000-0000-4000-8000-000000000002',
  conversation = '00000000-0000-4000-8000-000000000003'
const entry: Home['main'] = {
  binding_id: a,
  conversation_id: conversation,
  display_name: '原本人入口',
  generation: 1,
  latest_event_id: 3,
  platform: 'app',
  revision: 1,
  status: 'active',
}
const event = (id: number, content: string): PublicEvent => ({
  id,
  event_id: id,
  event_kind: 'message',
  author_person_id: a,
  asr: [],
  content,
  observed_at: '2026-10-19T00:00:00Z',
  occurred_at: null,
  conversation_id: conversation,
  binding_id: a,
  platform: 'app',
  direction: 'inbound',
  origin: 'user_message',
  author_kind: 'person',
  text: content,
  attachments: [],
  created_at: '2026-10-19T00:00:00Z',
})
const page = (revision: number, items: PublicEvent[], cursor: number | null): EventsPage => ({
  generation: 1,
  revision,
  items,
  has_more: cursor !== null,
  next_before: cursor,
  next_after: items.at(-1)?.event_id ?? 0,
  latest_event_id: 3,
})
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData([a, 'home'], {
    main: entry,
    entries: [],
    works: [],
    snapshot_at: '2026-10-19T00:00:00Z',
  } satisfies Home)
  return client
}
it('uses only the chosen character loaded pages; sync revisions remove deleted message bodies without discarding unchanged cached conversations', async () => {
  const client = setup()
  client.setQueryData(
    [a, 'events', conversation, null],
    page(1, [event(1, 'original private message')], null),
  )
  client.setQueryData(
    [b, 'events', conversation, null],
    page(1, [event(2, 'another character private message')], null),
  )
  client.setQueryData([a, 'sync'], {
    conversations: [entry],
    works: [],
    activity: [],
  })
  expect(loadedItems(client, a).map((item) => item.title)).toEqual(['original private message'])
  void client.invalidateQueries({ queryKey: [a, 'events'], refetchType: 'none' })
  expect(loadedItems(client, a).map((item) => item.title)).toEqual(['original private message'])
  await expect(
    client.fetchQuery({
      queryKey: [a, 'events', conversation, null],
      queryFn: async () => {
        throw Error('network unavailable')
      },
    }),
  ).rejects.toThrow('network unavailable')
  expect(loadedItems(client, a).map((item) => item.title)).toEqual(['original private message'])
  client.setQueryData([a, 'sync'], {
    conversations: [{ ...entry, revision: 2 }],
    works: [],
    activity: [],
  })
  expect(loadedItems(client, a)).toEqual([])
  client.setQueryData(
    [a, 'events', conversation, null],
    page(2, [event(3, 'current original event')], null),
  )
  expect(loadedItems(client, a).map((item) => item.title)).toEqual(['current original event'])
  client.setQueryData([a, 'sync'], {
    conversations: [],
    works: [],
    activity: [],
  })
  expect(loadedItems(client, a)).toEqual([])
})
it('keeps same-named files separate by immutable artifact ID and version instead of inventing another search index', () => {
  const client = setup(),
    artifact = (id: string) => ({
      artifact_id: id,
      version: 'a'.repeat(64),
      name: 'same.md',
      media_type: 'text/markdown',
      published_path: '/published/same.md',
      created_at: '2026-10-19T00:00:00Z',
    })
  client.setQueryData([a, 'artifacts', 'all'], {
    pages: [{ items: [artifact(a), artifact(b)], next_cursor: null }],
    pageParams: [null],
  })
  client.setQueryData([a, 'artifacts', 'document'], {
    pages: [{ items: [artifact(a)], next_cursor: null }],
    pageParams: [null],
  })
  const origin = {
    conversation_id: conversation,
    binding_id: a,
    display_name: 'Original source',
    kind: 'private',
    platform: 'app',
    space_id: null,
  }
  const work: Work = {
    work_id: 'original-work',
    conversation_id: conversation,
    generation: 1,
    state: 'completed',
    revision: 1,
    goal: 'Original work',
    source: origin,
    result_delivery: origin,
    child_count: 0,
    waiting_kind: null,
    waiting_question: null,
    updated_at: 1,
    budget: { root_id: 'original-work', models: 1, model_limit: null, tools: 0, tool_limit: null },
    results: [
      {
        event_id: 1,
        conversation_id: conversation,
        text: 'Original result',
        artifacts: [{ artifact_id: a, version: 'a'.repeat(64) }],
      },
    ],
  }
  client.setQueryData([a, 'works', 'ended', 'all'], {
    pages: [{ works: [work], next_before: null }],
    pageParams: [null],
  })
  const files = loadedItems(client, a).filter((item) => item.kind === 'file')
  expect(files).toHaveLength(2)
  expect(files.every((item) => item.title === 'same.md')).toBe(true)
  expect(files.every((item) => item.detail.includes('/published/same.md'))).toBe(true)
  expect(
    loadedItems(client, a).some(
      (item) => item.kind === 'work' && item.work.work_id === work.work_id,
    ),
  ).toBe(true)
})
it('history pagination never stamps an old deleted body with a newer page revision', async () => {
  const responses = [
      page(1, [event(2, 'deleted original'), event(3, 'later event')], 2),
      page(2, [event(1, 'earlier event')], null),
      page(2, [event(3, 'later event')], 3),
      page(2, [event(1, 'earlier event')], null),
    ],
    cursors: number[] = []
  const result = await readHistoryRange(
    async (cursor) => {
      cursors.push(cursor)
      const response = responses.shift()
      if (!response) throw Error('unexpected additional read')
      return response
    },
    Number.MAX_SAFE_INTEGER,
    1,
  )
  expect(result.revision).toBe(2)
  expect(result.items.map((item) => item.event_id)).toEqual([1, 3])
  expect(cursors).toEqual([Number.MAX_SAFE_INTEGER, 2, Number.MAX_SAFE_INTEGER, 3])
  expect(result.items.some((item) => item.content === 'deleted original')).toBe(false)
})

it('a history range keeps its read head when an append advances an older page watermark', async () => {
  const responses = [
    { ...page(3, [event(100, 'read head')], 100), latest_event_id: 100 },
    { ...page(3, [event(99, 'earlier event')], null), latest_event_id: 101 },
  ]
  const result = await readHistoryRange(
    async () => {
      const response = responses.shift()
      if (!response) throw Error('unexpected additional read')
      return response
    },
    Number.MAX_SAFE_INTEGER,
    99,
  )
  expect(result.latest_event_id).toBe(100)
  expect(result.items.map((item) => item.event_id)).toEqual([99, 100])
  expect(result).toMatchObject({ has_more: false, next_before: null })
})

it('loading an earlier page keeps the current head while its server watermark advances', async () => {
  const current = { ...page(3, [event(100, 'read head')], 100), latest_event_id: 100 }
  const earlier = { ...page(3, [event(99, 'earlier event')], null), latest_event_id: 101 }
  vi.stubGlobal('window', {
    yuki: { client: { read: async () => ({ ok: true, value: earlier }) } },
  })
  let loadEarlier!: ReturnType<typeof useHistory>['earlier']
  function Probe() {
    loadEarlier = useHistory(a, conversation, null).earlier
    return null
  }
  renderToString(createElement(QueryClientProvider, { client: setup() }, createElement(Probe)))
  const result = await loadEarlier(current)
  expect(result.latest_event_id).toBe(100)
  expect(result.items.map((item) => item.event_id)).toEqual([99, 100])
  expect(result).toMatchObject({ has_more: false, next_before: null })
})
