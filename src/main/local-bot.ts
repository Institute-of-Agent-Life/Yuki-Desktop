import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve, delimiter, isAbsolute } from 'node:path'
import type {
  LocalBotConfiguration,
  LocalBotInstallation,
  LocalBotState,
} from '../shared/local-bot'
import type { LocalStore } from './store'
import type { Connections } from './connections'
import { ApiError } from './api/client'

export type DockerRunner = (
  args: string[],
  options?: { cwd?: string; input?: string },
) => Promise<string>
async function dockerExecutable() {
  for (const directory of (process.env.PATH ?? '')
    .split(delimiter)
    .filter((value) => isAbsolute(value))) {
    const path = join(directory, process.platform === 'win32' ? 'docker.exe' : 'docker')
    if (
      await stat(path).then(
        (info) => info.isFile(),
        () => false,
      )
    )
      return path
  }
  throw new ApiError('docker_unavailable')
}
export const runDocker: DockerRunner = async (args, options = {}) =>
  new Promise((done, reject) => {
    void dockerExecutable()
      .then((executable) => {
        const child = spawn(executable, args, {
          cwd: options.cwd,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        let output = '',
          diagnostic = ''
        child.stdout.setEncoding('utf8').on('data', (chunk) => {
          output += chunk
        })
        child.stderr.setEncoding('utf8').on('data', (chunk) => {
          diagnostic += chunk
        })
        child.on('error', () => reject(new ApiError('docker_unavailable')))
        child.on('close', (code) => {
          if (code === 0) done(output)
          else
            reject(
              new ApiError(
                /port is already allocated|address already in use/i.test(diagnostic)
                  ? 'local_port_in_use'
                  : 'local_deployment_failed',
              ),
            )
        })
        child.stdin.on('error', () => reject(new ApiError('local_deployment_failed')))
        child.stdin.end(options.input)
      })
      .catch(reject)
  })

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Owns one explicitly selected Compose directory; Compose owns service state. */
export class LocalBot {
  private deployment?: Promise<import('../shared/api').Connection>
  constructor(
    private readonly options: {
      resources: string
      store: LocalStore
      connections: Connections
      progress(message: string): void
      run?: DockerRunner
    },
  ) {}
  private get run() {
    return this.options.run ?? runDocker
  }
  private installation() {
    const value = this.options.store.get<LocalBotInstallation>('local-bot')
    if (!value) throw new ApiError('local_bot_not_configured')
    return value
  }
  private compose(item: LocalBotInstallation, command: string[], input?: string) {
    const project =
      'yuki-desktop-' + createHash('sha256').update(item.directory).digest('hex').slice(0, 12)
    return this.run(
      [
        'compose',
        '--project-directory',
        item.directory,
        '-p',
        project,
        '-f',
        join(item.directory, 'docker-compose.yml'),
        '-f',
        join(item.directory, 'docker-compose.local.yml'),
        ...command,
      ],
      { cwd: item.directory, input },
    )
  }
  async state(): Promise<LocalBotState> {
    const installation = this.options.store.get<LocalBotInstallation>('local-bot') ?? null
    const bundled = await exists(join(this.options.resources, 'manifest.json'))
    let docker = false,
      running = false,
      problem: string | undefined
    try {
      const platform = JSON.parse(await this.run(['info', '--format', '{{json .OSType}}']))
      docker = platform === 'linux'
      if (!docker) problem = 'docker_linux_required'
      if (docker && installation) {
        const ids = (
          await this.compose(installation, ['ps', '--status', 'running', '-q', 'bot'])
        ).trim()
        running = !!ids
      }
    } catch (error) {
      problem = error instanceof ApiError ? error.code : 'docker_unavailable'
    }
    return {
      docker,
      bundled,
      installation,
      configured: !!installation && (await exists(join(installation.directory, '.env'))),
      running,
      busy: !!this.deployment,
      ...(problem ? { problem } : {}),
    }
  }
  deploy(input: LocalBotConfiguration) {
    if (this.deployment) return this.deployment
    const work = this.deployNew(input).finally(() => {
      this.deployment = undefined
    })
    this.deployment = work
    return work
  }
  private async deployNew(input: LocalBotConfiguration) {
    const current = await this.state()
    if (!current.docker) throw new ApiError(current.problem ?? 'docker_unavailable')
    if (!current.bundled) throw new ApiError('local_bot_not_bundled')
    const directory = resolve(input.directory)
    const previous = current.installation
    if (previous && previous.directory !== directory)
      throw new ApiError('local_installation_exists')
    if (
      !previous &&
      ((await exists(join(directory, '.env'))) ||
        (await exists(join(directory, 'docker-compose.yml'))) ||
        (await exists(join(directory, 'data', 'yuki.db'))))
    )
      throw new ApiError('local_existing_deployment')
    if (
      !Number.isInteger(input.port) ||
      input.port < 1 ||
      input.port > 65535 ||
      !input.characterName.trim() ||
      !input.personName.trim()
    )
      throw new ApiError('validation_error')
    const manifest = JSON.parse(
      await readFile(join(this.options.resources, 'manifest.json'), 'utf8'),
    ) as { image: string; version: string }
    const item: LocalBotInstallation = previous ?? {
      directory,
      address: `http://127.0.0.1:${input.port}`,
      port: input.port,
      image: manifest.image,
      characterName: input.characterName.trim(),
      personName: input.personName.trim(),
      personRequestId: randomUUID(),
      pairRequestId: randomUUID(),
    }
    await mkdir(directory, { recursive: true })
    for (const name of [
      '.env.example',
      'docker-compose.yml',
      'docker-compose.local.yml',
      'config/SOUL.md',
    ]) {
      const destination = join(directory, name)
      if (!(await exists(destination))) {
        await mkdir(dirname(destination), { recursive: true })
        await copyFile(join(this.options.resources, name), destination)
      }
    }
    this.options.store.set('local-bot', item)
    // These variables belong to this Compose invocation, not the user's shell or
    // another project. Put its explicit image/port into the local override file.
    const override = await readFile(join(directory, 'docker-compose.local.yml'), 'utf8')
    const configuredOverride = override
      .replace(
        '${YUKI_LOCAL_IMAGE:-ghcr.io/yuanyeyoutao/yuki:${YUKI_VERSION:?missing}}',
        JSON.stringify(item.image),
      )
      .replace('${YUKI_LOCAL_PORT:-8080}', String(item.port))
      .replace('${YUKI_LOCAL_UID:-10001}', String(process.getuid?.() ?? 10001))
      .replace('${YUKI_LOCAL_GID:-10001}', String(process.getgid?.() ?? 10001))
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(directory, 'docker-compose.local.yml'), configuredOverride)
    this.options.progress('準備本機 Yuki 映像')
    await this.run(['image', 'inspect', item.image]).catch(() =>
      this.run(['pull', item.image]).catch(() => {
        throw new ApiError('local_image_unavailable')
      }),
    )
    if (!(await exists(join(directory, '.env')))) {
      this.options.progress('儲存模型與本機設定')
      const model = { ...input.model }
      const endpoint = new URL(model.base_url)
      if (['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
        endpoint.hostname = 'host.docker.internal'
        model.base_url = endpoint.toString()
      }
      await this.run(
        [
          'run',
          '--rm',
          '-i',
          '--user',
          `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
          '-v',
          `${directory}:/deploy`,
          '--entrypoint',
          'yuki',
          item.image,
          'setup',
          'desktop-configure',
          '--deployment-root',
          '/deploy',
        ],
        { input: JSON.stringify(model) },
      )
    }
    for (const name of [
      'data',
      'character',
      'workspace',
      'social-transfer',
      'plugins',
      'webui-config',
    ])
      await mkdir(join(directory, name), { recursive: true })
    this.options.progress('初始化 Yuki 與資料庫')
    await this.compose(item, [
      'run',
      '--rm',
      '--no-deps',
      '--entrypoint',
      'yuki',
      'bot',
      'init-db',
      '--character-name',
      item.characterName,
    ])
    await this.start()
    return this.connect(false)
  }
  async start() {
    const item = this.installation()
    this.options.progress('啟動本機 Yuki')
    await this.compose(item, ['up', '-d', '--wait', 'bot'])
    return this.state()
  }
  async stop() {
    await this.compose(this.installation(), ['stop', 'bot'])
    return this.state()
  }
  async connect(newCode = true) {
    const item = this.installation()
    const meta = await this.options.connections.meta(item.address)
    const pending = this.options.connections
      .pendingPairings()
      .find((value) => value.characterId === meta.character.id && value.baseUrl === item.address)
    if (pending)
      return this.options.connections.resumePairing(pending.characterId, pending.deviceId)
    const existing = this.options.connections
      .list()
      .find(
        (value) => value.characterId === meta.character.id && !value.needsPairing && !value.logout,
      )
    if (existing) return existing
    if (newCode) item.pairRequestId = randomUUID()
    if (newCode || item.superuserRequestId === undefined) {
      item.superuserRequestId ??= randomUUID()
      this.options.store.set('local-bot', item)
    }
    this.options.progress('建立本人入口並連接桌面')
    const result = JSON.parse(
      await this.compose(
        item,
        ['exec', '-T', 'bot', 'yuki', 'setup', 'desktop-pair', '--deployment-root', '/app'],
        JSON.stringify({
          display_name: item.personName,
          person_request_id: item.personRequestId,
          pair_request_id: item.pairRequestId,
          superuser_request_id: item.superuserRequestId,
          ...(item.personId ? { person_id: item.personId } : {}),
        }),
      ),
    ) as { person_id: string; code: string | null }
    item.personId = result.person_id
    this.options.store.set('local-bot', item)
    if (!result.code) throw new ApiError('local_pairing_code_unavailable')
    return this.options.connections.pair(item.address, result.code, 'Yuki Desktop')
  }
}
