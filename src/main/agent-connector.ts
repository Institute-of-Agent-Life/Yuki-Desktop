import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { basename, isAbsolute, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { gte, valid } from 'semver'
import type {
  ConnectorActivityTool,
  ConnectorAvailableState,
  ConnectorAdmission,
  ConnectorCandidate,
  ConnectorConfiguration,
  ConnectorControl,
  ConnectorDiagnostic,
  ConnectorDriver,
  ConnectorHolder,
  ConnectorPairing,
  ConnectorLink,
  ConnectorPermission,
  ConnectorServiceAction,
  ConnectorState,
  ConnectorSupervision,
} from '../shared/connector'
import { ApiError, normalizeServer } from './api/client'
import {
  ConnectorInstallations,
  type ConnectorInstallation,
  type ConnectorRuntime,
  type RuntimeManifest,
} from './connector-installation'
import { connectorDiagnostics } from './diagnostics'
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
export interface ConnectorOptions {
  root: string
  bundledRuntime: string
  store: Pick<LocalStore, 'get' | 'set'>
  authorize(characterId: string): Promise<{ server: string; code: string }>
  admission(characterId: string, deviceId: string): Promise<ConnectorAdmission>
  verifyServer(characterId: string, server: string, deviceId: string): Promise<string>
  changed?(): void
}
interface ConnectorStatus {
  data_directory: string
  paired: boolean
  device_id?: string
  server?: string
  full_access?: boolean
  computer?: ConnectorAvailableState['computer']
  instances: ConnectorAvailableState['instances']
  service: {
    installed: boolean
    running: boolean | null
    executable?: string
    arguments?: string[]
  }
}
interface OwnedConnector {
  installation: ConnectorInstallation
  child: ChildProcessWithoutNullStreams
  spawned: Promise<void>
  closed: Promise<void>
  /** Set by stop()/close(); any other exit is unexpected and restarted. */
  stopping: boolean
}
const RESTART_FIRST_DELAY = 1000
const RESTART_MAX_DELAY = 60_000
// The same rotation as the Connector's own connector.log (4 MiB, two backups).
const LOG_BYTES = 4 * 1024 * 1024
const LOG_BACKUPS = 2
/** Yuki reads as operating until this long after its last action ended: the gap between actions. */
const ACTIVITY_LINGER = 10_000
const LINKS: readonly ConnectorLink[] = [
  'connected',
  'disconnected',
  'authorization_lost',
  'protocol_unsupported',
]
/** Append-only log with RotatingFileHandler's naming: name, name.1, name.2. */
export function rotatingLog(path: string, limit = LOG_BYTES, backups = LOG_BACKUPS) {
  let size: number | undefined
  return (chunk: Buffer) => {
    if (size === undefined) {
      try {
        size = statSync(path).size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        size = 0
      }
    }
    if (size > 0 && size + chunk.length > limit) {
      rmSync(`${path}.${backups}`, { force: true })
      for (let index = backups - 1; index > 0; index--) {
        try {
          renameSync(`${path}.${index}`, `${path}.${index + 1}`)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      renameSync(path, `${path}.1`)
      size = 0
    }
    appendFileSync(path, chunk, { mode: 0o600 })
    size += chunk.length
  }
}
export type ConnectorLine =
  | { type: 'state'; link: ConnectorLink; reason?: string }
  | { type: 'control'; control: ConnectorControl }
  | { type: 'activity'; tool: ConnectorActivityTool; phase: 'start' | 'end' }
  | { type: 'permissions'; permissions: Record<ConnectorPermission, boolean> }
/** One report line from `run --desktop-stdin`; other output on the channel is not a report. */
export function connectorLine(line: string): ConnectorLine | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const fields = value as Record<string, unknown>
  switch (fields.type) {
    case 'state':
      if (!LINKS.includes(fields.state as ConnectorLink)) return undefined
      return {
        type: 'state',
        link: fields.state as ConnectorLink,
        ...(typeof fields.reason === 'string' ? { reason: fields.reason } : {}),
      }
    case 'control':
      if (fields.holder !== 'owner' && fields.holder !== 'none') return undefined
      return {
        type: 'control',
        control: {
          holder: fields.holder,
          since: String(fields.since),
          reason: String(fields.reason),
        },
      }
    case 'activity':
      if (
        (fields.tool !== 'computer' && fields.tool !== 'browser') ||
        (fields.phase !== 'start' && fields.phase !== 'end')
      )
        return undefined
      return { type: 'activity', tool: fields.tool, phase: fields.phase }
    case 'permissions':
      if (typeof fields.screen !== 'boolean' || typeof fields.input !== 'boolean') return undefined
      return { type: 'permissions', permissions: { screen: fields.screen, input: fields.input } }
  }
  return undefined
}
const controlLine = (holder: ConnectorHolder) => JSON.stringify({ type: 'control', holder }) + '\n'
function computerRuntime(runtime: ConnectorRuntime) {
  return runtime.protocol
    ? runtime.protocol >= 4
    : valid(runtime.version) !== null && gte(runtime.version, '0.4.0')
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
  private process?: OwnedConnector
  private starting?: Promise<void>
  private closing?: Promise<void>
  /** Data directory whose Connector Desktop keeps running until an explicit stop or quit. */
  private supervised?: string
  private pendingRestart?: { dataDirectory: string; timer: NodeJS.Timeout }
  /** Restarts since the child last reported `connected`; sets the backoff. */
  private failures = 0
  private activityEnd?: NodeJS.Timeout
  private readonly supervision = new Map<string, Omit<ConnectorSupervision, 'restartPending'>>()
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
      if (error instanceof SyntaxError) throw new ApiError('connector_invalid_response', name)
      throw error
    }
  }
  private async bundled(
    args: readonly string[],
    installation: ConnectorInstallation | null,
    input?: string,
  ) {
    const reader = await this.installations.bundled()
    if (!reader) throw new ApiError('connector_runtime_unavailable')
    return this.runner(
      reader,
      installation ? ['--data-dir', installation.dataDirectory, ...args] : args,
      input,
    )
  }
  private async readState(installation: ConnectorInstallation): Promise<ConnectorStatus> {
    return this.stage(
      'read',
      async () =>
        JSON.parse(
          await (computerRuntime(installation.runtime)
            ? this.run(['status', '--json'], undefined, installation)
            : this.bundled(['status', '--json'], installation)),
        ) as ConnectorStatus,
    )
  }
  private async defaultInstallation() {
    const bundle = await this.installations.bundled()
    if (!bundle) return null
    // The CLI knows the platform's default directory. This reads configuration
    // and OS service facts; it never pairs, installs, opens a journal or starts it.
    const status = await this.stage(
      'read',
      async () => JSON.parse(await this.runner(bundle, ['status', '--json'])) as ConnectorStatus,
    )
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
    try {
      if (!(await stat(executable)).isFile())
        throw new ApiError('connector_existing_runtime_unavailable')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ApiError('connector_existing_runtime_unavailable')
      throw error
    }
    const installation = await this.inspectInstallation({ executable, dataDirectory })
    return {
      installation,
      status: computerRuntime(installation.runtime) ? await this.readState(installation) : status,
    }
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
    const status = await this.readState(installation)
    return this.projectState(characterId, installation, status, bundle)
  }
  private async projectState(
    characterId: string | undefined,
    installation: ConnectorInstallation,
    status: ConnectorStatus,
    bundle: RuntimeManifest | undefined,
  ): Promise<ConnectorAvailableState> {
    const computerSupported = computerRuntime(installation.runtime)
    const state: ConnectorAvailableState = {
      available: true,
      managed: installation.managed,
      paired: status.paired,
      deviceId: status.device_id,
      server: status.server,
      version: installation.runtime.version,
      bundledVersion: bundle?.version,
      fullAccess: computerSupported ? status.full_access : undefined,
      computer: computerSupported ? status.computer : undefined,
      protocol: installation.runtime.protocol || undefined,
      runtime: installation.runtime.executable,
      dataDirectory: installation.dataDirectory,
      updateAvailable:
        !!bundle &&
        (installation.managed
          ? createHash('sha256').update(JSON.stringify(bundle)).digest('hex') !==
            installation.runtime.build
          : bundle.version !== installation.runtime.version),
      instances: status.instances.map((item) => ({
        id: item.id,
        label: item.label,
        driver: item.driver,
        command: item.command,
        cwd: item.cwd,
        ...(item.driver === 'acp' && item.args !== undefined ? { args: item.args } : {}),
      })),
      running: installation.managed
        ? this.process?.installation.dataDirectory === installation.dataDirectory &&
          this.process.child.exitCode === null &&
          this.process.child.signalCode === null
        : status.service.running,
      ...(installation.managed && this.supervision.has(installation.dataDirectory)
        ? { supervision: this.supervisionOf(installation.dataDirectory) }
        : {}),
    }
    if (characterId && state.deviceId) {
      try {
        state.admission = await this.options.admission(characterId, state.deviceId)
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
    restart = true,
  ) {
    if (restart) await this.starting
    const previous = separate || !selected ? undefined : await this.readState(selected)
    const wasRunning =
      !separate &&
      !!selected &&
      (this.process?.installation.dataDirectory === selected.dataDirectory ||
        this.pendingRestart?.dataDirectory === selected.dataDirectory ||
        previous?.service.running === true)
    const installation = await this.stage('prepare', () =>
      this.installations.install(separate, selected),
    )
    if (!separate && selected) {
      await this.stop(selected)
      if (previous?.service.installed)
        await this.stage('service-uninstall', () =>
          this.run(['service', 'uninstall'], undefined, selected),
        )
    }
    if (restart && wasRunning && previous?.paired) await this.start(installation)
    return installation
  }
  async restore(): Promise<void> {
    const installation = this.installations.selected()
    if (installation?.managed) await this.supervise(installation)
  }
  private supervisionOf(dataDirectory: string): ConnectorSupervision {
    return {
      restarts: 0,
      ...this.supervision.get(dataDirectory),
      restartPending: this.pendingRestart?.dataDirectory === dataDirectory,
    }
  }
  private record(
    dataDirectory: string,
    change: Partial<Omit<ConnectorSupervision, 'restartPending'>>,
  ) {
    this.supervision.set(dataDirectory, {
      restarts: 0,
      ...this.supervision.get(dataDirectory),
      ...change,
    })
  }
  /** An explicit start (Desktop launch or the person's start): keep it running from now on. */
  private supervise(installation: ConnectorInstallation): Promise<void> {
    this.supervised = installation.dataDirectory
    this.failures = 0
    this.record(installation.dataDirectory, { restarts: 0 })
    return this.start(installation)
  }
  private cancelRestart() {
    if (!this.pendingRestart) return
    clearTimeout(this.pendingRestart.timer)
    this.pendingRestart = undefined
  }
  private restartLater(installation: ConnectorInstallation) {
    const delay = Math.min(RESTART_FIRST_DELAY * 2 ** this.failures, RESTART_MAX_DELAY)
    this.failures += 1
    this.pendingRestart = {
      dataDirectory: installation.dataDirectory,
      timer: setTimeout(() => {
        this.pendingRestart = undefined
        const { restarts } = this.supervisionOf(installation.dataDirectory)
        this.record(installation.dataDirectory, { restarts: restarts + 1 })
        this.start(installation).catch((error: unknown) => {
          console.error(
            'Connector restart failed',
            error instanceof ApiError ? error.code : 'connector_failed',
          )
          if (
            this.supervised === installation.dataDirectory &&
            !this.closing &&
            !this.process &&
            !this.pendingRestart
          )
            this.restartLater(installation)
        })
        this.options.changed?.()
      }, delay),
    }
  }
  private start(installation: ConnectorInstallation): Promise<void> {
    if (this.closing) return Promise.reject(new ApiError('connector_closed'))
    if (this.starting)
      return this.starting.then(() =>
        this.process?.installation.dataDirectory === installation.dataDirectory
          ? this.process.spawned
          : this.start(installation),
      )
    if (
      this.process?.installation.dataDirectory === installation.dataDirectory &&
      this.process.installation.runtime.build === installation.runtime.build
    )
      return this.process.spawned
    const starting = (async () => {
      let target = installation
      const status = await this.readState(target)
      if (!status.paired) return
      if (valid(target.runtime.version) === null || !gte(target.runtime.version, '0.4.2'))
        target = await this.prepareInstallation(target, false, false)
      else if (status.service.installed)
        await this.stage('service-uninstall', () =>
          this.run(['service', 'uninstall'], undefined, target),
        )
      await this.stop()
      if (this.closing) throw new ApiError('connector_closed')
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONDONTWRITEBYTECODE: '1',
      }
      delete env.PYTHONPATH
      delete env.PYTHONHOME
      const child = spawn(
        target.runtime.executable,
        [...target.runtime.arguments, '--data-dir', target.dataDirectory, 'run', '--desktop-stdin'],
        { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env },
      )
      const owned: OwnedConnector = {
        installation: target,
        child,
        stopping: false,
        spawned: new Promise((resolve, reject) => {
          child.once('spawn', resolve)
          child.once('error', () => reject(new ApiError('connector_failed', 'start')))
        }),
        closed: new Promise((resolve) =>
          child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
            if (this.process === owned) this.process = undefined
            clearTimeout(this.activityEnd)
            if (this.supervision.get(target.dataDirectory)?.activity)
              this.record(target.dataDirectory, { activity: undefined })
            if (!owned.stopping) {
              this.record(target.dataDirectory, {
                link: undefined,
                reason: undefined,
                lastExit: { code, signal, at: new Date().toISOString() },
              })
              if (this.supervised === target.dataDirectory && !this.closing)
                this.restartLater(target)
            }
            resolve()
            this.options.changed?.()
          }),
        ),
      }
      this.process = owned
      // A child which already exited owns no writable parent pipe. Its close
      // event, rather than another execution or signal, finishes cleanup.
      child.stdin.on('error', () => {})
      // The holder survives restarts (task book §7.4 D10): tell the new child before anything else.
      const holder = this.supervision.get(target.dataDirectory)?.control?.holder
      if (holder) child.stdin.write(controlLine(holder))
      createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
        const report = connectorLine(line)
        if (!report || this.process !== owned) return
        switch (report.type) {
          case 'state':
            if (report.link === 'connected') this.failures = 0
            this.record(target.dataDirectory, { link: report.link, reason: report.reason })
            break
          case 'control':
            // A repeat of the current holder (such as this child's answer to the holder written
            // above) keeps when and why it began; the startup line predates that holder.
            if (
              this.supervision.get(target.dataDirectory)?.control?.holder ===
                report.control.holder ||
              (report.control.reason === 'start' && holder)
            )
              return
            this.record(target.dataDirectory, { control: report.control })
            break
          case 'activity':
            clearTimeout(this.activityEnd)
            if (report.phase === 'end') {
              this.activityEnd = setTimeout(() => {
                this.record(target.dataDirectory, { activity: undefined })
                this.options.changed?.()
              }, ACTIVITY_LINGER)
              return
            }
            if (this.supervision.get(target.dataDirectory)?.activity?.tool === report.tool) return
            this.record(target.dataDirectory, { activity: { tool: report.tool } })
            break
          case 'permissions':
            this.record(target.dataDirectory, { permissions: report.permissions })
        }
        this.options.changed?.()
      })
      const stderr = rotatingLog(join(target.dataDirectory, 'connector-stderr.log'))
      child.stderr.on('data', (chunk: Buffer) => {
        try {
          stderr(chunk)
        } catch (error) {
          // The child keeps running; only its stderr copy is missing.
          console.error('Connector stderr log failed', (error as NodeJS.ErrnoException).code)
        }
      })
      await owned.spawned
    })().finally(() => {
      if (this.starting === starting) this.starting = undefined
    })
    this.starting = starting
    return starting
  }
  private async stop(installation?: ConnectorInstallation): Promise<void> {
    if (!installation || this.pendingRestart?.dataDirectory === installation.dataDirectory)
      this.cancelRestart()
    const owned = this.process
    if (!owned || (installation && owned.installation.dataDirectory !== installation.dataDirectory))
      return
    owned.stopping = true
    owned.child.stdin.end()
    await owned.closed
  }
  private stopAfterStart(installation: ConnectorInstallation): Promise<void> {
    if (this.supervised === installation.dataDirectory) this.supervised = undefined
    this.cancelRestart()
    const stopping = (this.starting ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.stop(installation))
      .finally(() => {
        if (this.starting === stopping) this.starting = undefined
      })
    this.starting = stopping
    return stopping
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.cancelRestart()
      // A failed start has no live resource. The original caller still receives
      // its failure; closing the Desktop must also join any successful start.
      await this.starting?.catch(() => {})
      await this.stop()
    })()
    return this.closing
  }
  async install(separate = false): Promise<ConnectorState> {
    let selected = this.installations.selected() ?? null
    if (!separate && !selected) {
      const existing = await this.defaultInstallation()
      if (existing) {
        selected = existing.installation
        this.installations.selectIfCurrent(selected, null)
      }
    }
    const installation = await this.prepareInstallation(selected, separate)
    return this.state(undefined, installation)
  }
  adopt(): Promise<ConnectorState> {
    return this.install()
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
    if (!['start', 'stop'].includes(action)) throw new ApiError('validation_error')
    if (!installation) throw new ApiError('connector_not_installed')
    if (!installation.managed) throw new ApiError('connector_independent_installation')
    await this.stage(`service-${action}`, () =>
      action === 'start' ? this.supervise(installation) : this.stopAfterStart(installation),
    )
    return this.state(undefined, installation)
  }
  /**
   * 「停止」 (`owner`) or 「繼續」 (`none`). The holder lives in memory for this app session, is
   * written to the live child and to every child started later; the Connector's own control
   * lines then replace it. Nothing is persisted.
   */
  control(holder: ConnectorHolder) {
    if (holder !== 'owner' && holder !== 'none') throw new ApiError('validation_error')
    const installation = this.installations.selected()
    if (!installation) throw new ApiError('connector_not_installed')
    if (!installation.managed) throw new ApiError('connector_independent_installation')
    this.record(installation.dataDirectory, {
      control: { holder, since: new Date().toISOString(), reason: 'desktop' },
    })
    if (this.process?.installation.dataDirectory === installation.dataDirectory)
      this.process.child.stdin.write(controlLine(holder))
    this.options.changed?.()
  }
  /** The selected Desktop-owned Connector's supervision, for the tray. */
  current(): ConnectorSupervision | undefined {
    const installation = this.installations.selected()
    return installation?.managed && this.supervision.has(installation.dataDirectory)
      ? this.supervisionOf(installation.dataDirectory)
      : undefined
  }
  async server(input: { characterId: string; server: string }): Promise<ConnectorState> {
    const installation = this.installations.selected() ?? null
    if (!installation) throw new ApiError('connector_not_installed')
    if (valid(installation.runtime.version) === null || !gte(installation.runtime.version, '0.4.1'))
      throw new ApiError('connector_update_required', 'server')
    const current = await this.state(undefined, installation)
    if (!current.available || !current.deviceId)
      throw new ApiError('connector_authorization_failed', 'server')
    const normalized = normalizeServer(input.server)
    const target = new URL(normalized)
    if (
      target.protocol !== 'https:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    )
      throw new ApiError('invalid_server', 'server')
    const server = await this.stage('server', () =>
      this.options.verifyServer(input.characterId, normalized, current.deviceId!),
    )
    await this.stage('server', () => this.run(['server', '--url', server], undefined, installation))
    return this.state(input.characterId, installation)
  }
  async fullAccess(enabled: boolean): Promise<ConnectorState> {
    const installation = this.installations.selected() ?? null
    await this.stage('full-access', () =>
      this.run(['full-access', '--enabled', String(enabled), '--json'], undefined, installation),
    )
    return this.state(undefined, installation)
  }
  async discover(
    driver: ConnectorDriver = 'codex',
    installation: ConnectorInstallation | null = this.installations.selected() ?? null,
  ): Promise<ConnectorCandidate[]> {
    if (!['codex', 'claude'].includes(driver)) throw new ApiError('validation_error')
    const values = await this.stage(
      'discover',
      async () =>
        JSON.parse(
          await this.bundled(
            ['discover', '--json', ...(driver === 'codex' ? [] : ['--driver', driver])],
            installation,
          ),
        ) as ConnectorCandidate[],
    )
    if (!Array.isArray(values)) throw new ApiError('connector_invalid_response', 'discover')
    return values.map((item: ConnectorCandidate) => ({
      id: item.id,
      label: item.label,
      command: item.command,
      driver,
    }))
  }
  async configure(input: ConnectorConfiguration) {
    const installation = this.installations.selected() ?? null
    if (!installation) throw new ApiError('connector_not_installed', 'configure')
    const current = await this.state(undefined, installation)
    const instanceId = input.id ?? randomUUID()
    const original = current.available && current.instances.find((item) => item.id === instanceId)
    const driver = original ? original.driver : (input.driver ?? 'codex')
    if (!['codex', 'claude', 'acp'].includes(driver))
      throw new ApiError('validation_error', 'configure')
    if (!original && !(input.create ?? !input.id))
      throw new ApiError('connector_instance_missing', 'configure')
    await this.stage('configure', () =>
      this.bundled(
        ['instance', 'configure'],
        installation,
        JSON.stringify({
          ...input,
          create: original ? false : (input.create ?? !input.id),
          driver,
          id: instanceId,
        }),
      ),
    )
    return {
      instanceId,
      deviceId: current.available ? current.deviceId : undefined,
      runtimeVersion:
        this.process?.installation.dataDirectory === installation.dataDirectory
          ? this.process.installation.runtime.version
          : undefined,
    }
  }
  async remove(instanceId: string) {
    const installation = this.installations.selected() ?? null
    if (!installation) throw new ApiError('connector_not_installed', 'remove')
    const current = await this.state(undefined, installation)
    await this.stage('remove', () => this.bundled(['instance', 'remove', instanceId], installation))
    return {
      instanceId,
      deviceId: current.available ? current.deviceId : undefined,
      runtimeVersion:
        this.process?.installation.dataDirectory === installation.dataDirectory
          ? this.process.installation.runtime.version
          : undefined,
    }
  }
  async diagnose(instanceId: string): Promise<ConnectorDiagnostic> {
    return this.stage(
      'diagnose',
      async () =>
        JSON.parse(await this.run(['diagnose', '--instance', instanceId])) as ConnectorDiagnostic,
    )
  }
  /** Supervision facts and the tails of both Connector logs, for an explicit export. */
  async diagnostics() {
    const installation = this.installations.selected() ?? null
    if (!installation) throw new ApiError('connector_not_installed')
    return connectorDiagnostics({
      dataDirectory: installation.dataDirectory,
      managed: installation.managed,
      version: installation.runtime.version,
      running:
        this.process?.installation.dataDirectory === installation.dataDirectory &&
        this.process.child.exitCode === null,
      supervision: installation.managed
        ? this.supervisionOf(installation.dataDirectory)
        : undefined,
    })
  }
  async nativeExecutable(instanceId: string): Promise<string> {
    const installation = this.installations.selected() ?? null
    if (!installation) throw new ApiError('connector_not_installed')
    const resolved: { instance_id: string; command: string } = JSON.parse(
      await this.bundled(['discover', '--instance', instanceId, '--json'], installation),
    )
    if (resolved.instance_id !== instanceId) throw new ApiError('connector_instance_missing')
    return resolved.command
  }
}
