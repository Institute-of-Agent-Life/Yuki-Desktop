import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiClient } from '../../src/main/api/client'
import { Outbox } from '../../src/main/outbox'
import { payloadHash } from '../../src/main/outbox/fingerprint'
import type { Me, OutboxOwner } from '../../src/shared/api'
import { validateFixture } from '../fixtures/schema'

const owner: OutboxOwner = {
  characterId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  conversationId: '00000000-0000-4000-8000-000000000003',
  bindingId: '00000000-0000-4000-8000-000000000004',
}
const me: Me = {
  person_id: owner.personId,
  source_person_id: owner.personId,
  request_person_id: owner.personId,
  request_conversation_id: null,
  request_scope: owner.personId,
  platform: 'app',
  presence_id: '00000000-0000-4000-8000-000000000099',
  thread_id: null,
  binding_id: owner.bindingId,
  display_name: 'Test',
  conversation_id: owner.conversationId,
  bindings: [
    {
      binding_id: owner.bindingId,
      source_person_id: owner.personId,
      platform: 'app',
      display_name: 'Test',
      status: 'active',
    },
  ],
  devices: [],
}
const resources: { path: string; box: Outbox }[] = []
function setup() {
  const path = mkdtempSync(join(tmpdir(), 'yuki-outbox-'))
  const box = new Outbox(join(path, 'outbox.sqlite3'), owner)
  resources.push({ path, box })
  return { box, path }
}
afterEach(() => {
  for (const item of resources.splice(0)) {
    if (item.box.db.open) item.box.db.close()
    rmSync(item.path, { recursive: true, force: true })
  }
})
const data = (value: unknown) => {
  const shape = value as Record<string, unknown>
  const schema =
    'person_id' in shape
      ? 'Envelope_Me_'
      : 'found' in shape
        ? 'Envelope_RequestReceipt_'
        : 'Envelope_MessageReceipt_'
  validateFixture(schema, { data: value })
  return Response.json({ data: value })
}
const client = (fetcher: typeof fetch) =>
  new ApiClient(
    'http://localhost/character/yuki',
    'secret-test-only',
    owner.bindingId,
    'test',
    fetcher,
  )

