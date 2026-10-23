import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, readdir, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { Outbox } from '../../src/main/outbox'
import { Uploads } from '../../src/main/media/uploads'
import { ContentCache } from '../../src/main/media/content'
import { ApiClient } from '../../src/main/api/client'
import { payloadHash } from '../../src/main/outbox/fingerprint'
import { validateFixture } from '../fixtures/schema'
import type { Me, OutboxOwner } from '../../src/shared/api'

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
  request_conversation_id: null,
  request_scope: owner.personId,
  binding_id: owner.bindingId,
  conversation_id: owner.conversationId,
  platform: 'app',
  presence_id: '00000000-0000-4000-8000-000000000099',
  thread_id: null,
  display_name: 'Test',
  devices: [],
  bindings: [
    {
      binding_id: owner.bindingId,
      source_person_id: owner.personId,
      platform: 'app',
      display_name: 'Test',
      status: 'active',
    },
  ],
}
const resources: { root: string; boxes: Outbox[] }[] = []
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'yd-media-')),
    boxes: Outbox[] = []
  resources.push({ root, boxes })
  const reopen = () => {
    const box = new Outbox(join(root, 'outbox.sqlite3'), owner)
    boxes.push(box)
    return { box, uploads: new Uploads(box, join(root, 'uploads')) }
  }
  await writeFile(join(root, '來源.txt'), 'immutable original bytes')
  return { root, reopen, ...reopen() }
}
afterEach(async () => {
  for (const { root, boxes } of resources.splice(0)) {
    boxes.forEach((box) => {
      if (box.db.open) box.db.close()
    })
    await rm(root, { recursive: true, force: true })
  }
})
function data(schema: string, value: unknown) {
  validateFixture(schema, { data: value })
  return Response.json({ data: value })
}
it('cleans its unfinished upload snapshot when reading the selected original fails', async () => {
  const { root, uploads } = await setup()
  await expect(uploads.stage(root)).rejects.toThrow()
  expect(uploads.list()).toEqual([])
  expect(await readdir(uploads.root)).toEqual([])
})
const api = (fetcher: typeof fetch) =>
  new ApiClient('http://localhost/prefix', 'test-only', owner.bindingId, '1.0.0-beta.1', fetcher)

it('requires the requested artifact version even when another valid hash is served and preserves user-saved files', async () => {
  const { root } = await setup(),
    cache = new ContentCache(join(root, 'artifact-cache'))
  const bytes = Buffer.from('original version'),
    sha256 = createHash('sha256').update(bytes).digest('hex')
  let changed = false
  const client = api(async () => {
    const body = changed ? Buffer.from('another valid version') : bytes
    return new Response(body, {
      headers: {
        ETag: '"' + createHash('sha256').update(body).digest('hex') + '"',
        'Content-Length': String(body.length),
        'Content-Disposition': "attachment; filename*=UTF-8''%E5%8E%9F%E7%A8%BF.md",
      },
    })
  })
  const original = await cache.download(client, 'artifact', sha256)
  expect(original.filename).toBe('原稿.md')
  const saved = join(root, 'user-saved.md')
  await cache.save(original.path, sha256, saved)
  changed = true
  await expect(cache.download(client, 'artifact', sha256)).rejects.toThrow('content_hash_mismatch')
  expect(await cache.bytes(original.path, sha256)).toEqual(bytes)
  const privateOpen = join(cache.root, 'open', sha256, 'file.md')
  await mkdir(join(cache.root, 'open', sha256), { recursive: true })
  await writeFile(privateOpen, bytes)
  await cache.remove(sha256)
  await expect(stat(original.path)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(privateOpen)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(saved)).toEqual(bytes)
})

it('revokes external original exports and legacy previews while preserving other identities and saved copies', async () => {
  const { root } = await setup(),
    cache = new ContentCache(join(root, 'nested-cache'), join(root, 'native-exports')),
    other = new ContentCache(join(root, 'other-cache'), join(root, 'other-exports')),
    bytes = Buffer.from('original immutable artifact'),
    sha256 = createHash('sha256').update(bytes).digest('hex')
  const original = await cache.download(
    api(async () => new Response(bytes, { headers: { ETag: '"' + sha256 + '"' } })),
    'artifact',
    sha256,
  )
  const exported = join(cache.exportRoot, sha256, 'same.md'),
    legacy = join(cache.root, 'open', sha256, 'same.md'),
    otherExport = join(other.exportRoot, sha256, 'same.md'),
    saved = join(root, 'user-saved-original.md')
  for (const path of [exported, legacy, otherExport]) {
    await mkdir(dirname(path), { recursive: true })
    await cache.save(original.path, sha256, path)
  }
  await cache.save(original.path, sha256, saved)
  await cache.remove(sha256)
  for (const path of [original.path, exported, legacy])
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(otherExport)).toEqual(bytes)
  expect(await readFile(saved)).toEqual(bytes)
  await other.clear()
  await expect(stat(other.exportRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(saved)).toEqual(bytes)
})

