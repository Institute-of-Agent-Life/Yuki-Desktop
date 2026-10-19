import { afterEach, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Home, PublicEvent, EventsPage } from '../../src/shared/api'
import { loadedItems } from '../../src/renderer/state/loaded'
import { readHistoryRange } from '../../src/renderer/queries/history'
const clients: QueryClient[] = []
afterEach(() => clients.splice(0).forEach((client) => client.clear()))
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
const event = (id: number, text: string): PublicEvent => ({
  event_id: id,
  conversation_id: conversation,
  binding_id: a,
  platform: 'app',
  direction: 'inbound',
  origin: 'user_message',
  author_kind: 'person',
  text,
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
    character_revision: 1,
    computer_revision: null,
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
    character_revision: 1,
    computer_revision: null,
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
    character_revision: 1,
    computer_revision: null,
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
  expect(loadedItems(client, a).filter((item) => item.kind === 'file')).toHaveLength(2)
  expect(loadedItems(client, a).every((item) => item.title === 'same.md')).toBe(true)
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
  expect(result.items.some((item) => item.text === 'deleted original')).toBe(false)
})
