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
      const first = await read(before ?? Number.MAX_SAFE_INTEGER)
      let current = first,
        items = first.items
      // Re-read only the visible range. Edits and deletions replace cached facts.
      while (
        floor !== undefined &&
        current.has_more &&
        current.next_before !== null &&
        items.length > 0 &&
        items[0]!.event_id > floor
      ) {
        current = await read(current.next_before)
        items = [...current.items, ...items]
      }
      return { ...current, items: uniqueEvents(items) }
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
      return { ...next, items }
    },
  }
}

function uniqueEvents(items: EventsPage['items']) {
  return [...new Map(items.map((item) => [item.event_id, item])).values()].sort(
    (a, b) => a.event_id - b.event_id,
  )
}
