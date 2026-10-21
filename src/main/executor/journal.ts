import type { Outbox } from '../outbox'
import { payloadHash } from '../outbox/fingerprint'
import { ApiError } from '../api/client'

export type ExecutorResult =
  | { state: 'succeeded'; level: 'confirmed' | 'submitted'; result: Record<string, unknown> }
  | { state: 'failed'; result: Record<string, unknown> }
  | { state: 'unknown'; result: Record<string, unknown>; observation?: Record<string, unknown> }

export type LocalExecution = { phase: 'started' } | { phase: 'finished'; result: ExecutorResult }

/** The same immutable Person/App namespace and SQLite as the original outbox. */
export class ExecutorJournal {
  constructor(
    readonly box: Outbox,
    readonly executorId: string,
  ) {
    box.db.exec(`CREATE TABLE IF NOT EXISTS local_executor_operations(
      executor_id TEXT NOT NULL, op_id TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('started','finished')), result_json TEXT,
      PRIMARY KEY(executor_id,op_id),
      CHECK((phase='started' AND result_json IS NULL) OR
        (phase='finished' AND result_json IS NOT NULL)))`)
  }
  get(opId: string): LocalExecution | undefined {
    const row = this.box.db
      .prepare(
        'SELECT phase,result_json FROM local_executor_operations WHERE executor_id=? AND op_id=?',
      )
      .get(this.executorId, opId) as
      { phase: 'started' | 'finished'; result_json: string | null } | undefined
    if (!row) return
    return row.phase === 'started'
      ? { phase: 'started' }
      : { phase: 'finished', result: JSON.parse(row.result_json!) }
  }
  list() {
    return (
      this.box.db
        .prepare('SELECT op_id FROM local_executor_operations WHERE executor_id=? ORDER BY rowid')
        .all(this.executorId) as { op_id: string }[]
    ).map((row) => row.op_id)
  }
  started(opId: string) {
    this.box.db
      .prepare("INSERT OR IGNORE INTO local_executor_operations VALUES(?,?,'started',NULL)")
      .run(this.executorId, opId)
  }
  finished(opId: string, result: ExecutorResult) {
    this.box.db.transaction(() => {
      const previous = this.get(opId)
      if (previous?.phase === 'finished') {
        if (
          payloadHash('executor.result', opId, previous.result) !==
          payloadHash('executor.result', opId, result)
        )
          throw new ApiError('request_conflict')
        return
      }
      this.box.db
        .prepare(
          `INSERT INTO local_executor_operations VALUES(?,?,'finished',?)
        ON CONFLICT(executor_id,op_id) DO UPDATE SET phase='finished',result_json=excluded.result_json`,
        )
        .run(this.executorId, opId, JSON.stringify(result))
    })()
  }
  accepted(opId: string) {
    this.box.db
      .prepare('DELETE FROM local_executor_operations WHERE executor_id=? AND op_id=?')
      .run(this.executorId, opId)
  }
}
