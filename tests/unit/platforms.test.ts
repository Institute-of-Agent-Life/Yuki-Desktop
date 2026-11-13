/*
 * Platform settings (task book 2026-11-13 §3.2 desktop, failure cases 9 and 10, and §5 revision),
 * failure cases written before the code. SnowLuma is enabled by the backend's own
 * `deploy/snowluma.sh <image>`, run in the deployment directory; the desktop keeps no copy of its
 * .env edit.
 * - The command shown for a server reached only by URL is not the one line
 *   `sh deploy/snowluma.sh '<image>'`, or an image with a quote or space reaches the script as
 *   something else.
 * - An SSH-managed server runs it outside its deployment directory, or with a different command.
 * - The local deployment runs an older copy of the script than the one bundled with its image, runs
 *   it outside its directory, or with Compose files or a project other than its own (the Bot
 *   would be recreated in a second project), or without the docker the desktop found.
 * - An empty image still runs the script.
 * - The local deployment reports SnowLuma enabled though the script failed.
 * - With the backend's actual script, its one-off setup Bot or `up` runs in another project.
 * - A server below Client API revision 11 is accepted, or the refusal loses its actual revision.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
import { enableSnowLumaOnServer } from '../../src/main/snowluma'
import { snowLumaCommand } from '../../src/shared/snowluma'
import { LocalBot, type DockerRunner } from '../../src/main/local-bot'
import { Connections } from '../../src/main/connections'
import { LocalStore } from '../../src/main/store'
import { ApiError } from '../../src/main/api/client'
import type { Meta } from '../../src/shared/api'

const roots: string[] = []
const path = process.env.PATH
afterEach(async () => {
  vi.unstubAllGlobals()
  process.env.PATH = path
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function temporary() {
  // As the scripts see it from inside (macOS links /var to /private/var).
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yuki-platforms-')))
  roots.push(root)
  return root
}
// A stand-in for the backend's deploy/snowluma.sh: it records where and how it ran.
const recorder = (exit = 0) => `#!/bin/sh
{
  printf 'args=%s|\n' "$@"
  printf 'cwd=%s\n' "$(pwd)"
  printf 'compose_file=%s\n' "$COMPOSE_FILE"
  printf 'project=%s\n' "$COMPOSE_PROJECT_NAME"
  printf 'docker=%s\n' "$(command -v docker)"
} > "$(dirname "$0")/../ran"
exit ${exit}
`
const image = "registry.example.com/me/snow'luma:1 x"

it.skipIf(process.platform === 'win32')(
  'a server runs the one-line command in its deployment directory with the image intact',
  async () => {
    const root = await temporary(),
      deployment = join(root, "it's yuki")
    await mkdir(join(deployment, 'deploy'), { recursive: true })
    await writeFile(join(deployment, 'deploy/snowluma.sh'), recorder())
    const command = snowLumaCommand(image)
    expect(command).toBe(`sh deploy/snowluma.sh 'registry.example.com/me/snow'\\''luma:1 x'`)
    expect(command).not.toContain('\n')
    const scripts: string[] = []
    await enableSnowLumaOnServer(
      async (script) => {
        scripts.push(script)
        const result = spawnSync('/bin/sh', ['-c', script], { cwd: root, encoding: 'utf8' })
        if (result.status !== 0) throw Error(result.stderr)
        return result.stdout
      },
      deployment,
      image,
    )
    expect(scripts[0]!.split('\n').at(-1)).toBe(command)
    const ran = await readFile(join(deployment, 'ran'), 'utf8')
    expect(ran).toContain(`args=${image}|\n`)
    expect(ran).toContain(`cwd=${deployment}\n`)
  },
)

async function localBot(run: DockerRunner, exit = 0) {
  const root = await temporary(),
    directory = join(root, '本機 Yuki'),
    resources = join(root, 'resources')
  await mkdir(join(directory, 'deploy'), { recursive: true })
  await mkdir(join(resources, 'deploy'), { recursive: true })
  // An older copy from an earlier enable stays behind; the bundled one replaces it.
  await writeFile(join(directory, 'deploy/snowluma.sh'), '#!/bin/sh\nexit 7\n')
  await writeFile(join(resources, 'deploy/snowluma.sh'), recorder(exit))
  // The docker the desktop finds, and nothing else of that name on PATH.
  const bin = join(root, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, 'docker'), '#!/bin/sh\nexit 0\n')
  await chmod(join(bin, 'docker'), 0o755)
  process.env.PATH = [bin, '/usr/bin', '/bin'].join(delimiter)
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
    resources,
    store,
    connections: {} as Connections,
    progress: () => {},
    run,
  })
  return { bot, directory, store, bin }
}
const project = (directory: string) =>
  'yuki-desktop-' + createHash('sha256').update(directory).digest('hex').slice(0, 12)

it.skipIf(process.platform === 'win32')(
  'the local deployment runs the bundled script in its own directory, Compose files and project',
  async () => {
    const calls: string[][] = []
    const { bot, directory, store, bin } = await localBot(async (args) => {
      calls.push(args)
      return args[0] === 'info' ? '"linux"' : ''
    })
    await bot.enableSnowLuma(image)
    expect(await readFile(join(directory, 'deploy/snowluma.sh'), 'utf8')).toBe(recorder())
    const ran = await readFile(join(directory, 'ran'), 'utf8')
    expect(ran).toBe(
      [
        `args=${image}|`,
        `cwd=${directory}`,
        'compose_file=docker-compose.yml:docker-compose.local.yml',
        `project=${project(directory)}`,
        `docker=${join(bin, 'docker')}`,
        '',
      ].join('\n'),
    )
    // The same project every other local Compose call uses.
    await bot.stop()
    const stop = calls.find((args) => args.includes('stop'))!
    expect(stop[stop.indexOf('-p') + 1]).toBe(project(directory))
    store.db.close()
  },
)

it.skipIf(process.platform === 'win32')(
  'an empty image runs nothing, and a failed script is reported, not taken as SnowLuma running',
  async () => {
    const { bot, directory, store } = await localBot(async () => '', 3)
    await expect(bot.enableSnowLuma('  ')).rejects.toThrow('validation_error')
    await expect(readFile(join(directory, 'ran'), 'utf8')).rejects.toThrow()
    await expect(bot.enableSnowLuma('me/snowluma')).rejects.toThrow('local_deployment_failed')
    store.db.close()
  },
)

// The backend's real script, with docker standing in: both of its Compose calls reach this
// deployment's files and project, and an image is required.
it.skipIf(process.platform === 'win32' || !process.env.YUKI_BACKEND_TEST_ROOT)(
  "the backend's deploy/snowluma.sh runs both Compose calls in the local deployment's project",
  async () => {
    const { bot, directory, store, bin } = await localBot(async () => '')
    await writeFile(
      join(bin, 'docker'),
      '#!/bin/sh\nprintf "%s %s | %s\\n" "$COMPOSE_PROJECT_NAME" "$COMPOSE_FILE" "$*" >> "$(pwd)/docker-calls"\n',
    )
    await writeFile(
      join(directory, '../resources/deploy/snowluma.sh'),
      await readFile(join(process.env.YUKI_BACKEND_TEST_ROOT!, 'deploy/snowluma.sh')),
    )
    await bot.enableSnowLuma('me/snowluma:1')
    const prefix = `${project(directory)} docker-compose.yml:docker-compose.local.yml | compose`
    expect((await readFile(join(directory, 'docker-calls'), 'utf8')).split('\n')).toEqual([
      `${prefix} run --rm --no-deps -T --user 0:0 --entrypoint yuki --volume ${directory}:/deploy bot setup snowluma --deployment-root /deploy --image me/snowluma:1`,
      `${prefix} up -d bot snowluma`,
      '',
    ])
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
