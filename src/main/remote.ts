import { randomUUID } from 'node:crypto'
import { access as exists, readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { basename, join } from 'node:path'
import type { ConnectorState } from '../shared/connector'
import type { SandboxProfile } from '../shared/local-bot'
import type { ProviderPreset } from '../shared/models'
import type {
  RemoteCheck,
  RemoteDeployInput,
  RemoteDeployState,
  RemoteDeployStep,
  SshAccess,
  SshProbe,
  SshTransport,
  TransportChange,
} from '../shared/ssh'
import { ApiError } from './api/client'
import type { Connections } from './connections'
import type { LocalStore } from './store'
import {
  CHECK,
  RemoteHost,
  open,
  parse,
  probe,
  quote,
  run,
  secretKey,
  tail,
  type Output,
} from './ssh'

/**
 * A fixed local port for one SSH connection, below every OS's ephemeral range (macOS and Windows
 * 49152+, Linux 32768+), so that outgoing connections never take it while the app is closed.
 */
async function freePort(): Promise<number> {
  for (;;) {
    const port = 20000 + Math.floor(Math.random() * 12768)
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (free) return port
  }
}
/** install.sh announces each pull; a run that ends right after one could not pull it. */
function installFailure(output: Output) {
  const last = output.stdout.trim().split('\n').pop() ?? ''
  return new ApiError(
    last.startsWith('Pulling ') ? 'remote_image_pull_failed' : 'remote_install_failed',
    tail(output),
  )
}
/** install.sh's own thresholds for its sandbox profile. */
const recommended = (memoryMiB: number): SandboxProfile =>
  memoryMiB < 2048 ? 'lite' : memoryMiB < 4096 ? 'headless' : 'desktop'

/**
 * SSH as the hand on the person's server: reach a deployment, install one with the installer and
 * package this desktop ships, upgrade it, read its logs. SSH as the path is the Connection's
 * transport, owned by Connections.
 */
export class RemoteYuki {
  constructor(
    private readonly options: {
      resources: string
      store: LocalStore
      connections: Connections
      connector: {
        state(characterId: string): Promise<ConnectorState>
        server(input: { characterId: string; server: string }): Promise<ConnectorState>
      }
      progress(step: RemoteDeployStep): void
    },
  ) {}
  private get connections() {
    return this.options.connections
  }
  async probe(host: string, port: number): Promise<SshProbe> {
    const presented = await probe(host, port),
      known = this.connections.knownHost(host, port)
    if (known && known !== presented) throw new ApiError('ssh_host_key_changed')
    return { fingerprint: presented, known: known === presented }
  }
  forgetHost(host: string, port: number) {
    this.connections.trustHost(host, port, undefined)
  }
  /** Log in with the key the person confirmed; a login that succeeds is remembered. */
  private async login(access: SshAccess) {
    const { target } = access,
      known = this.connections.knownHost(target.host, target.port)
    if (known && known !== access.fingerprint) throw new ApiError('ssh_host_key_changed')
    const client = await open(
      target,
      access.fingerprint,
      access.secret ?? this.connections.credentials.get(secretKey(target)),
    )
    this.connections.trustHost(target.host, target.port, access.fingerprint)
    if (access.secret !== undefined)
      this.connections.credentials.set(secretKey(target), access.secret)
    return client
  }
  private async host(access: SshAccess) {
    return RemoteHost.identify(await this.login(access))
  }
  /** The saved login of an SSH connection. */
  private saved(id: string) {
    const transport = this.connections.connection(id).transport
    if (transport?.kind !== 'ssh') throw new ApiError('precondition_failed')
    const fingerprint = this.connections.knownHost(transport.host, transport.port)
    if (!fingerprint) throw new ApiError('ssh_host_key_unknown')
    return { transport, access: { target: transport, fingerprint } }
  }
  private async transport(host: RemoteHost, access: SshAccess, directory: string) {
    return {
      ...access.target,
      kind: 'ssh',
      directory,
      remotePort: await host.port(directory),
      localPort: await freePort(),
    } satisfies SshTransport
  }

  /** "Connect over SSH": the deployment's pair.sh gives the code; nobody copies it. */
  async pair(input: { access: SshAccess; directory: string; label: string }) {
    const host = await this.host(input.access)
    try {
      const directory = host.directory(input.directory),
        code = await host.pairingCode(directory),
        transport = await this.transport(host, input.access, directory)
      return await this.connect(transport, code, input.label)
    } finally {
      host.close()
    }
  }
  private async connect(transport: SshTransport, code: string, label: string) {
    const previous = this.connections.list()
    const connection = await this.connections.pair(
      `http://127.0.0.1:${transport.localPort}`,
      code,
      label,
      transport,
    )
    const replaced = previous.find((item) => item.characterId === connection.characterId)?.transport
    if (replaced?.kind === 'ssh' && replaced.localPort !== transport.localPort)
      await this.connections.tunnels.close(replaced.localPort)
    return connection
  }

  /** Same Yuki, same device credential, another path; the Connector follows when it is ours. */
  async changeTransport(id: string, change: TransportChange) {
    let connection
    if (change.kind === 'direct')
      connection = await this.connections.changeAddress(id, change.server)
    else {
      const host = await this.host(change.access)
      try {
        const transport = await this.transport(
          host,
          change.access,
          host.directory(change.directory),
        )
        connection = await this.connections.changeAddress(
          id,
          `http://127.0.0.1:${transport.localPort}`,
          transport,
        )
      } finally {
        host.close()
      }
    }
    const state = await this.options.connector.state(id)
    if (!state.available || !state.paired || !state.admission?.matched) return { connection }
    try {
      await this.options.connector.server({ characterId: id, server: connection.baseUrl })
      return { connection }
    } catch (error) {
      return { connection, connectorProblem: error instanceof ApiError ? error.code : 'unknown' }
    }
  }

  async state(): Promise<RemoteDeployState> {
    try {
      const files = await this.bundle()
      return { bundled: true, version: files.version }
    } catch {
      return { bundled: false }
    }
  }
  /** The installer and package this desktop ships, for the backend version it was built with. */
  private async bundle() {
    const { version } = JSON.parse(
      await readFile(join(this.options.resources, 'manifest.json'), 'utf8'),
    ) as { version: string }
    const installer = join(this.options.resources, 'server', 'install.sh'),
      bundle = join(this.options.resources, 'server', `yuki-${version}-deploy.tar.gz`),
      script = await readFile(installer, 'utf8')
    await exists(bundle)
    const image = /^BOT_IMAGE="([^"]+)"$/m.exec(script)?.[1]
    if (/^VERSION="([^"]+)"$/m.exec(script)?.[1] !== version || !image)
      throw new ApiError('remote_bundle_mismatch')
    return { version, installer, bundle, image: `${image}:${version}` }
  }

  async check(access: SshAccess): Promise<RemoteCheck> {
    const client = await this.login(access)
    try {
      const facts = parse(await run(client, CHECK))
      const memoryMiB = Number(facts.memory)
      return {
        os: facts.os ?? '',
        arch: facts.arch ?? '',
        memoryMiB,
        diskMiB: Number(facts.disk),
        docker: facts.docker === 'yes',
        privilege: facts.uid === '0' ? 'root' : facts.sudo === 'yes' ? 'sudo' : 'password',
        recommended: recommended(memoryMiB),
      }
    } finally {
      client.end()
    }
  }
  /** Docker's own convenience script; the domestic mirror only once the person chose it. */
  async installDocker(access: SshAccess, mirror: boolean) {
    const host = await this.host(access)
    try {
      const result = await host.run(
        `{ command -v curl >/dev/null 2>&1 && curl -fsSL https://get.docker.com -o /tmp/yuki-get-docker.sh || wget -qO /tmp/yuki-get-docker.sh https://get.docker.com; } && ${host.sudo}sh /tmp/yuki-get-docker.sh${mirror ? ' --mirror Aliyun' : ''}`,
      )
      if (result.code !== 0) throw new ApiError('remote_docker_install_failed', tail(result))
    } finally {
      host.close()
    }
    return this.check(access)
  }
  /** Bring the release image onto the server and read its model presets from it. */
  async prepare(access: SshAccess): Promise<ProviderPreset[]> {
    const { image } = await this.bundle(),
      host = await this.host(access)
    try {
      const result = await host.run(
        `${host.sudo}docker run --rm --pull missing --entrypoint yuki ${quote(image)} setup provider-presets --json`,
      )
      // 125 is Docker's own failure, before the container ran: here, the pull.
      if (result.code === 125) throw new ApiError('remote_image_pull_failed', tail(result))
      if (result.code !== 0) throw new ApiError('remote_install_failed', tail(result))
      return JSON.parse(result.stdout) as ProviderPreset[]
    } finally {
      host.close()
    }
  }
  private async install(host: RemoteHost, directory: string, options: string[]) {
    const files = await this.bundle(),
      stage = `${host.home}/.yuki-desktop`,
      bundle = `${stage}/${basename(files.bundle)}`
    this.options.progress('upload')
    await host.upload(files.installer, `${stage}/install.sh`)
    await host.upload(files.bundle, bundle)
    this.options.progress('install')
    const result = await host.run(
      [
        `${host.sudo}sh`,
        quote(`${stage}/install.sh`),
        '--yes',
        '--dir',
        quote(directory),
        '--version',
        quote(files.version),
        '--bundle',
        quote(bundle),
        ...options,
      ].join(' '),
    )
    if (result.code !== 0) throw installFailure(result)
  }

  /** Install, or run again after a failure: the same directory, owner and request IDs. */
  async deploy(input: RemoteDeployInput) {
    const host = await this.host(input.access)
    try {
      const directory = host.directory(input.directory),
        target = input.access.target,
        key = `${target.user}@${target.host}:${target.port}${directory}`,
        records = this.options.store.get<Record<string, RemoteOwner>>('remote-deployments') ?? {},
        record = records[key] ?? { personRequestId: randomUUID(), superuserRequestId: randomUUID() }
      this.options.store.set('remote-deployments', { ...records, [key]: record })
      const model = { ...input.model },
        endpoint = new URL(model.base_url)
      // The server's own loopback, as the Bot's container reaches it.
      if (['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)) {
        endpoint.hostname = 'host.docker.internal'
        model.base_url = endpoint.toString()
      }
      const answers = `${host.home}/.yuki-desktop/answers.json`
      const staged = await host.run(
        `mkdir -p ${quote(`${host.home}/.yuki-desktop`)} && umask 077 && cat > ${quote(answers)}`,
        JSON.stringify(model),
      )
      if (staged.code !== 0) throw new ApiError('remote_upload_failed', tail(staged))
      try {
        await this.install(host, directory, [
          '--profile',
          quote(input.sandboxProfile),
          '--character-name',
          quote(input.characterName),
          '--owner-name',
          quote(input.personName),
          '--answers',
          quote(answers),
        ])
      } finally {
        await host.run(`rm -f ${quote(answers)}`)
      }
      this.options.progress('pair')
      const code = await this.ownerCode(host, directory, record, input.personName)
      this.options.progress('connect')
      return await this.connect(
        await this.transport(host, input.access, directory),
        code,
        input.label,
      )
    } finally {
      host.close()
    }
  }
  /**
   * install.sh creates and records the owner on a first run that completes. A first run that
   * failed after writing .env never does; then this desktop creates the owner once, under its
   * own persisted request IDs, and records it where pair.sh looks.
   */
  private async ownerCode(host: RemoteHost, directory: string, record: RemoteOwner, name: string) {
    const env = quote(`${directory}/.env`),
      owner = (
        await host.run(`${host.sudo}sed -n 's/^YUKI_OWNER_PERSON_ID=//p' ${env} | tail -n 1`)
      ).stdout.trim()
    if (owner) return host.pairingCode(directory)
    const result = await host.run(
      `cd ${quote(directory)} && ${host.sudo}docker compose exec -T bot yuki setup desktop-pair --deployment-root /app`,
      JSON.stringify({
        display_name: name,
        person_request_id: record.personRequestId,
        superuser_request_id: record.superuserRequestId,
        pair_request_id: randomUUID(),
      }),
    )
    if (result.code !== 0) throw new ApiError('remote_pairing_failed', tail(result))
    const paired = JSON.parse(result.stdout) as { person_id: string; code: string | null }
    const recorded = await host.run(
      `printf '%s\\n' ${quote(`YUKI_OWNER_PERSON_ID=${paired.person_id}`)} | ${host.sudo}tee -a ${env} >/dev/null`,
    )
    if (recorded.code !== 0 || !paired.code)
      throw new ApiError('remote_pairing_failed', tail(recorded))
    return paired.code
  }

  /** Upload this desktop's installer and package and run them again in the same directory. */
  async upgrade(id: string) {
    const { transport, access } = this.saved(id),
      host = await this.host(access)
    try {
      await this.install(host, transport.directory, [])
    } finally {
      host.close()
    }
  }
  async logs(id: string) {
    const { transport, access } = this.saved(id),
      host = await this.host(access)
    try {
      const result = await host.run(
        `cd ${quote(transport.directory)} && ${host.sudo}docker compose logs --tail 200 --no-color bot manager`,
      )
      if (result.code !== 0) throw new ApiError('ssh_failed', tail(result))
      return result.stdout + result.stderr
    } finally {
      host.close()
    }
  }
}
interface RemoteOwner {
  personRequestId: string
  superuserRequestId: string
}
