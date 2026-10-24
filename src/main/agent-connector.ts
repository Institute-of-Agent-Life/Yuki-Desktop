import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import type {
  ConnectorAdmission,
  ConnectorCandidate,
  ConnectorConfiguration,
  ConnectorDiagnostic,
  ConnectorPairing,
  ConnectorServiceAction,
  ConnectorState,
} from '../shared/connector'
import { ApiError, normalizeServer } from './api/client'
import { ConnectorInstallations, type ConnectorRuntime } from './connector-installation'
import type { LocalStore } from './store'

type Launch = (
  command: string,
  args: readonly string[],
  options: {
    shell: false
    windowsHide: true
    stdio: ['pipe', 'pipe', 'pipe']
    env: NodeJS.ProcessEnv
  },
) => ChildProcessWithoutNullStreams
export type ConnectorRunner = (args: readonly string[], input?: string) => Promise<string>
export interface ConnectorOptions {
  root: string
  bundledRuntime: string
  store: Pick<LocalStore, 'get' | 'set'>
  authorize(characterId: string): Promise<{ server: string; code: string }>
  admission(characterId: string, server: string, deviceId: string): Promise<ConnectorAdmission>
}
export function runConnector(
  runtime: Pick<ConnectorRuntime, 'executable' | 'arguments'>,
  args: readonly string[],
  input?: string,
  launch: Launch = spawn,
): Promise<string> {
  if (!isAbsolute(runtime.executable))
    return Promise.reject(new ApiError('connector_runtime_invalid'))
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' }
    delete env.PYTHONPATH
    delete env.PYTHONHOME
    const child = launch(runtime.executable, [...runtime.arguments, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    // Never return native logs, credentials or tracebacks through IPC.
    child.stderr.resume()
    child.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        new ApiError(error.code === 'ENOENT' ? 'connector_not_installed' : 'connector_failed'),
      ),
    )
    child.once('close', (code) => {
      if (code === 0) resolve(output)
      else {
        let problem = 'connector_failed'
        try {
          const result = JSON.parse(output)
          if (typeof result.problem === 'string') problem = result.problem
        } catch {
          /* Human CLI diagnostics stay local. */
        }
        reject(new ApiError(problem))
      }
    })
    child.stdin.on('error', () => reject(new ApiError('connector_failed')))
    child.stdin.end(input)
  })
}
export class AgentConnector {
  readonly installations: ConnectorInstallations
  constructor(
    private readonly options: ConnectorOptions,
    private readonly runner = runConnector,
  ) {
    this.installations = new ConnectorInstallations(
      options.root,
      options.bundledRuntime,
      options.store,
    )
  }
  private run(args: readonly string[], input?: string) {
    const installation = this.installations.selected()
    if (!installation) throw new ApiError('connector_not_installed')
    return this.runner(
      installation.runtime,
      ['--data-dir', installation.dataDirectory, ...args],
      input,
    )
  }
  async state(characterId?: string): Promise<ConnectorState> {
    const installation = this.installations.selected()
    const bundle = await this.installations.manifest()
    if (!installation) return { available: false, bundled: !!bundle }
    const status = JSON.parse(await this.run(['status', '--json']))
    const state: Extract<ConnectorState, { available: true }> = {
      available: true,
      managed: installation.managed,
      paired: status.paired,
      deviceId: status.device_id,
      server: status.server,
      version: status.version ?? installation.runtime.version,
      protocol: status.protocol,
      runtime: status.runtime ?? installation.runtime.executable,
      dataDirectory: installation.dataDirectory,
      updateAvailable:
        installation.managed &&
        !!bundle &&
        createHash('sha256').update(JSON.stringify(bundle)).digest('hex') !==
          installation.runtime.build,
      instances: status.instances.map((item: Record<string, string>) => ({
        id: item.id,
        label: item.label,
        driver: item.driver,
        command: item.command,
        cwd: item.cwd,
      })),
      service: {
        installed: status.service.installed,
        running: status.service.running,
        executable: status.service.executable,
        arguments: status.service.arguments,
      },
    }
    if (characterId && state.deviceId && state.server) {
      try {
        state.admission = await this.options.admission(characterId, state.server, state.deviceId)
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        state.admission = { matched: null, connected: false, problem: error.code }
      }
    }
    return state
  }
  async install(separate = false, adopt = false): Promise<ConnectorState> {
    const previous = separate ? undefined : await this.state()
    await this.installations.install(separate, adopt)
    if (previous?.available && previous.service.installed) {
      // This user's explicit upgrade changes only the selected installation's service.
      await this.run(['service', 'stop'])
      await this.run(['service', 'install'])
      if (previous.service.running) await this.run(['service', 'start'])
    }
    return this.state()
  }
  adopt(): Promise<ConnectorState> {
    return this.install(false, true)
  }
  async useInstallation(input: {
    executable: string
    dataDirectory: string
  }): Promise<ConnectorState> {
    if (!isAbsolute(input.executable) || !isAbsolute(input.dataDirectory))
      throw new ApiError('validation_error')
    const runtime = {
      directory: dirname(input.executable),
      executable: input.executable,
      arguments: ['-B', '-m', 'yuki_agent_connector'],
      version: '',
      protocol: 0,
      build: '',
    }
    const status = JSON.parse(
      await this.runner(runtime, ['--data-dir', input.dataDirectory, 'status', '--json']),
    )
    if (!Array.isArray(status.instances)) throw new ApiError('connector_runtime_invalid')
    const version =
      typeof status.version === 'string'
        ? status.version
        : (await this.runner(runtime, ['--version'])).trim()
    this.installations.select({
      managed: false,
      dataDirectory: input.dataDirectory,
      runtime: { ...runtime, version, protocol: status.protocol ?? 0 },
    })
    return this.state()
  }
  async connect(input: { characterId: string; label: string }): Promise<ConnectorState> {
    const current = await this.state(input.characterId)
    if (current.available && current.paired) {
      if (current.admission?.matched !== true)
        throw new ApiError(current.admission?.problem ?? 'connector_owner_mismatch')
      return current
    }
    if (!current.available) await this.install()
    const { server, code } = await this.options.authorize(input.characterId)
    await this.pair({ server, code, label: input.label })
    return this.state(input.characterId)
  }
  async pair(input: ConnectorPairing): Promise<ConnectorState> {
    if (!input.label.trim() || !input.code.trim() || /[\r\n]/.test(input.code))
      throw new ApiError('validation_error')
    await this.run(
      [
        'pair',
        '--url',
        normalizeServer(input.server),
        '--label',
        input.label.trim(),
        '--code-stdin',
      ],
      input.code.trim() + '\n',
    )
    return this.state()
  }
  async service(action: ConnectorServiceAction): Promise<ConnectorState> {
    if (!['install', 'start', 'stop', 'uninstall'].includes(action))
      throw new ApiError('validation_error')
    await this.run(['service', action])
    return this.state()
  }
  async discover(): Promise<ConnectorCandidate[]> {
    const values = JSON.parse(await this.run(['discover', '--json']))
    return values.map((item: ConnectorCandidate) => ({
      id: item.id,
      label: item.label,
      command: item.command,
    }))
  }
  async configure(input: ConnectorConfiguration): Promise<ConnectorState> {
    await this.run(['instance', 'configure'], JSON.stringify(input))
    return this.state()
  }
  async diagnose(instanceId: string): Promise<ConnectorDiagnostic> {
    return JSON.parse(await this.run(['diagnose', '--instance', instanceId]))
  }
}
