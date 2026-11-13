/*
 * Platform settings (task book 2026-11-13 §3.2 desktop, failure cases 9 and 10, and §5 revision),
 * failure cases written before the code. SnowLuma is enabled by the backend's own steps: its
 * `yuki setup snowluma` is the only .env edit, run as root in a one-off Bot, then the Bot and
 * SnowLuma are started. A server runs `deploy/snowluma.sh <image>`; the local deployment runs the
 * script's two Compose steps itself (Windows has no sh), in its own Compose project.
 * - The command shown for a server reached only by URL is not the one line
 *   `sh deploy/snowluma.sh '<image>'`, or an image with a quote or space reaches the script as
 *   something else.
 * - An SSH-managed server runs it outside its deployment directory, or with a different command.
 * - The local deployment needs sh, copies a script into its directory, or runs Compose with files
 *   or a project other than its own (the Bot would be recreated in a second project), or with
 *   the deployment directory mounted anywhere but /deploy.
 * - The local deployment's two steps drift from the backend's script: another setup command,
 *   user, entrypoint or services than the script's own.
 * - An empty image still runs anything; a failed setup step still starts SnowLuma, or is taken
 *   as SnowLuma enabled.
 * - A server below Client API revision 11 is accepted, or the refusal loses its actual revision.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
import { snowLumaCommand, snowLumaOnServer } from '../../src/shared/snowluma'
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
  // As the scripts see it from inside (macOS links /var to /private/var).
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yuki-platforms-')))
  roots.push(root)
  return root
}
// A stand-in for the backend's deploy/snowluma.sh: it records where and how it ran.
const recorder = `#!/bin/sh
{
  printf 'args=%s|\n' "$@"
  printf 'cwd=%s\n' "$(pwd)"
} > "$(dirname "$0")/../ran"
`
const image = "registry.example.com/me/snow'luma:1 x"

it.skipIf(process.platform === 'win32')(
  'a server runs the one-line command in its deployment directory with the image intact',
  async () => {
    const root = await temporary(),
      deployment = join(root, "it's yuki")
    await mkdir(join(deployment, 'deploy'), { recursive: true })
    await writeFile(join(deployment, 'deploy/snowluma.sh'), recorder)
    const command = snowLumaCommand(image)
    expect(command).toBe(`sh deploy/snowluma.sh 'registry.example.com/me/snow'\\''luma:1 x'`)
    expect(command).not.toContain('\n')
    // An SSH-managed server: the same line, in its directory, as the deployment's owner.
    const remote = snowLumaOnServer(deployment, image, 'sudo -n ')
    expect(remote).toBe(`cd '${root}/it'\\''s yuki' && sudo -n ${command}`)
    const result = spawnSync('/bin/sh', ['-c', snowLumaOnServer(deployment, image, '')], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    const ran = await readFile(join(deployment, 'ran'), 'utf8')
    expect(ran).toBe(`args=${image}|\ncwd=${deployment}\n`)
  },
)

async function localBot(run: DockerRunner) {
  const root = await temporary(),
    directory = join(root, '本機 Yuki')
  await mkdir(directory, { recursive: true })
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
  // No resources: the local deployment needs nothing beyond its own Compose files.
  const bot = new LocalBot({
    resources: join(root, 'no-resources'),
    store,
    connections: {} as Connections,
    progress: () => {},
    run,
  })
  return { bot, directory, store }
}
const project = (directory: string) =>
  'yuki-desktop-' + createHash('sha256').update(directory).digest('hex').slice(0, 12)
// What every local Compose call names: this deployment's directory, project and files.
const own = (directory: string) => [
  'compose',
  '--project-directory',
  directory,
  '-p',
  project(directory),
  '-f',
  join(directory, 'docker-compose.yml'),
  '-f',
  join(directory, 'docker-compose.local.yml'),
]
const steps = (directory: string, value: string) => [
  [
    ...own(directory),
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '--user',
    '0:0',
    '--entrypoint',
    'yuki',
    '--volume',
    `${directory}:/deploy`,
    'bot',
    'setup',
    'snowluma',
    '--deployment-root',
    '/deploy',
    '--image',
    value,
  ],
  [...own(directory), 'up', '-d', 'bot', 'snowluma'],
]

it('the local deployment runs the two setup steps through its own Compose, with no script', async () => {
  const calls: string[][] = []
  const { bot, directory, store } = await localBot(async (args) => {
    calls.push(args)
    return args[0] === 'info' ? '"linux"' : ''
  })
  await bot.enableSnowLuma(` ${image} `)
  // The two steps, then the deployment's state is read again.
  const compose = calls.filter((args) => args[0] === 'compose')
  expect(compose.slice(0, 2)).toEqual(steps(directory, image))
  expect(compose.slice(2).every((args) => args.includes('ps'))).toBe(true)
  // Nothing is copied into the deployment, and no sh or environment carries the project.
  expect(await readdir(directory)).toEqual([])
  // The same project every other local Compose call uses.
  await bot.stop()
  const stop = calls.find((args) => args.includes('stop'))!
  expect(stop.slice(0, own(directory).length)).toEqual(own(directory))
  store.db.close()
})

it('an empty image runs nothing; a failed setup step starts nothing and is reported', async () => {
  const calls: string[][] = []
  const { bot, directory, store } = await localBot(async (args) => {
    calls.push(args)
    if (args.includes('setup')) throw new ApiError('local_deployment_failed', 'setup failed')
    return ''
  })
  await expect(bot.enableSnowLuma('  ')).rejects.toThrow('validation_error')
  expect(calls).toEqual([])
  await expect(bot.enableSnowLuma('me/snowluma')).rejects.toThrow('local_deployment_failed')
  expect(calls).toEqual([steps(directory, 'me/snowluma')[0]])
  store.db.close()
})

// The backend's real script, with docker standing in: the local deployment's two steps are its
// two Compose calls, word for word after the Compose files and project.
it.skipIf(process.platform === 'win32' || !process.env.YUKI_BACKEND_TEST_ROOT)(
  "the local steps are the backend's deploy/snowluma.sh, call for call",
  async () => {
    const root = await temporary(),
      deployment = join(root, 'deployment'),
      bin = join(root, 'bin')
    await mkdir(join(deployment, 'deploy'), { recursive: true })
    await mkdir(bin)
    await writeFile(
      join(deployment, 'deploy/snowluma.sh'),
      await readFile(join(process.env.YUKI_BACKEND_TEST_ROOT!, 'deploy/snowluma.sh')),
    )
    // One argument per line, one blank line after each call.
    await writeFile(
      join(bin, 'docker'),
      '#!/bin/sh\nfor value in "$@"; do printf "%s\\n" "$value"; done >> "$(pwd)/docker-calls"\necho >> "$(pwd)/docker-calls"\n',
    )
    await chmod(join(bin, 'docker'), 0o755)
    const result = spawnSync('sh', ['deploy/snowluma.sh', 'me/snowluma:1'], {
      cwd: deployment,
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    const script = (await readFile(join(deployment, 'docker-calls'), 'utf8'))
      .trim()
      .split('\n\n')
      .map((call) => call.split('\n'))
    const calls: string[][] = []
    const { bot, directory, store } = await localBot(async (args) => {
      calls.push(args)
      return ''
    })
    await bot.enableSnowLuma('me/snowluma:1')
    const compose = calls.filter((args) => args[0] === 'compose' && !args.includes('ps'))
    expect(compose.map((args) => ['compose', ...args.slice(own(directory).length)])).toEqual(
      script.map((call) => call.map((value) => value.replace(deployment, directory))),
    )
    store.db.close()
  },
)

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
