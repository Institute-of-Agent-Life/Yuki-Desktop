import { ApiError } from '../api/client'
import { ExecutorJournal, type ExecutorResult } from './journal'

export interface ExecutorTask {
  opId: string
  capability: string
  params: Record<string, unknown>
  state: 'registered' | 'dispatched' | 'acknowledged' | 'awaiting_user' | ExecutorResult['state']
}
export interface ExecutorTransport {
  get(opId: string): Promise<ExecutorTask>
  ack(opId: string): Promise<ExecutorTask>
  result(opId: string, result: ExecutorResult): Promise<ExecutorTask>
}
export interface ExecutorEffects {
  execute(task: ExecutorTask): Promise<ExecutorResult>
  observe(task: ExecutorTask): Promise<Record<string, unknown> | undefined>
}
const terminal = (task: ExecutorTask) => ['succeeded', 'failed', 'unknown'].includes(task.state)

/** Reconnection resumes original operations; it never creates or reassigns one. */
export class ExecutorRunner {
  private running = new Map<string, Promise<ExecutorTask>>()
  // Process-local witnesses are deliberately not persisted. A cold process
  // cannot use them to claim that an acknowledged effect has not happened.
  private beforeEffect = new Set<string>()
  private outcomes = new Map<string, ExecutorResult>()
  constructor(
    readonly journal: ExecutorJournal,
    private transport: ExecutorTransport,
    private effects: ExecutorEffects,
    private mayStart: () => boolean = () => true,
  ) {}
  run(opId: string): Promise<ExecutorTask> {
    const current = this.running.get(opId)
    if (current) return current
    const pending = this.resume(opId).finally(() => this.running.delete(opId))
    this.running.set(opId, pending)
    return pending
  }
  private original(opId: string, task: ExecutorTask) {
    if (task.opId !== opId) throw new ApiError('invalid_response')
    return task
  }
  private clear(opId: string) {
    this.journal.accepted(opId)
    this.beforeEffect.delete(opId)
    this.outcomes.delete(opId)
  }
  private async report(task: ExecutorTask, result: ExecutorResult) {
    // Keep the observed outcome in memory before SQLite, so an I/O failure
    // after the actual effect cannot make this live process execute it again.
    this.outcomes.set(task.opId, result)
    this.journal.finished(task.opId, result)
    const accepted = this.original(task.opId, await this.transport.result(task.opId, result))
    if (!terminal(accepted)) throw new ApiError('invalid_response')
    this.clear(task.opId)
    return accepted
  }
  private async unknown(task: ExecutorTask): Promise<ExecutorResult> {
    const observation = await this.effects.observe(task)
    return { state: 'unknown', result: {}, ...(observation ? { observation } : {}) }
  }
  private async resume(opId: string): Promise<ExecutorTask> {
    let task = this.original(opId, await this.transport.get(opId))
    if (terminal(task)) {
      this.clear(opId)
      return task
    }
    const local = this.journal.get(opId),
      outcome = this.outcomes.get(opId) ?? (local?.phase === 'finished' ? local.result : undefined)
    if (outcome) return this.report(task, outcome)
    if (task.state === 'registered' || (task.state === 'dispatched' && !this.mayStart()))
      return task
    if (task.state === 'dispatched') {
      this.journal.started(opId)
      this.beforeEffect.add(opId)
      task = this.original(opId, await this.transport.ack(opId))
      if (terminal(task)) {
        this.clear(opId)
        return task
      }
      if (!['acknowledged', 'awaiting_user'].includes(task.state))
        throw new ApiError('invalid_response')
    }
    if (!this.beforeEffect.has(opId)) return this.report(task, await this.unknown(task))
    if (!this.mayStart()) return task
    this.beforeEffect.delete(opId)
    let result: ExecutorResult
    try {
      result = await this.effects.execute(task)
    } catch {
      // A rejected native execution no longer has a running process to await;
      // its current observation cannot prove whether this invocation committed.
      result = await this.unknown(task)
    }
    return this.report(task, result)
  }
}
