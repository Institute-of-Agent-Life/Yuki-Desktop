import { afterEach, expect, it, vi } from 'vitest'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  NativeExecutorEffects,
  scopeDigest,
  type ExecutionAuthority,
  type NativeSubmissions,
} from '../../src/main/executor/effects'
import type { ExecutorTask } from '../../src/main/executor/runner'
vi.mock('node:fs/promises', async (importOriginal) => {
  const source = await importOriginal<typeof import('node:fs/promises')>()
  return { ...source, rename: vi.fn(source.rename) }
})
const folders: string[] = []
afterEach(async () => {
  const source = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rename).mockReset().mockImplementation(source.rename)
  for (const path of folders.splice(0)) await rm(path, { recursive: true, force: true })
})
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yuki-native-executor-')))
  folders.push(root)
  const scope = join(root, 'granted'),
    outside = join(root, 'private')
  await mkdir(scope)
  await mkdir(outside)
  const authority: ExecutionAuthority = { executorId: 'original-executor', grants: [], scopes: [] }
  for (const capability of ['folder.read', 'folder.write', 'open.file'])
    authority.grants.push({
      capability,
      scope: { alias: '收件匣', digest: scopeDigest(authority.executorId, scope) },
    })
  authority.grants.push({ capability: 'open.url' }, { capability: 'notify' })
  authority.scopes.push({
    alias: '收件匣',
    realpath: scope,
    digest: scopeDigest(authority.executorId, scope),
  })
  const submissions: string[] = []
  const native: NativeSubmissions = {
    async openURL(url) {
      submissions.push(`url:${url}`)
    },
    async openFile(path) {
      submissions.push(`file:${path}`)
      return ''
    },
    async notify(title, body) {
      submissions.push(`notify:${title}:${body}`)
      return true
    },
  }
  const content = Buffer.from('immutable artifact bytes')
  const effects = new NativeExecutorEffects(
    async () => authority,
    native,
    async () => content,
  )
  return { root, scope, outside, authority, effects, native, submissions, content }
}
const task = (capability: string, params: Record<string, unknown>): ExecutorTask => ({
  opId: 'original-op',
  capability,
  params,
  state: 'acknowledged',
})
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const write = (path: string, data: string, extra = {}) =>
  task('folder.write', {
    path,
    content_base64: Buffer.from(data).toString('base64'),
    ...extra,
  })

it('publishes real bytes atomically, reads back the hash and lists actual files', async () => {
  const env = await setup()
  const result = await env.effects.execute(write('收件匣/測試.txt', 'UTF-8內容'))
  const bytes = await readFile(join(env.scope, '測試.txt'))
  expect(result).toEqual({
    state: 'succeeded',
    level: 'confirmed',
    result: {
      sha256: digest(bytes),
      size: bytes.length,
      created: true,
    },
  })
  const read = await env.effects.execute(
    task('folder.read', { path: '收件匣/測試.txt', mode: 'read' }),
  )
  expect(read).toEqual({
    state: 'succeeded',
    level: 'confirmed',
    result: {
      sha256: digest(bytes),
      size: bytes.length,
      content_base64: bytes.toString('base64'),
    },
  })
  const listed = await env.effects.execute(task('folder.read', { path: '收件匣', mode: 'list' }))
  expect(listed.state).toBe('succeeded')
  expect(listed.result.entries).toEqual([
    expect.objectContaining({ name: '測試.txt', kind: 'file', size: bytes.length }),
  ])
  expect(await readdir(env.scope)).toEqual(['測試.txt'])
  expect((await env.effects.execute(write('收件匣/測試.txt', 'replacement'))).result.created).toBe(
    false,
  )
  expect(await readFile(join(env.scope, '測試.txt'), 'utf8')).toBe('replacement')
})

it('exclusive publication never overwrites a competing writer or leaves a partial destination', async () => {
  const env = await setup(),
    left = 'left'.repeat(100000),
    right = 'right'.repeat(100000)
  const results = await Promise.all([
    env.effects.execute(write('收件匣/race.txt', left, { if_absent: true })),
    env.effects.execute(write('收件匣/race.txt', right, { if_absent: true })),
  ])
  expect(results.filter((value) => value.state === 'succeeded')).toHaveLength(1)
  expect(results.filter((value) => value.state === 'failed')).toEqual([
    { state: 'failed', result: { reason: 'already_exists' } },
  ])
  const winner = await readFile(join(env.scope, 'race.txt'), 'utf8')
  expect([left, right]).toContain(winner)
  expect(await readdir(env.scope)).toEqual(['race.txt'])
})

