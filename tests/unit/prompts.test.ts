import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Outbox } from '../../src/main/outbox'
import { Prompts } from '../../src/main/outbox/prompts'
import { ApiClient } from '../../src/main/api/client'
import type { Me, OutboxOwner, PromptDocuments, PromptDocument } from '../../src/shared/api'

const owner: OutboxOwner = {
  characterId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  bindingId: '00000000-0000-4000-8000-000000000003',
  conversationId: '00000000-0000-4000-8000-000000000004',
}
const me: Me = {
  person_id: owner.personId,
  source_person_id: owner.personId,
  request_person_id: owner.personId,
  request_scope: owner.personId,
  request_conversation_id: null,
  platform: 'app',
  presence_id: null,
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
const hash = (content: string) => `sha256:${createHash('sha256').update(content).digest('hex')}`
const document = (content: string): PromptDocument => ({
  key: 'system_prompt',
  file_name: 'system_prompt.md',
  content,
  revision: hash(content),
  updated_at: null,
  updated_by: 'external',
  writable: true,
  reason: null,
})
const docs = (content: string): PromptDocuments => ({
  documents: [document(content)],
  placeholder: '{{YUKI_PERSONA_CORE}}',
  active: { system_prompt: hash(content), persona: hash('persona') },
})
const roots: { root: string; box: Outbox }[] = []
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'yd-prompts-')),
    path = join(root, 'outbox.sqlite3')
  const box = new Outbox(path, owner)
  roots.push({ root, box })
  return { path, box, prompts: new Prompts(box) }
}
afterEach(() => {
  for (const { root, box } of roots.splice(0)) {
    if (box.db.open) box.db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
const response = (data: unknown) => Response.json({ data })
const api = (fetcher: typeof fetch) =>
  new ApiClient('http://localhost/role', 'test-only', owner.bindingId, '1.0.0-beta.1', fetcher)

it('a first keystroke racing a clean SSE read restores its captured baseline and survives reopening', () => {
  const { path, box, prompts } = setup()
  const captured = prompts.observe(docs('original\r\n{{YUKI_PERSONA_CORE}}'))[0]!
  prompts.observe(docs('remote R1'))
  prompts.edit({ ...captured, draft: captured.draft + '\r\nmy draft' })
  prompts.observe(docs('remote R2'))
  expect(prompts.drafts()[0]).toMatchObject({
    baseRevision: captured.baseRevision,
    baseContent: captured.baseContent,
    draft: captured.draft + '\r\nmy draft',
    remote: { content: 'remote R2' },
  })
  box.db.close()
  const reopened = new Outbox(path, owner)
  roots.find((entry) => entry.box === box)!.box = reopened
  expect(new Prompts(reopened).drafts()).toEqual(promptsSnapshot(captured))
  function promptsSnapshot(value: typeof captured) {
    return [{ ...value, draft: value.draft + '\r\nmy draft', remote: document('remote R2') }]
  }
})

it('an older read cannot roll back a later read or a completed save', async () => {
  const { prompts } = setup()
  const older = prompts.captureRead(),
    newer = prompts.captureRead()
  prompts.observe(docs('R1'), newer)
  prompts.observe(docs('R0'), older)
  const base = prompts.drafts()[0]!
  prompts.edit({ ...base, draft: 'saved' })
  const reading = prompts.captureRead()
  const item = prompts.prepare({
    kind: 'save',
    key: base.key,
    expectedRevision: base.baseRevision,
    content: 'saved',
  })
  await prompts.run(
    api(async (input) =>
      String(input).endsWith('/me')
        ? response(me)
        : String(input).includes('/requests/')
          ? response({ found: false })
          : response({ revision: hash('saved'), applied_at: '2026-10-20T00:00:00Z', warnings: [] }),
    ),
    item.requestId,
  )
  prompts.observe(docs('R1'), reading)
  expect(prompts.drafts()[0]).toMatchObject({
    baseRevision: hash('saved'),
    baseContent: 'saved',
    draft: 'saved',
  })
})

it('running control recovery sends the same UUID and exact body after a lost response, only once concurrently', async () => {
  const { path, box, prompts } = setup()
  const base = prompts.observe(docs('base'))[0]!
  const content = '  exact\r\n{{YUKI_PERSONA_CORE}}\r\n  '
  prompts.edit({ ...base, draft: content })
  const item = prompts.prepare({
    kind: 'save',
    key: base.key,
    expectedRevision: base.baseRevision,
    content,
  })
  let state = 'absent',
    writes = 0,
    effects = 0
  const client = api(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/me')) return response(me)
    if (url.includes('/requests/'))
      return response(
        state === 'absent'
          ? { found: false }
          : {
              found: true,
              operation_kind: 'control',
              target: 'character_prompt:system_prompt',
              payload_hash: item.payloadHash,
              status: state,
              result:
                state === 'succeeded'
                  ? { revision: hash(content), applied_at: '2026-10-20T00:00:00Z', warnings: [] }
                  : null,
            },
      )
    writes++
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init!.body as string)).toEqual({
      request_id: item.requestId,
      expected_revision: base.baseRevision,
      content,
    })
    if (state === 'absent') {
      state = 'running'
      effects++
      throw new Error('lost after file write')
    }
    state = 'succeeded'
    return response({ revision: hash(content), applied_at: '2026-10-20T00:00:00Z', warnings: [] })
  })
  expect((await prompts.run(client, item.requestId)).state).toBe('submitted')
  box.db.close()
  const reopened = new Outbox(path, owner)
  roots.find((entry) => entry.box === box)!.box = reopened
  const recovered = new Prompts(reopened)
  const first = recovered.run(client, item.requestId),
    duplicate = recovered.run(client, item.requestId)
  expect(duplicate).toBe(first)
  expect((await first).state).toBe('result')
  expect({ writes, effects }).toEqual({ writes: 2, effects: 1 })
  expect(recovered.drafts()[0]).toMatchObject({
    baseContent: content,
    baseRevision: hash(content),
    draft: content,
  })
  await recovered.run(client, item.requestId)
  expect(writes).toBe(2)
})

