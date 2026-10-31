import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClientNotifications, type ClientNotice } from '../../src/main/notifications'
import { LocalStore } from '../../src/main/store'
import { ApiError } from '../../src/main/api/client'
import type {
  ApiRead,
  Connection,
  EventsPage,
  Home,
  Profile,
  PublicEvent,
} from '../../src/shared/api'
import type { components } from '../../src/shared/contract.gen'
import { validateFixture } from '../fixtures/schema'

const id = '00000000-0000-4000-8000-000000000001',
  person = '00000000-0000-4000-8000-000000000002',
  binding = '00000000-0000-4000-8000-000000000003',
  conversation = '00000000-0000-4000-8000-000000000004',
  workId = '00000000-0000-4000-8000-000000000005'
type Work = components['schemas']['Work']
const source = {
  binding_id: binding,
  conversation_id: conversation,
  display_name: '本人入口名稱',
  kind: 'private',
  platform: 'app',
  space_id: null,
}
function work(patch: Partial<Work> = {}): Work {
  return {
    budget: { model_limit: null, models: 0, root_id: workId, tool_limit: null, tools: 0 },
    child_count: 0,
    conversation_id: conversation,
    generation: 1,
    goal: '原工作目標',
    help_requested: false,
    result_delivery: source,
    results: [],
    revision: 1,
    source,
    state: 'running',
    updated_at: 1,
    waiting_kind: null,
    waiting_question: null,
    work_id: workId,
    ...patch,
  }
}
function event(event_id: number, origin: string): PublicEvent {
  return {
    attachments: [],
    author_kind: 'yuki',
    id: event_id,
    event_kind: 'message',
    author_person_id: null,
    content: 'original outbound',
    asr: [],
    observed_at: '2026-10-19T00:00:00Z',
    occurred_at: '2026-10-19T00:00:00Z',
    binding_id: binding,
    conversation_id: conversation,
    created_at: '2026-10-19T00:00:00Z',
    direction: 'outbound',
    event_id,
    origin,
    platform: 'app',
    text: 'original outbound',
  }
}
const resources: { path: string; store: LocalStore }[] = []
function setup(initial: Work[] = [work()]) {
  const path = mkdtempSync(join(tmpdir(), 'yd-notices-')),
    store = new LocalStore(join(path, 'local.sqlite3'))
  resources.push({ path, store })
  const connection: Connection = {
    characterId: id,
    personId: person,
    bindingId: binding,
    conversationId: conversation,
    name: '舊角色名稱',
    persistentCredentials: false,
    baseUrl: 'http://localhost/role',
  }
  const entry: Home['main'] = {
    binding_id: binding,
    conversation_id: conversation,
    display_name: '這是本人而不是角色',
    generation: 1,
    latest_event_id: 0,
    platform: 'app',
    revision: 1,
    status: 'active',
  }
  const home: Home = {
    entries: [entry],
    main: entry,
    snapshot_at: '2026-10-19T00:00:00Z',
    works: initial,
  }
  const profile: Profile = {
    accent: { light: '#123456', dark: '#abcdef' },
    avatar: null,
    avatar_revision: 0,
    bio: '',
    default_avatar: null,
    display_name: '目前角色',
    id,
    revision: 1,
    slug: 'role',
  }
  const events: EventsPage = {
    generation: 1,
    has_more: false,
    items: [],
    latest_event_id: 0,
    next_after: 0,
    next_before: null,
    revision: 1,
  }
  const ended = new Map<string, Work>(),
    shown: ClientNotice[] = [],
    reads: string[] = []
  let failure: string | undefined
  async function read<T>(_id: string, route: ApiRead, offlineCache?: boolean): Promise<T> {
    expect(offlineCache).toBe(false)
    reads.push(route.kind)
    if (route.kind === 'work') {
      if (failure) throw new ApiError(failure)
      const row = ended.get(route.workId)
      if (!row) throw new ApiError('not_found')
      validateFixture('Envelope_Work_', { data: row })
      return structuredClone(row) as T
    }
    const [schema, value] =
      route.kind === 'home'
        ? ['Envelope_Home_', home]
        : route.kind === 'character'
          ? ['Envelope_CharacterProfile_', profile]
          : ['Envelope_Events_', events]
    validateFixture(schema as string, { data: value })
    return structuredClone(value) as T
  }
  const client = { connection: () => connection, read }
  return {
    client,
    store,
    home,
    profile,
    events,
    ended,
    shown,
    reads,
    create: () => new ClientNotifications(store, client, (notice) => shown.push(notice)),
    fail: (code?: string) => {
      failure = code
    },
  }
}
afterEach(() => {
  for (const { path, store } of resources.splice(0)) {
    store.db.close()
    rmSync(path, { recursive: true, force: true })
  }
})

