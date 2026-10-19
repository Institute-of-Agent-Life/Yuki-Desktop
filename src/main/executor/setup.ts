import type { ExecutorView } from '../../shared/executor'
import { ApiClient, ApiError } from '../api/client'
import type { ExecutorCommands } from '../outbox/executor-commands'
import type { ExecutorInstallation } from './installation'

/** Durable command links survive crashes between orphan revocation and replacement. */
export class ExecutorSetup {
  private enabling?: Promise<ReturnType<ExecutorInstallation['publicState']>>
  constructor(
    private commands: ExecutorCommands,
    private installation: ExecutorInstallation,
  ) {
    commands.box.db.exec(`CREATE TABLE IF NOT EXISTS executor_setup(
      id INTEGER PRIMARY KEY CHECK(id=1), create_request TEXT NOT NULL, revoke_request TEXT)`)
  }
  private flow() {
    return this.commands.box.db.prepare('SELECT * FROM executor_setup WHERE id=1').get() as
      { create_request: string; revoke_request: string | null } | undefined
  }
  private create(label: string, platform: string) {
    this.commands.box.db.transaction(() => {
      const item = this.commands.prepare({ kind: 'create', label, platform })
      this.commands.box.db
        .prepare(
          `INSERT INTO executor_setup VALUES(1,?,NULL)
        ON CONFLICT(id) DO UPDATE SET create_request=excluded.create_request,revoke_request=NULL`,
        )
        .run(item.requestId)
    })()
  }
  enable(client: ApiClient, label: string, platform: string) {
    if (this.enabling) return this.enabling
    const work = this.performEnable(client, label, platform).finally(() => {
      this.enabling = undefined
    })
    this.enabling = work
    return work
  }
  private async performEnable(client: ApiClient, label: string, platform: string) {
    await this.commands.box.verifyOwner(client)
    if (this.installation.current()) return this.installation.publicState()
    if (!this.flow()) this.create(label, platform)
    while (true) {
      const flow = this.flow()!,
        item = await this.commands.run(client, flow.create_request)
      if (item.state !== 'result' || item.problem)
        throw new ApiError(item.problem ?? 'transport_unknown')
      const current = this.installation.current()
      if (current) {
        if (current.executorId !== item.result?.executor_id) throw new ApiError('request_conflict')
        return this.installation.publicState()
      }
      if (!item.result) throw new ApiError('invalid_response')
      const executorId = item.result.executor_id
      const listed = await client.get<ExecutorView[]>('executors'),
        orphan = listed.find((row) => row.executor_id === executorId)
      if (orphan?.claimed) throw new ApiError('executor_credentials_unavailable')
      if (orphan || flow.revoke_request) {
        let requestId = flow.revoke_request
        if (!requestId)
          this.commands.box.db.transaction(() => {
            requestId = this.commands.prepare({ kind: 'delete', executorId }).requestId
            this.commands.box.db
              .prepare('UPDATE executor_setup SET revoke_request=? WHERE id=1')
              .run(requestId)
          })()
        const revoked = await this.commands.run(client, requestId!)
        if (revoked.state !== 'result' || revoked.problem)
          throw new ApiError(revoked.problem ?? 'transport_unknown')
      }
      this.create(label, platform)
    }
  }
  removed() {
    this.commands.box.db.prepare('DELETE FROM executor_setup').run()
  }
}