describe('durable original request recovery', () => {
  it('keeps newer typing when ownership confirmation completes after a slow network read', () => {
    const { box } = setup()
    box.draft('submitted text')
    const snapshot = box.draft()
    box.draft('newer unsent draft')
    expect(box.prepare('submitted text', 'submitted', snapshot).body.text).toBe('submitted text')
    expect(box.draft()).toBe('newer unsent draft')
  })
  it('uses the server Unicode whitespace normalization before computing the original hash', () => {
    const { box } = setup()
    expect(box.prepare('\u0085 hello \u0085').body.text).toBe('hello')
    expect(box.prepare('\uFEFFhello\uFEFF').body.text).toBe('\uFEFFhello\uFEFF')
  })
  it('queues an offline draft and only marks submitted after original ownership is confirmed', async () => {
    const { box } = setup()
    box.draft('offline text')
    const item = box.prepare('offline text', 'draft')
    expect(box.draft()).toBe('')
    expect(item.state).toBe('draft')
    let posts = 0
    const api = client(async (url) => {
      if (String(url).endsWith('/me')) return data(me)
      posts++
      expect(box.get(item.requestId).state).toBe('submitted')
      return data({ event_id: 9, conversation_id: owner.conversationId, replay: false })
    })
    expect((await box.verify(api, item.requestId)).state).toBe('accepted')
    expect(posts).toBe(1)
  })
  it('a local write failure keeps the draft and cannot leave a queued duplicate', () => {
    const { box } = setup()
    box.draft('saved original')
    box.db.exec(
      "CREATE TRIGGER fail_draft BEFORE UPDATE ON draft BEGIN SELECT RAISE(ABORT,'injected disk failure'); END",
    )
    expect(() => box.prepare('saved original')).toThrow('injected disk failure')
    expect(box.draft()).toBe('saved original')
    expect(box.list()).toEqual([])
  })
  it('matches Python fingerprint including astral Unicode, DEL and escaping', () => {
    const fixtures = [
      ['你好，Yuki 🙂', 'b1dce01eaf7eba16954ec60c4359adcfe55580246f1b1741d113584fd85ec9b6'],
      ['\x7f', '63a204cf1d832f7e202ada2d7f7b0a05adeccf37e307a9efd857d581588d05a9'],
      ['line\nquote"\\x\t', '45bd4647552e8307f74665fe34efacfdd2cbfa4102b6e82c79bce791ae669b02'],
    ]
    for (const [text, hash] of fixtures)
      expect(payloadHash('message', owner.conversationId, { text, attachments: [] })).toBe(hash)
  })
  it('recovers a committed message whose POST response was lost after restart, without another POST', async () => {
    const { box, path } = setup(),
      item = box.prepare('original')
    let posts = 0
    const api = client(async (url, init) => {
      expect(init?.headers).toMatchObject({ 'X-Yuki-Entry': owner.bindingId })
      expect(String(url)).toContain('/character/yuki/client/v1/')
      if (String(url).endsWith('/me')) return data(me)
      if (String(url).endsWith('/messages')) {
        posts++
        throw new TypeError('connection lost after commit')
      }
      return data({
        found: true,
        operation_kind: 'message',
        target: owner.conversationId,
        payload_hash: item.payloadHash,
        event_id: 17,
        turn: { state: 'ended', outcome: null },
      })
    })
    expect((await box.send(api, item.requestId)).state).toBe('submitted')
    box.db.close()
    const recovered = new Outbox(join(path, 'outbox.sqlite3'), owner)
    try {
      expect(await recovered.verify(api, item.requestId)).toMatchObject({
        state: 'result',
        eventId: 17,
      })
      expect(posts).toBe(1)
    } finally {
      recovered.db.close()
    }
  })
  it('only found:false permits same-id, same-content resubmission', async () => {
    const { box } = setup(),
      item = box.prepare('preserved')
    const sent: unknown[] = []
    const api = client(async (url, init) => {
      if (String(url).endsWith('/me')) return data(me)
      if (String(url).includes('/requests/')) return data({ found: false })
      sent.push(JSON.parse(String(init?.body)))
      return data({ event_id: 3, conversation_id: owner.conversationId, replay: false })
    })
    expect((await box.verify(api, item.requestId)).state).toBe('accepted')
    expect(sent).toEqual([item.body])
  })
  it('not_found and an ownership change preserve the original body and never POST', async () => {
    const { box } = setup(),
      item = box.prepare('private original')
    let posts = 0,
      foreign = false
    const api = client(async (url, init) => {
      if (init?.method === 'POST') posts++
      if (String(url).endsWith('/me'))
        return data(foreign ? { ...me, request_person_id: 'different-person' } : me)
      return Response.json({ problem: { code: 'not_found' } }, { status: 404 })
    })
    expect(await box.verify(api, item.requestId)).toMatchObject({
      state: 'submitted',
      problem: 'not_found',
      body: item.body,
    })
    foreign = true
    expect(await box.verify(api, item.requestId)).toMatchObject({
      problem: 'outbox_owner_mismatch',
    })
    expect(posts).toBe(0)
  })
  it('a post-preparation owner lookup failure returns a durable unknown item, preventing a new request', async () => {
    const { box } = setup(),
      item = box.prepare('original')
    const result = await box.send(
      client(async () => {
        throw new TypeError('offline')
      }),
      item.requestId,
    )
    expect(result).toMatchObject({
      requestId: item.requestId,
      state: 'submitted',
      problem: 'transport_unknown',
    })
    expect(box.list()).toHaveLength(1)
  })
})
