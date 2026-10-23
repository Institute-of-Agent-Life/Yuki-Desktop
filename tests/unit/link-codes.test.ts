import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { LinkCodes } from '../../src/main/outbox/link-codes'
import { ApiClient } from '../../src/main/api/client'
import { payloadHash } from '../../src/main/outbox/fingerprint'
import type { Me, OutboxOwner } from '../../src/shared/api'
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
  request_scope: owner.personId,
  request_conversation_id: null,
  platform: 'app',
  presence_id: '00000000-0000-4000-8000-000000000099',
  thread_id: null,
  binding_id: owner.bindingId,
  display_name: '本人',
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
const roots: { root: string; box: Outbox }[] = []
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'yd-link-')),
    path = join(root, 'box.sqlite3'),
    box = new Outbox(path, owner)
  roots.push({ root, box })
  return { root, path, box, codes: new LinkCodes(box) }
}
afterEach(() => {
  for (const { root, box } of roots.splice(0)) {
    if (box.db.open) box.db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
const raw = 'aB_1'.repeat(8),
  codeId = '00000000-0000-4000-8000-000000000005',
  expires = new Date(Date.now() + 600000).toISOString()
const data = (value: unknown) => Response.json({ data: value })
const api = (fetcher: typeof fetch) =>
  new ApiClient('http://localhost', 'fixture-only', owner.bindingId, '1.0.0-beta.1', fetcher)
it('an explicit issue returns the secret once, while original receipts and SQLite persist metadata only', async () => {
  const { box, codes, path } = setup(),
    item = codes.prepare()
  expect(item.payloadHash).toBe(
    payloadHash('client.link_code', owner.personId, { source_binding_id: owner.bindingId }),
  )
  let writes = 0
  const client = api(async (input, init) => {
    if (String(input).endsWith('/me')) return data(me)
    if (String(input).includes('/requests/')) return data({ found: false })
    expect(JSON.parse(init!.body as string)).toEqual({ request_id: item.requestId })
    writes++
    return data({
      code: raw,
      code_id: codeId,
      expires_at: expires,
      request_id: item.requestId,
      replay: false,
    })
  })
  const issued = await codes.run(client, item.requestId)
  expect(issued.code).toBe(raw)
  expect(issued.request.result).toEqual({ code_id: codeId, expires_at: expires })
  expect(JSON.stringify(codes.list())).not.toContain(raw)
  expect((await codes.run(client, item.requestId)).code).toBeNull()
  expect(writes).toBe(1)
  box.db.pragma('wal_checkpoint(TRUNCATE)')
  expect(readFileSync(path).includes(Buffer.from(raw))).toBe(false)
})
it('cold lost-response recovery verifies the original UUID/hash/target and never requests another secret', async () => {
  const { box, codes, path } = setup(),
    item = codes.prepare()
  let writes = 0
  const client = api(async (input) => {
    if (String(input).endsWith('/me')) return data(me)
    if (String(input).includes('/requests/'))
      return data(
        writes
          ? {
              found: true,
              operation_kind: 'client.link_code',
              target: codeId,
              payload_hash: item.payloadHash,
              status: 'succeeded',
              result: { code_id: codeId, expires_at: expires, code: raw },
            }
          : { found: false },
      )
    writes++
    throw Error('response lost after commit')
  })
  expect((await codes.run(client, item.requestId)).request.state).toBe('submitted')
  box.db.close()
  const reopened = new Outbox(path, owner)
  try {
    const recovered = await new LinkCodes(reopened).run(client, item.requestId)
    expect(recovered).toMatchObject({
      code: null,
      request: {
        requestId: item.requestId,
        state: 'result',
        problem: null,
        result: { code_id: codeId },
      },
    })
    expect(JSON.stringify(new LinkCodes(reopened).list())).not.toContain(raw)
    expect(writes).toBe(1)
  } finally {
    reopened.db.close()
  }
})
it.each(['not_found', 'request_conflict'])(
  'known %s stops without reissuing a secret',
  async (code) => {
    const { codes } = setup(),
      item = codes.prepare()
    let writes = 0
    const client = api(async (input, init) => {
      if (String(input).endsWith('/me')) return data(me)
      if (init?.method === 'POST') {
        writes++
        throw Error('unexpected')
      }
      return code === 'not_found'
        ? Response.json({ problem: { code } }, { status: 404 })
        : data({
            found: true,
            operation_kind: 'client.link_code',
            target: codeId,
            payload_hash: 'wrong',
            status: 'succeeded',
            result: { code_id: codeId, expires_at: expires },
          })
    })
    expect(await codes.run(client, item.requestId)).toMatchObject({
      code: null,
      request: { state: 'result', problem: code },
    })
    expect(writes).toBe(0)
  },
)
it('confirmed absence permits only the original UUID, and a later explicit issue has its own UUID', async () => {
  const { codes } = setup(),
    item = codes.prepare()
  let attempted: string | undefined
  const client = api(async (input, init) => {
    if (String(input).endsWith('/me')) return data(me)
    if (String(input).includes('/requests/')) return data({ found: false })
    attempted = JSON.parse(init!.body as string).request_id
    return data({
      code: raw,
      code_id: codeId,
      expires_at: expires,
      request_id: item.requestId,
      replay: false,
    })
  })
  await codes.run(client, item.requestId)
  expect(attempted).toBe(item.requestId)
  expect(codes.prepare().requestId).not.toBe(item.requestId)
})
