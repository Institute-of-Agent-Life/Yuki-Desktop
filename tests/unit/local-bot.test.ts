import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
import { LocalBot, runDocker } from '../../src/main/local-bot'
import { Connections } from '../../src/main/connections'
import { LocalStore } from '../../src/main/store'

const resources: {
  root: string
  store: LocalStore
  connections: Connections
  bot: LocalBot
  directory: string
}[] = []
afterEach(async () => {
  for (const value of resources.splice(0)) {
    const owned = relative(resolve(tmpdir()), resolve(value.root))
    if (isAbsolute(owned) || owned.startsWith('..') || !owned.startsWith('yuki-local-bot-e2e-'))
      throw Error('Unexpected local deployment test directory')
    await value.connections.close()
    const project =
      'yuki-desktop-' + createHash('sha256').update(value.directory).digest('hex').slice(0, 12)
    await runDocker([
      'compose',
      '--project-directory',
      value.directory,
      '-p',
      project,
      '-f',
      join(value.directory, 'docker-compose.yml'),
      '-f',
      join(value.directory, 'docker-compose.local.yml'),
      'down',
    ])
    value.store.db.close()
    await rm(value.root, { recursive: true, force: true })
  }
})

it.skipIf(process.env.YUKI_TEST_DOCKER !== '1')(
  'deploys a real App-only Bot, creates the original Person and pairs without platform accounts',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'yuki-local-bot-e2e-')),
      directory = join(root, '本機 Yuki'),
      store = new LocalStore(join(root, 'desktop.sqlite3')),
      connections = new Connections(store, root, '1.0.0-beta.1', () => {})
    // This test targets Compose/setup/pairing; stream lifetime is covered by the real UI suite.
    vi.spyOn(connections, 'start').mockImplementation(() => {})
    const port = await new Promise<number>((done) => {
      const socket = createServer()
      socket.listen(0, '127.0.0.1', () => {
        const address = socket.address()
        const value = typeof address === 'object' && address ? address.port : 0
        socket.close(() => done(value))
      })
    })
    const bot = new LocalBot({
      resources: resolve('resources/local-bot'),
      store,
      connections,
      progress: () => {},
    })
    resources.push({ root, store, connections, bot, directory })
    const result = await bot.deploy({
      directory,
      port,
      characterName: '本機測試角色',
      personName: '本機本人',
      model: {
        protocol: 'chat_completions',
        base_url: 'http://host.docker.internal:19999/v1',
        api_key: '',
        model: 'isolated-model',
      },
    })
    expect(result.baseUrl).toBe(`http://127.0.0.1:${port}`)
    expect(result.name).toBe('本機測試角色')
    const me = await connections.read<{
      person_id: string
      platform: string
      devices: { purpose: string }[]
    }>(result.characterId, { kind: 'me' }, false)
    expect(me.person_id).toBe(result.personId)
    expect(me.platform).toBe('app')
    expect(me.devices.map((item) => item.purpose)).toEqual(['chat'])
    const originalDevice = result.deviceId
    expect((await bot.connect()).deviceId).toBe(originalDevice)
    expect((await bot.state()).running).toBe(true)
    expect((await readFile(join(directory, 'character', 'SOUL.md'))).length).toBeGreaterThan(0)
  },
  180_000,
)
