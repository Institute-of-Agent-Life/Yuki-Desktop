import type { QueryClient } from '@tanstack/react-query'
import type {
  ArtifactPage,
  ArtifactSource,
  EventsPage,
  Home,
  PublicEvent,
  Work,
  WorkPage,
} from '../../shared/api'
import type { components } from '../../shared/contract.gen'
import { parseMessage } from '../../shared/message'
import { hidesPrivateData } from '../queries/client'

export type LoadedItem =
  | {
      kind: 'message'
      id: string
      title: string
      detail: string
      at: number
      conversationId: string
      event: PublicEvent
    }
  | { kind: 'work'; id: string; title: string; detail: string; at: number; work: Work }
  | { kind: 'file'; id: string; title: string; detail: string; at: number; source: ArtifactSource }
const timestamp = (value: number | string) =>
  typeof value === 'number' ? value * 1000 : Date.parse(value)

// Inspect the existing cache only. Opening or typing in the palette never
// starts a request, loads another page or creates a second search index.
export function loadedItems(client: QueryClient, character: string): LoadedItem[] {
  const queries = client
    .getQueryCache()
    .getAll()
    .filter((query) => query.queryKey[0] === character)
  const entries = new Map<string, Home['main']>()
  for (const query of queries) {
    if (query.queryKey[1] === 'home' && query.state.data) {
      const home = query.state.data as Home
      for (const entry of [home.main, ...home.entries]) entries.set(entry.conversation_id, entry)
    }
  }
  const sync = client.getQueryData<components['schemas']['SyncHint']>([character, 'sync'])
  if (sync) {
    const previous = new Map(entries)
    entries.clear()
    // C12 uses the same complete private-entry query as /home. An entry absent
    // from this actual owner snapshot must not be revived by an older page.
    for (const entry of sync.conversations) {
      const other = previous.get(entry.conversation_id)
      entries.set(
        entry.conversation_id,
        other &&
          (other.generation > entry.generation ||
            (other.generation === entry.generation && other.revision > entry.revision))
          ? other
          : entry,
      )
    }
  }
  const messages = new Map<string, LoadedItem>(),
    works = new Map<string, Work>(),
    files = new Map<string, LoadedItem>()
  const denied = new Set(
    queries
      .filter((query) => query.queryKey[1] === 'work' && hidesPrivateData(query.state.error))
      .map((query) => String(query.queryKey[2])),
  )
  const addWork = (work: Work) => {
    if (
      !denied.has(work.work_id) &&
      (!works.has(work.work_id) || works.get(work.work_id)!.revision <= work.revision)
    )
      works.set(work.work_id, work)
  }
  const addMessage = (conversationId: string, event: PublicEvent) => {
    const id = `message/${conversationId}/${event.event_id}`
    messages.set(id, {
      kind: 'message',
      id,
      title: parseMessage(event.display_text ?? event.text).text || '附件訊息',
      detail:
        entries.get(conversationId)?.display_name ||
        (event.platform === 'app' ? '桌面對話' : event.platform.toUpperCase()),
      at: timestamp(event.created_at),
      conversationId,
      event,
    })
  }
  for (const query of queries) {
    if (!query.state.data || hidesPrivateData(query.state.error)) continue
    const kind = query.queryKey[1],
      data = query.state.data
    if (kind === 'events') {
      const page = data as EventsPage,
        conversationId = String(query.queryKey[2]),
        current = entries.get(conversationId)
      if (
        (sync && !current) ||
        (current && (page.generation !== current.generation || page.revision !== current.revision))
      )
        continue
      for (const event of page.items) addMessage(conversationId, event)
    } else if (kind === 'home') for (const work of (data as Home).works) addWork(work)
    else if (kind === 'work') addWork(data as Work)
    else if (kind === 'works')
      for (const page of (data as { pages: WorkPage[] }).pages)
        for (const work of page.works) addWork(work)
    else if (kind === 'artifacts')
      for (const page of (data as { pages: ArtifactPage[] }).pages)
        for (const item of page.items) {
          const id = `file/${item.artifact_id}/${item.version}`
          files.set(id, {
            kind: 'file',
            id,
            title: item.name,
            detail: `${item.artifact_id.slice(0, 8)} · ${item.version.slice(0, 8)} · ${item.published_path ?? item.media_type}`,
            at: timestamp(item.created_at),
            source: { artifactId: item.artifact_id, version: item.version },
          })
        }
  }
  for (const hint of sync?.works ?? []) {
    const cached = works.get(hint.work_id)
    if (cached && cached.revision < hint.revision) works.delete(hint.work_id)
  }
  return [
    ...messages.values(),
    ...[...works.values()].map((work) => ({
      kind: 'work' as const,
      id: `work/${work.work_id}`,
      title: work.goal,
      detail:
        work.source.display_name ||
        (work.source.platform === 'app'
          ? '桌面對話'
          : (work.source.platform?.toUpperCase() ?? '原入口')),
      at: timestamp(work.updated_at),
      work,
    })),
    ...files.values(),
  ].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
}