it('rejects traversal, outside symlinks, changed roots and the root directory as a file', async () => {
  const env = await setup()
  await writeFile(join(env.outside, 'secret.txt'), 'private')
  await symlink(
    env.outside,
    join(env.scope, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  for (const path of [
    '收件匣/../private/secret.txt',
    '收件匣/escape/secret.txt',
    '收件匣/C:\\private\\secret.txt',
  ]) {
    expect((await env.effects.execute(write(path, 'overwrite'))).state).toBe('failed')
    expect((await env.effects.execute(task('folder.read', { path, mode: 'read' }))).state).toBe(
      'failed',
    )
  }
  expect((await env.effects.execute(write('收件匣', 'replace root'))).state).toBe('failed')
  expect(await readFile(join(env.outside, 'secret.txt'), 'utf8')).toBe('private')
  expect((await readdir(env.root)).sort()).toEqual(['granted', 'private'])
  await symlink(
    env.scope,
    join(env.root, 'root-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  env.authority.scopes[0]!.realpath = join(env.root, 'root-link')
  env.authority.scopes[0]!.digest = scopeDigest(
    env.authority.executorId,
    env.authority.scopes[0]!.realpath,
  )
  for (const grant of env.authority.grants)
    if (grant.scope) grant.scope.digest = env.authority.scopes[0]!.digest
  expect((await env.effects.execute(write('收件匣/no.txt', 'no'))).state).toBe('failed')
})

it('requires this executor’s actual digest mapping and current capability grant', async () => {
  const env = await setup()
  env.authority.executorId = 'another-executor'
  expect(await env.effects.execute(write('收件匣/no.txt', 'no'))).toEqual({
    state: 'failed',
    result: { reason: 'scope_unavailable' },
  })
  env.authority.executorId = 'original-executor'
  env.authority.grants = env.authority.grants.filter((grant) => grant.capability !== 'folder.write')
  expect(await env.effects.execute(write('收件匣/no.txt', 'no'))).toEqual({
    state: 'failed',
    result: { reason: 'permission_denied' },
  })
  expect(await readdir(env.scope)).toEqual([])
})

it('checks artifact bytes before publication and reports cold observations without proving causality', async () => {
  const env = await setup(),
    version = digest(env.content)
  const operation = task('folder.write', {
    path: '收件匣/report.txt',
    artifact_id: 'original-artifact',
    version,
  })
  expect((await env.effects.execute(operation)).state).toBe('succeeded')
  const current = await env.effects.observe(operation)
  expect(current).toEqual(
    expect.objectContaining({
      exists: true,
      sha256: version,
      size: env.content.length,
      matches_intended: true,
    }),
  )
  expect(current).not.toHaveProperty('succeeded')
  expect(current).not.toHaveProperty('confirmed')
  const bad = await env.effects.execute({
    ...operation,
    params: { ...operation.params, version: '0'.repeat(64) },
  })
  expect(bad).toEqual({ state: 'failed', result: { reason: 'content_mismatch' } })
  expect(await readFile(join(env.scope, 'report.txt'))).toEqual(env.content)
  await rm(join(env.scope, 'report.txt'))
  expect(await env.effects.observe(operation)).toEqual({ exists: false })
})

it('native submissions carry only submitted level and reject unsafe URL schemes', async () => {
  const env = await setup()
  await writeFile(join(env.scope, 'report.txt'), 'open this')
  for (const operation of [
    task('open.url', { url: 'https://example.test/a' }),
    task('open.file', { path: '收件匣/report.txt' }),
    task('notify', { title: 'Yuki', body: 'Ready' }),
  ])
    expect(await env.effects.execute(operation)).toEqual({
      state: 'succeeded',
      level: 'submitted',
      result: { submitted: true },
    })
  expect(env.submissions).toHaveLength(3)
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:secret@example.test',
  ])
    expect((await env.effects.execute(task('open.url', { url }))).state).toBe('failed')
  expect(env.submissions).toHaveLength(3)
  env.native.openFile = async () => 'OS error containing a private path'
  const refusal = await env.effects.execute(task('open.file', { path: '收件匣/report.txt' }))
  expect(refusal).toEqual({ state: 'failed', result: { reason: 'open_failed' } })
  expect(JSON.stringify(refusal)).not.toContain(env.scope)
})

it('keeps an ongoing native submission in progress and a lost native acknowledgement unknown', async () => {
  const env = await setup()
  let accepted!: () => void
  env.native.openURL = () =>
    new Promise<void>((resolve) => {
      accepted = resolve
    })
  let settled = false
  const pending = env.effects
    .execute(task('open.url', { url: 'https://example.test' }))
    .then((result) => {
      settled = true
      return result
    })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(settled).toBe(false)
  accepted()
  expect((await pending).state).toBe('succeeded')
  env.native.openURL = async () => {
    throw new Error('response lost')
  }
  expect(await env.effects.execute(task('open.url', { url: 'https://example.test' }))).toEqual({
    state: 'unknown',
    result: {},
    observation: undefined,
  })
})

it('retains uncertainty when publication happened but its I/O acknowledgement fails', async () => {
  const env = await setup()
  const source = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rename).mockImplementationOnce(async (from, to) => {
    await source.rename(from, to)
    throw Object.assign(new Error('injected I/O acknowledgement loss'), { code: 'EIO' })
  })
  const result = await env.effects.execute(write('收件匣/io.txt', 'published once'))
  expect(await readFile(join(env.scope, 'io.txt'), 'utf8')).toBe('published once')
  expect(result).toEqual({
    state: 'unknown',
    result: {},
    observation: expect.objectContaining({
      exists: true,
      matches_intended: true,
    }),
  })
  expect(result).not.toHaveProperty('level')
})

it('resolves a server grant carrying the contract sha256 prefix to the selected root', async () => {
  const env = await setup()
  for (const grant of env.authority.grants)
    if (grant.scope) grant.scope.digest = `sha256:${grant.scope.digest}`
  expect((await env.effects.execute(write('收件匣/prefixed.txt', 'original'))).state).toBe(
    'succeeded',
  )
  expect(await readFile(join(env.scope, 'prefixed.txt'), 'utf8')).toBe('original')
})

it.skipIf(process.platform === 'win32')(
  'refuses a real FIFO without blocking a native read',
  async () => {
    const env = await setup(),
      path = join(env.scope, 'named-pipe')
    execFileSync('mkfifo', [path])
    const reading = env.effects.execute(
      task('folder.read', { path: '收件匣/named-pipe', mode: 'read' }),
    )
    expect(await reading).toEqual({ state: 'failed', result: { reason: 'not_a_file' } })
    const listing = await env.effects.execute(task('folder.read', { path: '收件匣', mode: 'list' }))
    expect(listing.result.entries).toEqual([
      expect.objectContaining({ name: 'named-pipe', kind: 'other' }),
    ])
  },
)
