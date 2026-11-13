/*
 * Platform settings (task book 2026-11-13 §3.2 desktop, failure cases 9 and 10, and §5 revision),
 * failure cases written before the code:
 * - Enabling SnowLuma drops an existing COMPOSE_PROFILES entry, lists `snowluma` twice, or leaves
 *   the image, `SNOWLUMA_VNC_HOST=snowluma`, the OneBot token or the VNC password unset.
 * - A real token or VNC password already in .env is replaced: SnowLuma and the Bot would no longer
 *   share the token, and the saved QQ display password changes under the operator.
 * - An empty or `replace-with-…` placeholder token or password survives.
 * - Comments and unrelated keys change.
 * - The script shown for a server reached only by URL writes a different .env than the local edit,
 *   breaks on a quote in the image, or does not run `docker compose up -d bot snowluma`.
 * - The local deployment reports SnowLuma enabled though Compose failed, or runs Compose outside its
 *   own project directory and override files.
 * - A server below Client API revision 11 is accepted, or the refusal loses its actual revision.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
import { snowLumaEnvironment } from '../../src/main/snowluma'
import { snowLumaServerScript } from '../../src/shared/snowluma'
import { LocalBot, type DockerRunner } from '../../src/main/local-bot'
import { Connections } from '../../src/main/connections'
import { LocalStore } from '../../src/main/store'
import { ApiError } from '../../src/main/api/client'
import type { Meta } from '../../src/shared/api'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'yuki-platforms-'))
  roots.push(root)
  return root
}
const values = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
const generated = /^[0-9a-f]{48}$/

const server = `# 默认不启动 QQ
COMPOSE_PROFILES=speech
LLM_MODEL=fake # stays
ONEBOT_ACCESS_TOKEN=replace-with-a-long-random-token
SNOWLUMA_IMAGE=
SNOWLUMA_VNC_HOST=
SNOWLUMA_VNC_PASSWORD=existing-password-123
`
// What `yuki setup desktop-configure` leaves: no SnowLuma keys at all, empty profile and token.
const local = `COMPOSE_PROFILES=""
ONEBOT_ACCESS_TOKEN=""
LLM_MODEL=fake`

it('adds the profile, image, display host and missing secrets, keeping everything else', () => {
  const edited = snowLumaEnvironment(server, 'registry.example.com/me/snowluma:1')
  const result = values(edited)
  expect(result).toMatchObject({
    COMPOSE_PROFILES: 'speech,snowluma',
    LLM_MODEL: 'fake # stays',
    SNOWLUMA_IMAGE: 'registry.example.com/me/snowluma:1',
    SNOWLUMA_VNC_HOST: 'snowluma',
    SNOWLUMA_VNC_PASSWORD: 'existing-password-123',
  })
  expect(result.ONEBOT_ACCESS_TOKEN).toMatch(generated)
  expect(edited.startsWith('# 默认不启动 QQ\n')).toBe(true)
  expect(edited.split('\n').filter((line) => line.startsWith('SNOWLUMA_IMAGE='))).toHaveLength(1)

  const fresh = values(snowLumaEnvironment(local, 'me/snowluma'))
  expect(fresh).toMatchObject({
    COMPOSE_PROFILES: 'snowluma',
    LLM_MODEL: 'fake',
    SNOWLUMA_IMAGE: 'me/snowluma',
    SNOWLUMA_VNC_HOST: 'snowluma',
  })
  expect(fresh.ONEBOT_ACCESS_TOKEN).toMatch(generated)
  expect(fresh.SNOWLUMA_VNC_PASSWORD).toMatch(generated)
})

it('enabling again keeps the profile once and the secrets SnowLuma already uses', () => {
  const first = snowLumaEnvironment(local, 'me/snowluma:1')
  const second = values(snowLumaEnvironment(first, 'me/snowluma:2'))
  expect(second).toEqual({ ...values(first), SNOWLUMA_IMAGE: 'me/snowluma:2' })
})

it.skipIf(process.platform === 'win32')(
  'the server script writes what the local edit writes and starts the Bot with SnowLuma',
  async () => {
    const root = await temporary(),
      bin = join(root, 'bin'),
      deployment = join(root, 'yuki')
    await mkdir(bin)
    await mkdir(deployment)
    await writeFile(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DOCKER_CALLS"\n')
    await chmod(join(bin, 'docker'), 0o755)
    await writeFile(join(deployment, '.env'), server, { mode: 0o600 })
    const image = "registry.example.com/me/snow'luma:1"
    const run = (script: string) =>
      spawnSync('/bin/sh', ['-c', script], {
        cwd: deployment,
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          DOCKER_CALLS: join(root, 'calls'),
        },
        encoding: 'utf8',
      })
    const first = run(snowLumaServerScript(image))
    expect(first.status, first.stderr).toBe(0)
    const written = await readFile(join(deployment, '.env'), 'utf8')
    const expected = values(snowLumaEnvironment(server, image)),
      actual = values(written)
    expect(actual.ONEBOT_ACCESS_TOKEN).toMatch(generated)
    expect({ ...actual, ONEBOT_ACCESS_TOKEN: '' }).toEqual({ ...expected, ONEBOT_ACCESS_TOKEN: '' })
    expect(written.startsWith('# 默认不启动 QQ\n')).toBe(true)
    expect(
      ((await import('node:fs')).statSync(join(deployment, '.env')).mode & 0o777).toString(8),
    ).toBe('600')
    // Run again: nothing is rotated or duplicated.
    expect(run(snowLumaServerScript(image)).status).toBe(0)
    expect(await readFile(join(deployment, '.env'), 'utf8')).toBe(written)
    expect(await readFile(join(root, 'calls'), 'utf8')).toBe(
      'compose up -d bot snowluma\ncompose up -d bot snowluma\n',
    )
  },
)

async function localBot(run: DockerRunner) {
  const root = await temporary(),
    directory = join(root, 'deployment')
  await mkdir(directory)
  await writeFile(join(directory, '.env'), local)
  const store = new LocalStore(join(root, 'desktop.sqlite3'))
  store.set('local-bot', {
    directory,
    address: 'http://127.0.0.1:18080',
    image: 'yuki:test',
    port: 18080,
    characterName: 'Yuki',
    personName: 'Me',
    personRequestId: crypto.randomUUID(),
    pairRequestId: crypto.randomUUID(),
  })
  const bot = new LocalBot({
    resources: join(root, 'resources'),
    store,
    connections: {} as Connections,
    progress: () => {},
    run,
  })
  return { bot, directory, store }
}

it('the local deployment edits its own .env and starts SnowLuma in its own Compose project', async () => {
  const calls: string[][] = []
  const { bot, directory, store } = await localBot(async (args) => {
    calls.push(args)
    return args[0] === 'info' ? '"linux"' : ''
  })
  await bot.enableSnowLuma('me/snowluma')
  const result = values(await readFile(join(directory, '.env'), 'utf8'))
  expect(result).toMatchObject({
    COMPOSE_PROFILES: 'snowluma',
    SNOWLUMA_IMAGE: 'me/snowluma',
    SNOWLUMA_VNC_HOST: 'snowluma',
  })
  const up = calls.find((args) => args.includes('up'))!
  expect(up.slice(0, 2)).toEqual(['compose', '--project-directory'])
  expect(up).toContain(join(directory, 'docker-compose.local.yml'))
  expect(up.slice(-4)).toEqual(['up', '-d', 'bot', 'snowluma'])
  store.db.close()
})

it('a Compose failure is reported, not taken as SnowLuma running', async () => {
  const { bot, store } = await localBot(async (args) => {
    if (args.includes('up')) throw new ApiError('local_deployment_failed')
    return ''
  })
  await expect(bot.enableSnowLuma('me/snowluma')).rejects.toThrow('local_deployment_failed')
  store.db.close()
})

it('refuses a server below revision 11 and reports its actual revision', async () => {
  const root = await temporary(),
    store = new LocalStore(join(root, 'desktop.sqlite3')),
    connections = new Connections(store, root, '1.0.0-beta.9', () => {})
  const meta: Meta = {
    api_revision: 10,
    capabilities: [],
    server_version: 'test',
    character: {
      id: '00000000-0000-4000-8000-000000000001',
      display_name: 'Yuki',
      accent: { light: '#123456', dark: '#abcdef' },
      avatar_url: null,
    },
    min_client: { desktop: null, android: null },
  }
  vi.stubGlobal('fetch', async () => Response.json({ data: meta }))
  const refused = await connections.meta('http://127.0.0.1:1/yuki').catch((error: unknown) => error)
  expect(refused).toBeInstanceOf(ApiError)
  expect(refused).toMatchObject({ code: 'server_upgrade_required', reason: '10' })
  vi.stubGlobal('fetch', async () => Response.json({ data: { ...meta, api_revision: 11 } }))
  expect((await connections.meta('http://127.0.0.1:1/yuki')).api_revision).toBe(11)
  await connections.close()
  store.db.close()
})
