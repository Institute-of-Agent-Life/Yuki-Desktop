import type { EventsPage, Home, Profile, Work } from '../shared/api'
import type { NavigationTarget } from '../shared/desktop'
import type { Connections } from './connections'
import type { LocalStore } from './store'
import { ApiError } from './api/client'

interface Snapshot {
  latest: number
  works: Record<string, { state: Work['state']; revision: number; question: number | null }>
}
export interface ClientNotice {
  category: 'proactive' | 'waiting' | 'completed'
  title: string
  body: string
  target: NavigationTarget
}
export class ClientNotifications {
  private readonly pending = new Map<string, Promise<void>>()
  private readonly dirty = new Set<string>()
  private readonly paused = new Set<string>()
  private closed = false
  constructor(
    readonly store: LocalStore,
    readonly connections: Pick<Connections, 'connection' | 'read'>,
    readonly show: (notice: ClientNotice) => void,
  ) {}
  wake(id: string) {
    if (this.closed || this.paused.has(id)) return Promise.resolve()
    this.dirty.add(id)
    const previous = this.pending.get(id)
    if (previous) return previous
    const work = (async () => {
      do {
        this.dirty.delete(id)
        await this.refresh(id)
      } while (!this.closed && this.dirty.has(id))
    })().finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }
  private async refresh(id: string) {
    const connection = this.connections.connection(id),
      key = `notifications/${id}/${connection.personId}/${connection.bindingId}`
    const previous = this.store.get<Snapshot>(key),
      preferences = this.store.preferences()
    const [home, events, profile] = await Promise.all([
      this.connections.read<Home>(id, { kind: 'home' }, false),
      this.connections.read<EventsPage>(
        id,
        {
          kind: 'events',
          conversationId: connection.conversationId,
          before: Number.MAX_SAFE_INTEGER,
        },
        false,
      ),
      this.connections.read<Profile>(id, { kind: 'character' }, false),
    ])
    const next: Snapshot = {
      latest: Math.max(previous?.latest ?? 0, ...events.items.map((item) => item.event_id)),
      works: {},
    }
    const notices: ClientNotice[] = []
    const works = [...home.works]
    for (const workId of Object.keys(previous?.works ?? {}))
      if (!works.some((work) => work.work_id === workId)) {
        try {
          works.push(await this.connections.read<Work>(id, { kind: 'work', workId }, false))
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'not_found') throw error
        }
      }
    for (const work of works) {
      const old = previous?.works[work.work_id],
        target = { characterId: id, view: 'works' as const, workId: work.work_id }
      if (!['completed', 'failed', 'cancelled'].includes(work.state))
        next.works[work.work_id] = {
          state: work.state,
          revision: work.revision,
          question: work.waiting_question?.event_id ?? null,
        }
      if (previous) {
        if (work.state === 'completed' && old?.state !== 'completed' && preferences.notifyCompleted)
          notices.push({
            category: 'completed',
            title: `${profile.display_name} · 工作完成`,
            body: work.goal,
            target,
          })
        if (
          work.state === 'waiting_user' &&
          (old?.state !== 'waiting_user' ||
            old?.question !== (work.waiting_question?.event_id ?? null)) &&
          preferences.notifyWaiting
        )
          notices.push({
            category: 'waiting',
            title: `${profile.display_name} · 等待你回覆`,
            body: work.waiting_question?.text ?? work.goal,
            target,
          })
      }
    }
    const proactive =
      previous &&
      events.items
        .filter(
          (item) =>
            item.event_id > previous.latest &&
            item.direction === 'outbound' &&
            ['self_initiative', 'scheduled_automation', 'plugin_background'].includes(item.origin),
        )
        .at(-1)
    if (proactive && preferences.notifyProactive)
      notices.push({
        category: 'proactive',
        title: profile.display_name,
        body: '主動傳來了新訊息。',
        target: { characterId: id, view: 'chat', conversationId: connection.conversationId },
      })
    // These are local presentation watermarks, never command or delivery receipts.
    if (this.closed || this.paused.has(id)) return
    this.store.set(key, next)
    notices.forEach(this.show)
  }
  close() {
    this.closed = true
    this.dirty.clear()
    return Promise.allSettled(this.pending.values())
  }
  async pause(id: string) {
    this.paused.add(id)
    this.dirty.delete(id)
    await this.pending.get(id)?.catch(() => {})
  }
  resume(id: string) {
    this.paused.delete(id)
  }
}
