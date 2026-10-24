import type { ExecutorConfig, LocalExecutorState } from '../../shared/executor'
import { ApiError } from '../api/client'
import { readStream } from '../api/stream'
import type { Outbox } from '../outbox'
import { NativeExecutorEffects, type NativeSubmissions } from './effects'
import { ExecutorInstallation } from './installation'
import { ExecutorJournal } from './journal'
import { ExecutorClient, ExecutorProtocol } from './protocol'
import { ExecutorRunner, type ExecutorTask } from './runner'

interface Session {
  id: string
  protocol: ExecutorProtocol
  journal: ExecutorJournal
  runner: ExecutorRunner
  config?: ExecutorConfig
  configRead?: Promise<ExecutorConfig>
  tasks: Map<string, Promise<void>>
  pending: Set<string>
}
/** Network restarts replace the transport, preserving each live native execution. */
export class LocalExecutorRuntime {
  private sessions = new Map<string, Session>()
  private controller?: AbortController
  private listening?: Promise<void>
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private status: LocalExecutorState['state'] = 'offline'
  private problem: string | null = null
  private physical = new Set<string>()
  private address = ''
  private executorId = ''
  private epoch = 0
  private startKey = ''
  private starting?: Promise<void>
  constructor(
    readonly box: Outbox,
    readonly installation: ExecutorInstallation,
    private native: NativeSubmissions,
    private verify: () => Promise<void>,
    private changed: () => void,
    private activity: (task: ExecutorTask, active: boolean) => void = () => {},
  ) {}
  state(): LocalExecutorState {
    return {
      installation: this.installation.publicState(),
      state: this.status,
      problem: this.problem,
      activeOperations: [...this.physical],
    }
  }
  get hasWork() {
    return [...this.sessions.values()].some((session) => session.tasks.size > 0)
  }
  private session(base: string, version: string) {
    const installed = this.installation.current()
    if (!installed) throw new ApiError('executor_not_installed')
    let session = this.sessions.get(installed.executorId)
    if (!session) {
      const protocol = new ExecutorProtocol(new ExecutorClient(base, installed.token, version))
      const journal = new ExecutorJournal(this.box, installed.executorId)
      const effects = new NativeExecutorEffects(
        async () => {
          if (this.installation.current()?.executorId !== installed.executorId)
            throw new ApiError('scope_unavailable')
          return this.installation.authority((await this.configuration(session!)).grants)
        },
        this.native,
        (task) => protocol.content(task),
        (task, active) => {
          if (active) this.physical.add(task.opId)
          else this.physical.delete(task.opId)
          this.activity(task, active)
          this.changed()
        },
      )
      const runner = new ExecutorRunner(
        journal,
        protocol,
        effects,
        () =>
          this.installation.current()?.executorId === installed.executorId &&
          !this.installation.current()?.localPaused &&
          !session?.config?.paused &&
          !!this.controller &&
          !this.controller.signal.aborted,
      )
      session = {
        id: installed.executorId,
        protocol,
        journal,
        runner,
        tasks: new Map(),
        pending: new Set(),
      }
      this.sessions.set(installed.executorId, session)
    }
    session.protocol.client = new ExecutorClient(base, installed.token, version)
    return session
  }
  private configuration(session: Session): Promise<ExecutorConfig> {
    if (session.configRead) return session.configRead
    const client = session.protocol.client
    const reading = client
      .get<ExecutorConfig>('config')
      .then((config) => {
        if (client !== session.protocol.client) throw new ApiError('connection_changed')
        if (config.executor_id !== session.id) throw new ApiError('invalid_response')
        session.config = config
        return config
      })
      .finally(() => {
        session.configRead = undefined
      })
    session.configRead = reading
    return reading
  }
  start(base: string, version: string) {
    const installed = this.installation.current()
    if (!installed) return Promise.resolve()
    const key = `${base}/${installed.executorId}`
    if (
      this.controller &&
      !this.controller.signal.aborted &&
      this.address === base &&
      this.executorId === installed.executorId
    )
      return Promise.resolve()
    if (this.starting && this.startKey === key) return this.starting
    const epoch = ++this.epoch
    this.startKey = key
    const starting = this.connect(base, version, installed.executorId, epoch).finally(() => {
      if (this.starting === starting) this.starting = undefined
    })
    this.starting = starting
    return starting
  }
  private async connect(base: string, version: string, executorId: string, epoch: number) {
    await this.verify()
    if (this.epoch !== epoch || this.installation.current()?.executorId !== executorId) return
    this.stopTransport()
    this.address = base
    this.executorId = executorId
    const session = this.session(base, version),
      controller = new AbortController()
    this.controller = controller
    this.status = 'connecting'
    this.problem = null
    this.changed()
    this.listening = this.listen(session, controller)
  }
  private async heartbeat(session: Session) {
    const installed = this.installation.current()
    if (installed?.executorId !== session.id) return
    const reply = await session.protocol.client.post<{ grants_digest: string; paused: boolean }>(
      'heartbeat',
      {
        grants_digest: session.config?.grants_digest ?? '',
        local_paused: installed.localPaused,
      },
    )
    if (reply.grants_digest !== session.config?.grants_digest) await this.configuration(session)
  }
  async refresh() {
    const current = this.installation.current(),
      session = current && this.sessions.get(current.executorId)
    if (!session) return
    await this.heartbeat(session)
    await this.configuration(session)
    for (const opId of new Set([...session.pending, ...session.journal.list()]))
      this.run(session, opId)
    this.changed()
  }
  private run(session: Session, opId: string) {
    if (
      !this.controller ||
      this.controller.signal.aborted ||
      this.installation.current()?.executorId !== session.id ||
      session.tasks.has(opId)
    )
      return
    session.pending.add(opId)
    const controller = this.controller
    const work = Promise.resolve()
      .then(() => session.runner.run(opId))
      .then((task) => {
        if (['succeeded', 'failed', 'unknown'].includes(task.state)) session.pending.delete(opId)
        if (this.controller === controller) this.problem = null
      })
      .catch((error) => {
        if (this.controller !== controller || controller.signal.aborted) return
        this.problem = error instanceof ApiError ? error.code : 'unknown'
        if (this.problem === 'unauthenticated') controller.abort()
      })
      .finally(() => {
        session.tasks.delete(opId)
        this.changed()
      })
    session.tasks.set(opId, work)
  }
  private async listen(session: Session, controller: AbortController) {
    let delay = 1000
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined
    while (!controller.signal.aborted) {
      try {
        await this.verify()
        if (controller.signal.aborted) break
        await this.configuration(session)
        if (controller.signal.aborted) break
        await this.heartbeat(session)
        if (controller.signal.aborted) break
        clearInterval(this.heartbeatTimer)
        heartbeatTimer = setInterval(() => {
          if (!controller.signal.aborted)
            void this.heartbeat(session).catch((error) => {
              if (controller.signal.aborted) return
              this.problem = error instanceof ApiError ? error.code : 'unknown'
              if (this.problem === 'unauthenticated') controller.abort()
              this.changed()
            })
        }, 15000)
        heartbeatTimer.unref()
        this.heartbeatTimer = heartbeatTimer
        await readStream(
          session.protocol.client,
          controller.signal,
          (kind, value) => {
            if (controller.signal.aborted) return
            if (kind === 'sync') {
              delay = 1000
              this.status = 'online'
              this.problem = null
              const pending = (value as { pending: string[] }).pending
              for (const opId of new Set([...pending, ...session.journal.list()]))
                this.run(session, opId)
            } else if (kind === 'operation') {
              this.run(session, (value as { op_id: string }).op_id)
            } else if (kind === 'config') {
              void this.configuration(session)
                .then(() => {
                  for (const opId of new Set([...session.pending, ...session.journal.list()]))
                    this.run(session, opId)
                  this.changed()
                })
                .catch(() => {})
            }
            this.changed()
          },
          'stream',
        )
      } catch (error) {
        if (controller.signal.aborted) break
        this.problem = error instanceof ApiError ? error.code : 'unknown'
        if (
          [
            'unauthenticated',
            'different_character',
            'outbox_owner_mismatch',
            'server_upgrade_required',
            'client_upgrade_required',
            'credentials_unavailable',
          ].includes(this.problem)
        ) {
          controller.abort()
          break
        }
      } finally {
        clearInterval(heartbeatTimer)
      }
      if (controller.signal.aborted) break
      this.status = 'offline'
      this.changed()
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          controller.signal.removeEventListener('abort', done)
          resolve()
        }
        const timer = setTimeout(done, delay)
        controller.signal.addEventListener('abort', done, { once: true })
      })
      delay = Math.min(delay * 2, 30000)
    }
    if (this.controller === controller) {
      this.status = 'offline'
      this.changed()
    }
  }
  disconnect() {
    this.epoch++
    this.startKey = ''
    this.stopTransport()
  }
  private stopTransport() {
    this.controller?.abort()
    this.controller = undefined
    clearInterval(this.heartbeatTimer)
    this.status = 'offline'
    this.changed()
  }
  async settled() {
    await Promise.allSettled(
      [...this.sessions.values()].flatMap((session) => [...session.tasks.values()]),
    )
  }
  async stopped() {
    this.disconnect()
    await this.listening
  }
}
