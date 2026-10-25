import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { EventsPage } from '../../shared/api'
import { unwrap } from './client'

export function useHistory(characterId: string, conversationId: string, before: number | null) {
  const floors = useRef(new Map<string, number>())
  const range = `${conversationId}/${before ?? 'latest'}`
  const key = [characterId, 'events', conversationId, before] as const
  const read = (cursor: number) =>
    window.yuki.client
      .read<EventsPage>(characterId, { kind: 'events', conversationId, before: cursor, limit: 50 })
      .then(unwrap)
  const events = useQuery({
    queryKey: key,
    queryFn: async () => {
      const floor = floors.current.get(range)
      return readHistoryRange(read, before ?? Number.MAX_SAFE_INTEGER, floor)
    },
  })
  return {
    ...events,
    key,
    async earlier(page: EventsPage) {
      if (!page.has_more || page.next_before === null) return page
      const next = await read(page.next_before)
      const items = uniqueEvents([...next.items, ...page.items])
      if (items.length) floors.current.set(range, items[0]!.event_id)
      if (next.generation !== page.generation || next.revision !== page.revision)
        return readHistoryRange(read, before ?? Number.MAX_SAFE_INTEGER, items[0]?.event_id)
      return { ...next, latest_event_id: page.latest_event_id, items }
    },
  }
}

export async function readHistoryRange(
  read: (cursor: number) => Promise<EventsPage>,
  before: number,
  floor?: number,
): Promise<EventsPage> {
  for (;;) {
    const first = await read(before)
    let current = first,
      items = first.items,
      changed = false
    // A page fetched after an edit cannot stamp older cached bodies with its
    // newer revision. Read the requested range again using one actual snapshot.
    while (
      floor !== undefined &&
      current.has_more &&
      current.next_before !== null &&
      items.length > 0 &&
      items[0]!.event_id > floor
    ) {
      const next = await read(current.next_before)
      if (next.generation !== first.generation || next.revision !== first.revision) {
        changed = true
        break
      }
      current = next
      items = [...next.items, ...items]
    }
    if (!changed)
      return { ...current, latest_event_id: first.latest_event_id, items: uniqueEvents(items) }
  }
}

function uniqueEvents(items: EventsPage['items']) {
  return [...new Map(items.map((item) => [item.event_id, item])).values()].sort(
    (a, b) => a.event_id - b.event_id,
  )
}
