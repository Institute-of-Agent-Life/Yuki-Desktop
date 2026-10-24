import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { WorkCommands } from '../../src/main/outbox/work-commands'
import { ApiClient } from '../../src/main/api/client'
import type { Me, OriginalRequest, OutboxOwner, WorkCommandItem } from '../../src/shared/api'
import { validateFixture } from '../fixtures/schema'
import { localSummary } from '../../src/main/outbox/local-summary'

const owner: OutboxOwner = {
  characterId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  conversationId: '00000000-0000-4000-8000-000000000003',
  bindingId: '00000000-0000-4000-8000-000000000004',
}
const workId = '00000000-0000-4000-8000-000000000005'
const me: Me = {
  person_id: owner.personId,
  source_person_id: owner.personId,
  request_person_id: owner.personId,
  request_scope: owner.personId,
  request_conversation_id: null,
  platform: 'app',
  presence_id: '00000000-0000-4000-8000-000000000099',
  thread_id: null,
  binding_id: owner.bindingId,
  display_name: '測試本人',
  conversation_id: owner.conversationId,
  bindings: [
    {
      binding_id: owner.bindingId,
      source_person_id: owner.personId,
      platform: 'app',
      display_name: '',
      status: 'active',
    },
  ],
  devices: [],
}
const resources: { root: string; box: Outbox }[] = []
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'yd-work-command-')),
    path = join(root, 'box.sqlite3'),
    box = new Outbox(path, owner),
    commands = new WorkCommands(box)
  resources.push({ root, box })
  return { path, box, commands }
}
afterEach(() => {
  for (const { root, box } of resources.splice(0)) {
    if (box.db.open) box.db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
function data(schema: string, value: unknown) {
  validateFixture(schema, { data: value })
  return Response.json({ data: value })
}
const api = (fetcher: typeof fetch) =>
  new ApiClient('http://localhost/role', 'fixture-only', owner.bindingId, '1.0.0-beta.1', fetcher)
const receipt = (item: WorkCommandItem, extra: Partial<OriginalRequest> = {}) =>
  data('Envelope_RequestReceipt_', {
    found: true,
    operation_kind: item.command.kind === 'input' ? 'client.work_input' : 'client.work_cancel',
    target: workId,
    payload_hash: item.payloadHash,
    status: 'succeeded',
    result: { event_id: 8, input_id: 3, replay: false },
    ...extra,
  })

it('atomically queues the normalized original input while keeping a newer work draft', () => {
  const { box, commands } = setup()
  commands.draft(workId, '原稿')
  const snapshot = commands.draft(workId)
  commands.draft(workId, '等待網路期間的新稿')
  expect(
    commands.prepare({ kind: 'input', workId, text: '\u0085原稿\u0085' }, 'draft', snapshot)
      .command,
  ).toEqual({ kind: 'input', workId, text: '原稿' })
  expect(commands.draft(workId)).toBe('等待網路期間的新稿')
  box.db.exec(
    "CREATE TRIGGER fail_work_draft BEFORE UPDATE ON work_drafts BEGIN SELECT RAISE(ABORT,'disk full'); END",
  )
  expect(() =>
    commands.prepare({ kind: 'input', workId, text: '新稿' }, 'draft', commands.draft(workId)),
  ).toThrow('disk full')
  expect(commands.list()).toHaveLength(1)
  expect(commands.draft(workId)).toBe('等待網路期間的新稿')
})
it('isolates exact question drafts from supplements, later questions and other entries across a cold restart', () => {
  const { box, commands, path } = setup(),
    question = { conversationId: owner.conversationId, eventId: 8 },
    next = { ...question, eventId: 9 },
    other = { ...question, conversationId: owner.bindingId }
  commands.draft(workId, '原補充\n第二行')
  commands.draft(workId, '原問題的回答', question)
  commands.draft(workId, '下一問題的回答', next)
  commands.draft(workId, '另一入口的回答', other)
  box.db.close()
  const recoveredBox = new Outbox(path, owner),
    recovered = new WorkCommands(recoveredBox)
  try {
    expect(recovered.draft(workId)).toBe('原補充\n第二行')
    expect(recovered.draft(workId, undefined, question)).toBe('原問題的回答')
    expect(recovered.draft(workId, undefined, next)).toBe('下一問題的回答')
    expect(recovered.draft(workId, undefined, other)).toBe('另一入口的回答')
    expect(recovered.draft(owner.personId, undefined, question)).toBe('')
    expect(localSummary(recoveredBox).drafts).toBe(4)
    expect(
      recovered
        .questionDrafts(workId)
        .map((draft) => draft.text)
        .sort(),
    ).toEqual(['原問題的回答', '下一問題的回答', '另一入口的回答'].sort())
    recovered.prepare(
      { kind: 'input', workId, text: '原問題的回答' },
      'draft',
      '原問題的回答',
      question,
    )
    expect(recovered.draft(workId, undefined, question)).toBe('')
    expect(recovered.draft(workId)).toBe('原補充\n第二行')
    expect(recovered.draft(workId, undefined, next)).toBe('下一問題的回答')
    expect(recovered.questionDrafts(workId)).toHaveLength(2)
    expect(localSummary(recoveredBox)).toMatchObject({ drafts: 4, pending: 0 })
  } finally {
    recoveredBox.db.close()
  }
})
it('rolls back a failed question draft handoff and keeps edits made after its send snapshot', () => {
  const { box, commands } = setup(),
    question = { conversationId: owner.conversationId, eventId: 8 }
  commands.draft(workId, '補充不要清除')
  commands.draft(workId, '舊回答', question)
  const snapshot = commands.draft(workId, undefined, question)
  commands.draft(workId, '網路等待時的新回答', question)
  const first = commands.prepare(
    { kind: 'input', workId, text: snapshot },
    'draft',
    snapshot,
    question,
  )
  expect(commands.draft(workId, undefined, question)).toBe('網路等待時的新回答')
  box.db.exec(
    "CREATE TRIGGER fail_question_draft BEFORE UPDATE ON work_question_drafts BEGIN SELECT RAISE(ABORT,'disk full'); END",
  )
  expect(() =>
    commands.prepare(
      { kind: 'input', workId, text: '網路等待時的新回答' },
      'draft',
      '網路等待時的新回答',
      question,
    ),
  ).toThrow('disk full')
  expect(commands.list()).toEqual([first])
  expect(commands.draft(workId, undefined, question)).toBe('網路等待時的新回答')
  expect(commands.draft(workId)).toBe('補充不要清除')
})
it('keeps question metadata outside the API payload and recovers its original receipt after restart', async () => {
  const { box, commands, path } = setup(),
    question = { conversationId: owner.conversationId, eventId: 8 }
  commands.draft(workId, '原回答', question)
  const item = commands.prepare(
    { kind: 'input', workId, text: '原回答' },
    'submitted',
    '原回答',
    question,
  )
  let posts = 0
  const client = api(async (url, init) => {
    if (String(url).endsWith('/me')) return data('Envelope_Me_', me)
    if (init?.method === 'POST') {
      posts++
      expect(JSON.parse(String(init.body))).toEqual({ request_id: item.requestId, text: '原回答' })
      throw new Error('response lost after commit')
    }
    return receipt(item)
  })
  expect((await commands.send(client, item.requestId)).state).toBe('submitted')
  box.db.close()
  const recoveredBox = new Outbox(path, owner),
    recovered = new WorkCommands(recoveredBox)
  try {
    expect(recovered.draft(workId, undefined, question)).toBe('')
    expect(await recovered.verify(client, item.requestId)).toMatchObject({
      state: 'result',
      problem: null,
      payloadHash: item.payloadHash,
    })
    expect(posts).toBe(1)
  } finally {
    recoveredBox.db.close()
  }
})
it('recovers a committed input after cold restart using the original hash, target and request namespace', async () => {
  const { box, commands, path } = setup(),
    item = commands.prepare({ kind: 'input', workId, text: '原補充 🙂' }, 'submitted')
  let posts = 0
  const client = api(async (url, init) => {
    expect(init?.headers).toMatchObject({ 'X-Yuki-Entry': owner.bindingId })
    if (String(url).endsWith('/me')) return data('Envelope_Me_', me)
    if (init?.method === 'POST') {
      posts++
      throw new Error('response lost after commit')
    }
    return receipt(item)
  })
  expect((await commands.send(client, item.requestId)).state).toBe('submitted')
  box.db.close()
  const recoveredBox = new Outbox(path, owner),
    recovered = new WorkCommands(recoveredBox)
  try {
    expect(await recovered.verify(client, item.requestId)).toMatchObject({
      state: 'result',
      problem: null,
      result: { event_id: 8 },
    })
    expect(posts).toBe(1)
  } finally {
    recoveredBox.db.close()
  }
})
it('permits only found:false to resend the original cancellation and keeps its observed revision', async () => {
  const { commands } = setup(),
    item = commands.prepare({ kind: 'cancel', workId, expectedRevision: 7 }, 'submitted')
  const sent: unknown[] = []
  const client = api(async (url, init) => {
    if (String(url).endsWith('/me')) return data('Envelope_Me_', me)
    if (String(url).includes('/requests/'))
      return data('Envelope_RequestReceipt_', { found: false })
    sent.push(JSON.parse(String(init?.body)))
    return data('Envelope_WorkCancelReceipt_', {
      work_id: workId,
      state: 'cancelled',
      revision: 8,
      replay: false,
    })
  })
  expect((await commands.verify(client, item.requestId)).state).toBe('result')
  expect(sent).toEqual([{ request_id: item.requestId, expected_revision: 7 }])
})
it('never resends not_found even if a later receipt lookup says found:false', async () => {
  const { commands } = setup(),
    item = commands.prepare({ kind: 'input', workId, text: '無法查證的原文' }, 'submitted')
  let missing = true,
    posts = 0
  const client = api(async (url, init) => {
    if (String(url).endsWith('/me')) return data('Envelope_Me_', me)
    if (init?.method === 'POST') posts++
    return missing
      ? Response.json({ problem: { code: 'not_found' } }, { status: 404 })
      : data('Envelope_RequestReceipt_', { found: false })
  })
  expect(await commands.verify(client, item.requestId)).toMatchObject({
    state: 'result',
    problem: 'not_found',
  })
  missing = false
  expect((await commands.verify(client, item.requestId)).problem).toBe('not_found')
  expect(posts).toBe(0)
})
it.each(['target', 'payload_hash', 'operation_kind'] as const)(
  'rejects a mismatched original %s without sending another command',
  async (field) => {
    const { commands } = setup(),
      item = commands.prepare({ kind: 'input', workId, text: '原文' }, 'submitted')
    const client = api(async (url) =>
      String(url).endsWith('/me') ? data('Envelope_Me_', me) : receipt(item, { [field]: 'wrong' }),
    )
    expect((await commands.verify(client, item.requestId)).problem).toBe('request_conflict')
  },
)
it('preserves an unreadable original through a failed later lookup and can still read its recovered receipt', async () => {
  const { commands } = setup(),
    item = commands.prepare({ kind: 'input', workId, text: '保留原文' }, 'submitted')
  let phase = 0
  const client = api(async (url) => {
    if (String(url).endsWith('/me')) return data('Envelope_Me_', me)
    if (phase === 0) return Response.json({ problem: { code: 'not_found' } }, { status: 404 })
    if (phase === 1) throw new Error('network unavailable')
    return receipt(item)
  })
  await commands.verify(client, item.requestId)
  phase = 1
  expect((await commands.verify(client, item.requestId)).problem).toBe('not_found')
  phase = 2
  expect(await commands.verify(client, item.requestId)).toMatchObject({
    state: 'result',
    problem: null,
    result: { event_id: 8 },
  })
})
it('coalesces concurrent recovery while enforcing the original Person and entry before dispatch', async () => {
  const { commands } = setup(),
    item = commands.prepare({ kind: 'input', workId, text: '原文' }, 'draft')
  let reads = 0
  const client = api(async () => {
    reads++
    return data('Envelope_Me_', { ...me, request_person_id: workId })
  })
  await Promise.all([
    commands.verify(client, item.requestId),
    commands.verify(client, item.requestId),
  ])
  expect(reads).toBe(1)
  expect((await commands.verify(client, item.requestId)).problem).toBe('outbox_owner_mismatch')
})
it('records original cancellation version conflicts and never silently chooses a new revision or UUID', async () => {
  const { commands } = setup(),
    item = commands.prepare({ kind: 'cancel', workId, expectedRevision: 1 }, 'submitted')
  let posts = 0
  const client = api(async (url) => {
    if (String(url).endsWith('/me')) return data('Envelope_Me_', me)
    posts++
    return Response.json({ problem: { code: 'version_conflict' } }, { status: 409 })
  })
  expect((await commands.send(client, item.requestId)).problem).toBe('version_conflict')
  await commands.verify(client, item.requestId)
  expect(posts).toBe(1)
  expect(commands.get(item.requestId).command).toEqual(item.command)
})
