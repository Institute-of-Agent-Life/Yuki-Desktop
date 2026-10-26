import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { basename, extname, isAbsolute, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  ConnectorAvailableState,
  ConnectorAdmission,
  ConnectorCandidate,
  ConnectorConfiguration,
  ConnectorDiagnostic,
  ConnectorDriver,
  ConnectorPairing,
  ConnectorServiceAction,
  ConnectorState,
} from '../shared/connector'
import { ApiError, normalizeServer } from './api/client'
import {
  ConnectorInstallations,
  type ConnectorInstallation,
  type ConnectorRuntime,
  type RuntimeManifest,
} from './connector-installation'
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
interface ConnectorStatus {
  data_directory: string
  paired: boolean
  device_id?: string
  server?: string
  instances: ConnectorAvailableState['instances']
  service: ConnectorAvailableState['service']
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
  private run(
    args: readonly string[],
    input?: string,
    installation: ConnectorInstallation | null = this.installations.selected() ?? null,
  ) {
    if (!installation) throw new ApiError('connector_not_installed')
    return this.runner(
      installation.runtime,
      ['--data-dir', installation.dataDirectory, ...args],
      input,
    )
  }
  private async stage<T>(name: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof ApiError) throw new ApiError(error.code, name, error.details)
      throw error
    }
  }
  private async read(args: readonly string[], installation: ConnectorInstallation | null) {
    const reader = await this.installations.bundled()
    if (!reader) throw new ApiError('connector_runtime_unavailable')
    return this.runner(
      reader,
      installation ? ['--data-dir', installation.dataDirectory, ...args] : args,
    )
  }
  private async defaultInstallation() {
    const bundle = await this.installations.bundled()
    if (!bundle) return null
    // The CLI knows the platform's default directory. This reads configuration
    // and OS service facts; it never pairs, installs, opens a journal or starts it.
    const status: ConnectorStatus = JSON.parse(await this.runner(bundle, ['status', '--json']))
    if (!status.paired) return null
    const dataDirectory = status.data_directory
    let executable = status.service.executable
    if (
      typeof dataDirectory !== 'string' ||
      !isAbsolute(dataDirectory) ||
      typeof executable !== 'string' ||
      !isAbsolute(executable) ||
      !/^python(?:w|3(?:\.\d+)?)?(?:\.exe)?$/i.test(basename(executable))
    )
      throw new ApiError('connector_existing_runtime_unavailable')
    if (basename(executable).toLowerCase() === 'pythonw.exe')
      executable = join(dirname(executable), 'python.exe')
    if (!(await stat(executable)).isFile())
      throw new ApiError('connector_existing_runtime_unavailable')
    return { installation: await this.inspectInstallation({ executable, dataDirectory }), status }
  }
  async state(
    characterId?: string,
    installation: ConnectorInstallation | null = this.installations.selected() ?? null,
  ): Promise<ConnectorState> {
    const bundle = await this.installations.manifest()
    if (!installation) {
      const existing = await this.defaultInstallation()
      return {
        available: false,
        bundled: !!bundle,
        ...(existing
          ? {
              existing: {
                installation: {
                  executable: existing.installation.runtime.executable,
                  dataDirectory: existing.installation.dataDirectory,
                },
                state: await this.projectState(
                  characterId,
                  existing.installation,
                  existing.status,
                  bundle,
                ),
              },
            }
          : {}),
      }
    }
    const status: ConnectorStatus = JSON.parse(await this.read(['status', '--json'], installation))
    return this.projectState(characterId, installation, status, bundle)
  }
  private async projectState(
    characterId: string | undefined,
    installation: ConnectorInstallation,
    status: ConnectorStatus,
    bundle: RuntimeManifest | undefined,
  ): Promise<ConnectorAvailableState> {
    const state: ConnectorAvailableState = {
      available: true,
      managed: installation.managed,
      paired: status.paired,
      deviceId: status.device_id,
      server: status.server,
      version: installation.runtime.version,
      protocol: installation.runtime.protocol || undefined,
      runtime: installation.runtime.executable,
      dataDirectory: installation.dataDirectory,
      updateAvailable:
        installation.managed &&
        !!bundle &&
        createHash('sha256').update(JSON.stringify(bundle)).digest('hex') !==
          installation.runtime.build,
      instances: status.instances.map((item) => ({
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
  private async prepareInstallation(
    selected: ConnectorInstallation | null,
    separate = false,
    adopt = false,
  ) {
    const previous = separate || !selected ? undefined : await this.state(undefined, selected)
    const installation = await this.stage('prepare', () =>
      this.installations.install(separate, adopt, selected),
    )
    if (previous?.available && previous.service.installed) {
      // This user's explicit upgrade changes only the selected installation's service.
      await this.stage('service-stop', () => this.run(['service', 'stop'], undefined, installation))
      await this.stage('service-install', () =>
        this.run(['service', 'install'], undefined, installation),
      )
      if (previous.service.running)
        await this.stage('service-start', () =>
          this.run(['service', 'start'], undefined, installation),
        )
    }
    return installation
  }
  async install(separate = false, adopt = false): Promise<ConnectorState> {
    const installation = await this.prepareInstallation(
      this.installations.selected() ?? null,
      separate,
      adopt,
    )
    return this.state(undefined, installation)
  }
  adopt(): Promise<ConnectorState> {
    return this.install(false, true)
  }
  async useInstallation(input: {
    executable: string
    dataDirectory: string
  }): Promise<ConnectorState> {
    const selected = this.installations.selected() ?? null
    const installation = await this.inspectInstallation(input)
    const state = await this.state(undefined, installation)
    this.installations.selectIfCurrent(installation, selected)
    return state
  }
  private async inspectInstallation(input: {
    executable: string
    dataDirectory: string
  }): Promise<ConnectorInstallation> {
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
    const version = (await this.runner(runtime, ['--version'])).trim()
    return {
      managed: false,
      dataDirectory: input.dataDirectory,
      runtime: { ...runtime, version },
    }
  }
  async connect(input: { characterId: string; label: string }): Promise<ConnectorState> {
    let installation = this.installations.selected() ?? null
    let current: ConnectorState | undefined
    if (!installation) {
      const existing = await this.defaultInstallation()
      if (existing) {
        installation = existing.installation
        this.installations.selectIfCurrent(installation, null)
        current = await this.projectState(
          input.characterId,
          installation,
          existing.status,
          await this.installations.manifest(),
        )
      }
    }
    current ??= installation
      ? await this.state(input.characterId, installation)
      : { available: false }
    if (current.available && current.paired) {
      if (current.admission?.matched !== true)
        throw new ApiError(current.admission?.problem ?? 'connector_owner_mismatch')
      if (current.managed && current.updateAvailable) {
        installation = await this.prepareInstallation(installation)
        return this.state(input.characterId, installation)
      }
      return current
    }
    if (!current.available || (current.managed && current.updateAvailable))
      installation = await this.prepareInstallation(installation)
    const { server, code } = await this.stage('authorize', () =>
      this.options.authorize(input.characterId),
    )
    await this.stage('pair', () => this.pair({ server, code, label: input.label }, installation))
    return this.state(input.characterId, installation)
  }
  async pair(
    input: ConnectorPairing,
    installation: ConnectorInstallation | null = this.installations.selected() ?? null,
  ): Promise<ConnectorState> {
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
      installation,
    )
    return this.state(undefined, installation)
  }
  async service(
    action: ConnectorServiceAction,
    installation: ConnectorInstallation | null = this.installations.selected() ?? null,
  ): Promise<ConnectorState> {
    if (!['install', 'start', 'stop', 'uninstall'].includes(action))
      throw new ApiError('validation_error')
    await this.stage(`service-${action}`, () =>
      this.run(['service', action], undefined, installation),
    )
    return this.state(undefined, installation)
  }
  async discover(
    driver: ConnectorDriver = 'codex',
    installation: ConnectorInstallation | null = this.installations.selected() ?? null,
  ): Promise<ConnectorCandidate[]> {
    if (!['codex', 'claude'].includes(driver)) throw new ApiError('validation_error')
    const values = JSON.parse(
      await this.read(
        ['discover', '--json', ...(driver === 'codex' ? [] : ['--driver', driver])],
        installation,
      ),
    )
    return values.map((item: ConnectorCandidate) => ({
      id: item.id,
      label: item.label,
      command: item.command,
      driver,
    }))
  }
  async configure(input: ConnectorConfiguration, start = false) {
    let installation = this.installations.selected() ?? null
    const current = await this.state(undefined, installation)
    const { create, ...configuration } = input
    const instanceId = input.id ?? randomUUID()
    const original = current.available && current.instances.find((item) => item.id === instanceId)
    const driver = original ? original.driver : (input.driver ?? 'codex')
    if (!['codex', 'claude', 'acp'].includes(driver))
      throw new ApiError('validation_error', 'configure')
    if (!original && !(create ?? !input.id))
      throw new ApiError('connector_instance_missing', 'configure')
    let command = input.command ?? (original ? original.command : undefined)
    if (input.candidateId) {
      const candidate = (await this.discover(driver as ConnectorDriver, installation)).find(
        (item) => item.id === input.candidateId,
      )
      if (!candidate) throw new ApiError('native_not_installed', 'configure')
      command = candidate.command
    }
    const cwd = input.cwd ?? (original ? original.cwd : undefined) ?? homedir()
    if (!original) {
      if (!command || !isAbsolute(command) || !isAbsolute(cwd))
        throw new ApiError('validation_error', 'configure')
      const [executable, directory] = await Promise.all([stat(command), stat(cwd)])
      if (
        !executable.isFile() ||
        !directory.isDirectory() ||
        (process.platform === 'win32' && extname(command).toLowerCase() !== '.exe')
      )
        throw new ApiError('validation_error', 'configure')
    }
    if (current.available && current.managed && current.updateAvailable)
      installation = await this.prepareInstallation(installation)
    if (!original) {
      await this.stage('configure', () =>
        this.run(
          [
            'instance',
            'add',
            '--id',
            instanceId,
            '--driver',
            driver,
            '--label',
            input.label,
            '--command',
            command!,
            '--cwd',
            cwd,
          ],
          undefined,
          installation,
        ),
      )
    }
    await this.stage('configure', () =>
      this.run(
        ['instance', 'configure'],
        JSON.stringify({
          ...configuration,
          driver,
          id: instanceId,
          command,
          ...(!original || input.cwd !== undefined ? { cwd } : {}),
        }),
        installation,
      ),
    )
    if (start) {
      const configured = await this.state(undefined, installation)
      if (configured.available && configured.service.running)
        await this.service('stop', installation)
      if (configured.available && !configured.service.installed)
        await this.service('install', installation)
      await this.service('start', installation)
    }
    return { instanceId }
  }
  async diagnose(instanceId: string): Promise<ConnectorDiagnostic> {
    return JSON.parse(await this.run(['diagnose', '--instance', instanceId]))
  }
  async nativeExecutable(instanceId: string): Promise<string> {
    const installation = this.installations.selected() ?? null
    if (!installation) throw new ApiError('connector_not_installed')
    const resolved: { instance_id: string; command: string } = JSON.parse(
      await this.read(['discover', '--instance', instanceId, '--json'], installation),
    )
    if (resolved.instance_id !== instanceId) throw new ApiError('connector_instance_missing')
    return resolved.command
  }
}