it.each([false, true])(
  'recovers an interrupted upload after restart; server had committed=%s',
  async (committed) => {
    const { root, box, uploads, reopen } = await setup(),
      draft = await uploads.stage(join(root, '來源.txt'))
    await writeFile(join(root, '來源.txt'), 'original file has changed')
    let posts = 0,
      receipt: Record<string, unknown> | undefined
    const requests: string[] = []
    const client = api(async (raw, init) => {
      const url = new URL(String(raw))
      requests.push(url.pathname)
      if (url.pathname.endsWith('/me')) return data('Envelope_Me_', me)
      if (url.pathname.includes('/requests/'))
        return data(
          'Envelope_RequestReceipt_',
          committed
            ? {
                found: true,
                operation_kind: 'client.upload',
                target: owner.personId,
                payload_hash: payloadHash('client.upload', owner.personId, {
                  sha256: draft.sha256,
                  size: draft.size,
                  filename: draft.filename,
                  kind: draft.kind,
                }),
                result: receipt,
              }
            : { found: false },
        )
      posts++
      expect(url.searchParams.get('request_id')).toBe(draft.requestId)
      const chunks: Buffer[] = []
      for await (const chunk of init!.body as unknown as AsyncIterable<Buffer>) chunks.push(chunk)
      expect(Buffer.concat(chunks).toString()).toBe('immutable original bytes')
      receipt = {
        media_id: '00000000-0000-4000-8000-000000000005',
        sha256: draft.sha256,
        size: draft.size,
        kind: draft.kind,
        filename: draft.filename,
        expires_at: Date.now() / 1000 + 86400,
        replay: false,
      }
      if (posts === 1) throw new Error('response lost')
      return data('Envelope_UploadReceipt_', receipt)
    })
    expect((await uploads.upload(client, draft.requestId)).state).toBe('submitted')
    box.db.close()
    const restored = reopen()
    const result = await restored.uploads.upload(client, draft.requestId)
    expect(result.state).toBe('ready')
    expect(posts).toBe(committed ? 1 : 2)
    expect(requests).toContain('/prefix/client/v1/requests/' + draft.requestId)
    const references = restored.uploads.references([draft.requestId])
    const message = restored.box.prepare('', 'submitted', '', references, () =>
      restored.uploads.remove(draft.requestId),
    )
    expect(message.body.attachments).toEqual([result.mediaId])
    expect(message.payloadHash).toBe(
      payloadHash('message', owner.conversationId, { text: '', attachments: references }),
    )
    expect(restored.uploads.list()).toEqual([])
  },
)

it('does not retransmit a previously submitted upload after not_found', async () => {
  const { root, uploads } = await setup(),
    draft = await uploads.stage(join(root, '來源.txt'))
  const broken = api(async (raw) =>
    String(raw).endsWith('/me') ? data('Envelope_Me_', me) : Promise.reject(new Error('lost')),
  )
  await uploads.upload(broken, draft.requestId)
  let posts = 0
  const denied = api(async (raw, init) => {
    if (String(raw).endsWith('/me')) return data('Envelope_Me_', me)
    if (init?.method === 'POST') posts++
    return Response.json({ problem: { code: 'not_found' } }, { status: 404 })
  })
  expect(await uploads.upload(denied, draft.requestId)).toMatchObject({
    state: 'failed',
    problem: 'not_found',
  })
  expect(posts).toBe(0)
  expect(uploads.list()[0]?.requestId).toBe(draft.requestId)
  const forgotten = api(async (raw, init) => {
    if (String(raw).endsWith('/me')) return data('Envelope_Me_', me)
    if (init?.method === 'POST') posts++
    return data('Envelope_RequestReceipt_', { found: false })
  })
  expect(await uploads.upload(forgotten, draft.requestId)).toMatchObject({
    state: 'failed',
    problem: 'not_found',
  })
  expect(posts).toBe(0)
})

it('checks downloaded bytes before cache publication and never bypasses authorization with a cached hash', async () => {
  const { root } = await setup(),
    cache = new ContentCache(join(root, 'cache')),
    original = Buffer.from('verified content'),
    sha256 = createHash('sha256').update(original).digest('hex')
  let mode = 'corrupt'
  const client = api(async () =>
    mode === 'denied'
      ? Response.json({ problem: { code: 'not_found' } }, { status: 404 })
      : new Response(mode === 'corrupt' ? Buffer.from('different bytes') : original, {
          headers: { ETag: '"' + sha256 + '"' },
        }),
  )
  await expect(cache.download(client, 'attachment')).rejects.toThrow('content_hash_mismatch')
  expect(await readdir(cache.root)).toEqual([])
  mode = 'good'
  const result = await cache.download(client, 'attachment')
  expect(await readFile(result.path)).toEqual(original)
  mode = 'denied'
  await expect(cache.download(client, 'attachment')).rejects.toThrow('not_found')
  await writeFile(result.path, 'local corruption')
  mode = 'good'
  await cache.download(client, 'attachment')
  expect(await cache.bytes(result.path, sha256)).toEqual(original)
  const saved = join(root, 'saved.txt')
  await cache.save(result.path, sha256, saved)
  expect(await readFile(saved)).toEqual(original)
  await writeFile(result.path, 'corrupted again')
  await expect(cache.save(result.path, sha256, saved)).rejects.toThrow('content_hash_mismatch')
  expect(await readFile(saved)).toEqual(original)
  expect((await readdir(root)).some((name) => name.endsWith('.part'))).toBe(false)
})
