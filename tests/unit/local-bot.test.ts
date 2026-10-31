import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createServer } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { parseEnv } from 'node:util'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
import { LocalBot, runDocker } from '../../src/main/local-bot'
import { Connections } from '../../src/main/connections'
import { LocalStore } from '../../src/main/store'
import type { Me } from '../../src/shared/api'
import type { LocalBotInstallation } from '../../src/shared/local-bot'

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
    const presets = await bot.presets()
    expect(presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'openai_compatible',
          protocol: 'chat_completions',
          supports_embedding: true,
        }),
      ]),
    )
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
    const me = await connections.read<Me>(result.characterId, { kind: 'me' }, false)
    expect(me.person_id).toBe(result.personId)
    expect(me.platform).toBe('app')
    expect(me.is_superuser).toBe(true)
    const bundle = await connections.modelBundle(result.characterId)
    expect(bundle.valid).toBe(true)
    expect(bundle.provider_presets).toEqual(presets)
    expect(me.devices.map((item) => item.purpose)).toEqual(['chat'])
    const originalDevice = result.deviceId
    const originalGrant = store.get<LocalBotInstallation>('local-bot')!.superuserRequestId
    expect(originalGrant).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/)
    expect((await bot.connect()).deviceId).toBe(originalDevice)
    expect(store.get<LocalBotInstallation>('local-bot')!.superuserRequestId).toBe(originalGrant)
    expect((await bot.state()).running).toBe(true)
    expect((await readFile(join(directory, 'character', 'SOUL.md'))).length).toBeGreaterThan(0)

    // Failures: reconnect must not revive a revoked grant, and the old
    // installation format without a grant UUID must not create a new one.
    const environment = parseEnv(await readFile(join(directory, '.env'), 'utf8')),
      operator = { Authorization: `Bearer ${environment.YUKI_CONTROL_OPERATOR_TOKEN}` },
      personUrl = `${result.baseUrl}/admin/v1/persons/${result.personId}`,
      receiptUrl = `${result.baseUrl}/admin/v1/operations/${originalGrant}`,
      originalReceipt = await (await fetch(receiptUrl, { headers: operator })).json(),
      person = await (await fetch(personUrl, { headers: operator })).json()
    const revoked = await fetch(`${personUrl}/superuser/revoke`, {
      method: 'POST',
      headers: { ...operator, 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: randomUUID(), expected_revision: person.data.revision }),
    })
    expect(revoked.status).toBe(200)
    const revokedPerson = await (await fetch(personUrl, { headers: operator })).json()
    expect(revokedPerson.data.is_superuser).toBe(false)
    await connections.prepareLogout(result.characterId)
    await connections.finishLogout(result.characterId, originalDevice!, 'keep')
    const reconnected = await bot.connect(),
      reconnectMe = await connections.read<Me>(result.characterId, { kind: 'me' }, false)
    expect(reconnected.personId).toBe(result.personId)
    expect(reconnected.deviceId).not.toBe(originalDevice)
    expect(reconnectMe.is_superuser).toBe(false)
    expect(store.get<LocalBotInstallation>('local-bot')!.superuserRequestId).toBe(originalGrant)
    expect(await (await fetch(receiptUrl, { headers: operator })).json()).toEqual(originalReceipt)
    expect(await (await fetch(personUrl, { headers: operator })).json()).toEqual(revokedPerson)

    await connections.prepareLogout(result.characterId)
    await connections.finishLogout(result.characterId, reconnected.deviceId!, 'keep')
    const legacy = store.get<LocalBotInstallation>('local-bot')!
    delete legacy.superuserRequestId
    store.set('local-bot', legacy)
    const oldPairRequest = legacy.pairRequestId,
      oldReconnected = await bot.connect(),
      oldMe = await connections.read<Me>(result.characterId, { kind: 'me' }, false),
      preserved = store.get<LocalBotInstallation>('local-bot')!
    expect(oldReconnected.personId).toBe(result.personId)
    expect(oldReconnected.deviceId).not.toBe(reconnected.deviceId)
    expect(oldMe.is_superuser).toBe(false)
    expect(preserved.superuserRequestId).toBeUndefined()
    expect(preserved.personRequestId).toBe(legacy.personRequestId)
    expect(preserved.pairRequestId).not.toBe(oldPairRequest)
    expect(await (await fetch(personUrl, { headers: operator })).json()).toEqual(revokedPerson)
    expect(await (await fetch(receiptUrl, { headers: operator })).json()).toEqual(originalReceipt)
    const evidence = process.env.YUKI_E2E_OUTPUT ?? join(tmpdir(), 'yuki-local-bot-evidence')
    await mkdir(evidence, { recursive: true })
    await writeFile(
      join(evidence, 'local-reconnect.json'),
      JSON.stringify(
        {
          personId: result.personId,
          originalDevice,
          originalGrant,
          revokedReconnect: {
            deviceId: reconnected.deviceId,
            isSuperuser: reconnectMe.is_superuser,
          },
          legacyReconnect: {
            deviceId: oldReconnected.deviceId,
            isSuperuser: oldMe.is_superuser,
            installation: preserved,
          },
          originalReceipt,
          revokedPerson,
        },
        null,
        2,
      ),
    )
  },
  180_000,
)
