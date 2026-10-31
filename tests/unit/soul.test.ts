import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { Soul, soulRequest } from '../../src/main/outbox/soul'
import { ApiClient } from '../../src/main/api/client'
import type { Me, OutboxOwner, SoulDocument } from '../../src/shared/api'
import { convertSoulData } from '../../build-tools/convert-soul-data.mjs'

const owner: OutboxOwner = {
  characterId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  bindingId: '00000000-0000-4000-8000-000000000003',
  conversationId: '00000000-0000-4000-8000-000000000004',
}
const me: Me = {
  is_superuser: true,
  person_id: owner.personId,
  source_person_id: owner.personId,
  request_person_id: owner.personId,
  request_scope: owner.personId,
  request_conversation_id: null,
  platform: 'app',
  presence_id: '00000000-0000-4000-8000-000000000099',
  thread_id: null,
  binding_id: owner.bindingId,
  display_name: '本人',
  conversation_id: owner.conversationId,
  devices: [],
  bindings: [
    {
      binding_id: owner.bindingId,
      source_person_id: owner.personId,
      platform: 'app',
      display_name: '',
      status: 'active',
    },
  ],
}
const hash = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`
const document = (content: string): SoulDocument => ({
  file_name: 'SOUL.md',
  content,
  revision: hash(content),
  active_revision: hash(content),
  updated_at: null,
  updated_by: 'external',
  writable: true,
  reason: null,
})
const roots: { root: string; box: Outbox }[] = []
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'yd-soul-')),
    path = join(root, 'outbox.sqlite3'),
    box = new Outbox(path, owner)
  roots.push({ root, box })
  return { path, box, soul: new Soul(box) }
}
afterEach(() => {
  for (const { root, box } of roots.splice(0)) {
    if (box.db.open) box.db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
it('archives old pending-only data without importing or resending a draft', () => {
  const { path, box } = setup()
  box.db.exec('CREATE TABLE prompt_commands (request_id TEXT, value TEXT)')
  box.db
    .prepare('INSERT INTO prompt_commands VALUES (?,?)')
    .run('original-id', '{"state":"unknown"}')
  box.db.close()
  const converted = convertSoulData(path, 'none')
  expect(converted.converted).toBe(true)
  expect(JSON.parse(readFileSync(converted.archivePath!, 'utf8')).commands).toEqual([
    { request_id: 'original-id', value: '{"state":"unknown"}' },
  ])
  const reopened = new Outbox(path, owner)
  roots.find((value) => value.box === box)!.box = reopened
  const soul = new Soul(reopened)
  expect(soul.draft()).toBeNull()
  expect(soul.list()).toEqual([])
})
const api = (fetcher: typeof fetch) =>
  new ApiClient('http://localhost/role', 'test-only', owner.bindingId, '1.0.0-beta.1', fetcher)
const response = (data: unknown) => Response.json({ data })

it('keeps captured raw CRLF baselines through remote changes and process reopening', () => {
  const { path, box, soul } = setup(),
    original = soul.observe(document('Original\r\n{{name}}'))!
  soul.observe(document('new remote'))
  soul.edit({ ...original, draft: 'My draft\r\n' })
  soul.observe(document('latest'))
  expect(soul.draft()).toMatchObject({
    baseRevision: original.baseRevision,
    draft: 'My draft\r\n',
    remote: { content: 'latest' },
  })
  box.db.close()
  const reopened = new Outbox(path, owner)
  roots.find((value) => value.box === box)!.box = reopened
  expect(new Soul(reopened).draft()?.draft).toBe('My draft\r\n')
})
it('ignores an older read after the current remote response', () => {
  const { soul } = setup(),
    old = soul.captureRead(),
    current = soul.captureRead()
  soul.observe(document('new'), current)
  soul.observe(document('old'), old)
  expect(soul.draft()?.baseContent).toBe('new')
})
it('accepts empty SOUL and does not let another unknown write close the editor', () => {
  const { soul } = setup(),
    base = soul.observe(document('base'))!
  soul.edit({ ...base, draft: '' })
  const first = soul.prepare({ kind: 'save', expectedRevision: base.baseRevision, content: '' })
  const second = soul.prepare({
    kind: 'save',
    expectedRevision: base.baseRevision,
    content: 'new explicit intent',
  })
  expect(first.requestId).not.toBe(second.requestId)
  expect(soulRequest(first.command).payload).toEqual({
    expected_revision: base.baseRevision,
    content: '',
  })
})
it('recovers an unknown controlled file write with the same UUID, hash and body', async () => {
  const { soul } = setup(),
    base = soul.observe(document('base'))!
  soul.edit({ ...base, draft: 'Saved\r\n' })
  const item = soul.prepare({
    kind: 'save',
    expectedRevision: base.baseRevision,
    content: 'Saved\r\n',
  })
  const bodies: unknown[] = []
  let written = false
  const client = api(async (input, init) => {
    if (String(input).endsWith('/me')) return response(me)
    if (String(input).includes('/requests/'))
      return response(
        written
          ? {
              found: true,
              status: 'running',
              operation_kind: 'control',
              target: 'character_soul',
              payload_hash: item.payloadHash,
            }
          : { found: false },
      )
    bodies.push(JSON.parse(String(init?.body)))
    if (!written) {
      written = true
      throw new Error('ack lost')
    }
    return response({
      revision: hash('Saved\r\n'),
      active_revision: hash('Saved\r\n'),
      applied_at: '2026-10-22T00:00:00Z',
    })
  })
  expect((await soul.run(client, item.requestId)).state).toBe('submitted')
  expect((await soul.run(client, item.requestId)).state).toBe('result')
  expect(bodies).toHaveLength(2)
  expect(bodies[0]).toEqual(bodies[1])
  expect(soul.draft()?.baseContent).toBe('Saved\r\n')
})
it('converts only an explicitly selected old draft and never dispatches retired commands', async () => {
  const { path, box, soul } = setup()
  box.db.exec(
    'CREATE TABLE prompt_drafts(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE prompt_commands(request_id TEXT PRIMARY KEY,command TEXT,hash TEXT,state TEXT)',
  )
  for (const key of ['system_prompt', 'persona'])
    box.db
      .prepare('INSERT INTO prompt_drafts VALUES(?,?)')
      .run(key, JSON.stringify({ key, draft: key + ' private original', baseContent: 'base' }))
  box.db
    .prepare('INSERT INTO prompt_commands VALUES(?,?,?,?)')
    .run('old-uuid', 'original body', 'original hash', 'submitted')
  expect(soul.list()).toEqual([])
  expect(() => convertSoulData(path, 'guess')).toThrow('Explicit')
  const converted = convertSoulData(path, 'persona')
  expect(readFileSync(path + '.soul-upgrade.json', 'utf8')).toContain('original hash')
  expect(readFileSync(converted.draftPath!, 'utf8')).toBe('persona private original')
  const draft = soul.observe(document('current real SOUL'))!
  expect(draft.draft).toBe('current real SOUL')
  expect(draft.baseRevision).toBe(hash('current real SOUL'))
  expect(soul.list()).toEqual([])
  expect(
    box.db
      .prepare("SELECT name FROM sqlite_master WHERE name IN ('prompt_drafts','prompt_commands')")
      .all(),
  ).toEqual([])
})