it('the original failed receipt preserves a conflict baseline and the server document', async () => {
  const { prompts } = setup(),
    base = prompts.observe(docs('base'))[0]!
  prompts.edit({ ...base, draft: 'mine' })
  const item = prompts.prepare({
    kind: 'save',
    key: base.key,
    expectedRevision: base.baseRevision,
    content: 'mine',
  })
  let writes = 0
  const result = await prompts.run(
    api(async (input) => {
      if (String(input).endsWith('/me')) return response(me)
      if (String(input).includes('/requests/'))
        return response({
          found: true,
          operation_kind: 'control',
          target: 'character_prompt:system_prompt',
          payload_hash: item.payloadHash,
          status: 'failed',
          problem_code: 'version_conflict',
          problem: { code: 'version_conflict', current: document('theirs'), written: false },
          result: null,
        })
      writes++
      throw new Error('must not resend failed control')
    }),
    item.requestId,
  )
  expect(result.problem).toBe('version_conflict')
  expect(writes).toBe(0)
  expect(prompts.drafts()[0]).toMatchObject({
    baseRevision: base.baseRevision,
    draft: 'mine',
    remote: document('theirs'),
  })
})

it.each(['not_found', 'wrong_hash', 'wrong_target'])(
  'original receipt %s stops automatic resubmission',
  async (mode) => {
    const { prompts } = setup()
    const item = prompts.prepare({ kind: 'reload' })
    let writes = 0
    const result = await prompts.run(
      api(async (input) => {
        if (String(input).endsWith('/me')) return response(me)
        if (mode === 'not_found')
          return Response.json({ problem: { code: 'not_found' } }, { status: 404 })
        if (String(input).includes('/requests/'))
          return response({
            found: true,
            operation_kind: 'control',
            target:
              mode === 'wrong_target' ? 'character_prompt:persona' : 'character_prompt:reload',
            payload_hash: mode === 'wrong_hash' ? 'changed' : item.payloadHash,
            status: 'running',
          })
        writes++
        return response({})
      }),
      item.requestId,
    )
    expect(result).toMatchObject({
      state: 'result',
      problem: mode === 'not_found' ? 'not_found' : 'request_conflict',
    })
    expect(writes).toBe(0)
  },
)

it('a successful original receipt missing its applied result stays unknown', async () => {
  const { prompts } = setup(),
    item = prompts.prepare({ kind: 'reload' })
  const result = await prompts.run(
    api(async (input) =>
      String(input).endsWith('/me')
        ? response(me)
        : response({
            found: true,
            operation_kind: 'control',
            target: 'character_prompt:reload',
            payload_hash: item.payloadHash,
            status: 'succeeded',
            result: {},
          }),
    ),
    item.requestId,
  )
  expect(result).toMatchObject({ state: 'submitted', problem: 'transport_unknown' })
})

it('explicit reload settles a known written but inactive draft without another file save', async () => {
  const { prompts } = setup(),
    base = prompts.observe(docs('base'))[0]!
  prompts.edit({ ...base, draft: 'written' })
  const item = prompts.prepare({
    kind: 'save',
    key: base.key,
    expectedRevision: base.baseRevision,
    content: 'written',
  })
  const client = api(async (input, init) => {
    if (String(input).endsWith('/me')) return response(me)
    if (String(input).includes('/requests/')) return response({ found: false })
    if (init?.method === 'PUT')
      return Response.json(
        {
          problem: {
            code: 'precondition_failed',
            written: true,
            reason: 'prompt_documents_invalid',
          },
        },
        { status: 409 },
      )
    return response({
      active: { system_prompt: hash('written'), persona: hash('persona') },
      applied_at: '2026-10-20T00:00:00Z',
      warnings: [],
    })
  })
  expect((await prompts.run(client, item.requestId)).details?.written).toBe(true)
  prompts.observe(docs('written'))
  expect(prompts.drafts()[0]?.baseContent).toBe('base')
  await prompts.run(client, prompts.prepare({ kind: 'reload' }).requestId)
  expect(prompts.drafts()[0]).toMatchObject({
    baseRevision: hash('written'),
    baseContent: 'written',
    draft: 'written',
  })
  expect(prompts.list().filter((item) => item.command.kind === 'save')).toHaveLength(1)
})