it('uses live facts for help without treating wait-control as a help request, and finds a completed Work missing from active home', async () => {
  const facts = setup(),
    service = facts.create()
  await service.wake(id)
  facts.home.works = [
    work({
      state: 'waiting_external',
      revision: 2,
      wait: {
        mode: 'all',
        conditions: [{ kind: 'owned_run', run_kind: 'wait_control' }],
        since: '2026-10-19T00:00:00Z',
        deadline_at: null,
      },
    }),
  ]
  await service.wake(id)
  expect(facts.shown).toEqual([])
  facts.home.works = [work({ state: 'waiting_external', revision: 2, help_requested: true })]
  await service.wake(id)
  expect(facts.shown).toMatchObject([
    {
      category: 'help',
      title: '目前角色 · 需要你幫忙',
      target: { characterId: id, view: 'computer', workId },
    },
  ])
  await facts.create().wake(id)
  expect(facts.shown).toHaveLength(1)
  facts.home.works = []
  facts.ended.set(workId, work({ state: 'completed', revision: 3 }))
  await service.wake(id)
  expect(facts.shown.at(-1)).toMatchObject({
    category: 'completed',
    target: { workId, view: 'works' },
  })
  await service.wake(id)
  expect(facts.shown).toHaveLength(2)
})
it('does not lose the last active Work when its completion GET temporarily fails', async () => {
  const facts = setup(),
    service = facts.create()
  await service.wake(id)
  facts.home.works = []
  facts.ended.set(workId, work({ state: 'completed', revision: 2 }))
  facts.fail('transport_unknown')
  await expect(service.wake(id)).rejects.toThrow('transport_unknown')
  expect(facts.shown).toEqual([])
  facts.fail()
  await service.wake(id)
  expect(facts.shown.map((notice) => notice.category)).toEqual(['completed'])
})
it('notifies about a newly waiting Work and a different question without replaying the previous question', async () => {
  const facts = setup([]),
    service = facts.create()
  await service.wake(id)
  const question = { artifacts: [], conversation_id: conversation, event_id: 15, text: '原問題' }
  facts.home.works = [work({ state: 'waiting_user', waiting_question: question })]
  await service.wake(id)
  await service.wake(id)
  facts.home.works = [
    work({
      state: 'waiting_user',
      revision: 7,
      waiting_question: { ...question, event_id: 21, text: '下一個真問題' },
    }),
  ]
  await service.wake(id)
  expect(facts.shown.map((notice) => notice.body)).toEqual(['原問題', '下一個真問題'])
})
it('keeps proactive notification watermarks across restarts and honors disabled categories', async () => {
  const facts = setup([]),
    service = facts.create()
  facts.events.items = [event(1, 'self_initiative')]
  await service.wake(id)
  facts.events.items.push(event(2, 'user_message'))
  await service.wake(id)
  expect(facts.shown).toEqual([])
  facts.events.items.push(event(3, 'self_initiative'))
  await facts.create().wake(id)
  expect(facts.shown).toMatchObject([
    {
      category: 'proactive',
      title: '目前角色',
      target: { characterId: id, conversationId: conversation },
    },
  ])
  facts.store.set('appearance', { notifyProactive: false, notifyHelp: false })
  facts.events.items.push(event(4, 'self_initiative'))
  facts.home.works = [work({ help_requested: true })]
  await service.wake(id)
  expect(facts.shown).toHaveLength(1)
})

it('pausing a role drains its pending read and suppresses both late notifications and their presentation watermark', async () => {
  const fixture = setup([]),
    notifications = fixture.create()
  await notifications.wake(id)
  const key = `notifications/${id}/${person}/${binding}`,
    before = fixture.store.get(key)
  fixture.events.items = [event(1, 'self_initiative')]
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
      release = resolve
    }),
    original = fixture.client.read
  fixture.client.read = async <T>(id: string, route: ApiRead, offline?: boolean) => {
    await gate
    return original<T>(id, route, offline)
  }
  const pending = notifications.wake(id),
    pause = notifications.pause(id)
  await notifications.wake(id)
  release()
  await pending
  await pause
  expect(fixture.shown).toEqual([])
  expect(fixture.store.get(key)).toEqual(before)
  fixture.client.read = original
  notifications.resume(id)
  await notifications.wake(id)
  expect(fixture.shown).toHaveLength(1)
  await notifications.close()
})
