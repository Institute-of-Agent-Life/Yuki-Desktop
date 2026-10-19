import { afterEach, expect, it } from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  statSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Outbox } from '../../src/main/outbox'
import { ExecutorJournal, type ExecutorResult } from '../../src/main/executor/journal'
import {
  ExecutorRunner,
  type ExecutorEffects,
  type ExecutorTask,
  type ExecutorTransport,
} from '../../src/main/executor/runner'
const owner = {
  characterId: 'role-a',
  personId: 'person-a',
  conversationId: 'entry-a',
  bindingId: 'app-a',
}
const resources: { dir: string; box: Outbox }[] = []
afterEach(() => {
  for (const item of resources.splice(0)) {
    if (item.box.db.open) item.box.db.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
})
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'yuki-executor-')),
    path = join(dir, 'outbox.sqlite3'),
    target = join(dir, 'original.txt'),
    counter = join(dir, 'writes'),
    item = { dir, box: new Outbox(path, owner) }
  resources.push(item)
  let journal = new ExecutorJournal(item.box, 'executor-a'),
    task: ExecutorTask = {
      opId: 'original-op',
      capability: 'folder.write',
      params: {},
      state: 'dispatched',
    }
  const reports: ExecutorResult[] = []
  let acks = 0
  const transport: ExecutorTransport = {
    async get(id) {
      expect(id).toBe(task.opId)
      return { ...task }
    },
    async ack(id) {
      expect(id).toBe(task.opId)
      expect(journal.get(id)).toEqual({ phase: 'started' })
      acks++
      task = { ...task, state: 'acknowledged' }
      return { ...task }
    },
    async result(id, result) {
      expect(journal.get(id)).toEqual({ phase: 'finished', result })
      reports.push(structuredClone(result))
      task = { ...task, state: result.state }
      return { ...task }
    },
  }
  const effects: ExecutorEffects = {
    async execute() {
      expect(task.state).toBe('acknowledged')
      writeFileSync(target, 'original bytes')
      appendFileSync(counter, 'write\n')
      const bytes = readFileSync(target)
      return {
        state: 'succeeded',
        level: 'confirmed',
        result: { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length },
      }
    },
    async observe() {
      if (!existsSync(target)) return { exists: false }
      const bytes = readFileSync(target)
      return {
        exists: true,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.length,
        mtime: statSync(target).mtimeMs,
        matches_intended: bytes.toString() === 'original bytes',
      }
    },
  }
  return {
    dir,
    target,
    transport,
    effects,
    reports,
    get journal() {
      return journal
    },
    get box() {
      return item.box
    },
    get task() {
      return task
    },
    get acks() {
      return acks
    },
    writes: () =>
      existsSync(counter) ? readFileSync(counter, 'utf8').trim().split('\n').length : 0,
    runner: () => new ExecutorRunner(journal, transport, effects),
    reopen() {
      item.box.db.close()
      item.box = new Outbox(path, owner)
      journal = new ExecutorJournal(item.box, 'executor-a')
      return new ExecutorRunner(journal, transport, effects)
    },
  }
}

it('pausing during ack holds the original operation until resume without executing or reporting unknown', async () => {
  const h = setup()
  let allowed = true
  const ack = h.transport.ack
  h.transport.ack = async (id) => {
    const result = await ack(id)
    allowed = false
    return result
  }
  const runner = new ExecutorRunner(h.journal, h.transport, h.effects, () => allowed)
  expect((await runner.run('original-op')).state).toBe('acknowledged')
  expect(h.writes()).toBe(0)
  expect(h.reports).toEqual([])
  expect(h.journal.get('original-op')).toEqual({ phase: 'started' })
  expect((await runner.run('original-op')).state).toBe('acknowledged')
  expect(h.writes()).toBe(0)
  allowed = true
  expect((await runner.run('original-op')).state).toBe('succeeded')
  expect(h.writes()).toBe(1)
  expect(h.acks).toBe(1)
})

it('persists started before ack and resumes an unaccepted ack after reopening the original SQLite', async () => {
  const h = setup(),
    ack = h.transport.ack
  h.transport.ack = async () => {
    throw Error('request never reached server')
  }
  await expect(h.runner().run('original-op')).rejects.toThrow('never reached')
  expect(h.writes()).toBe(0)
  expect(h.task.state).toBe('dispatched')
  h.transport.ack = ack
  await h.reopen().run('original-op')
  expect(h.writes()).toBe(1)
  expect(h.reports.map((result) => result.state)).toEqual(['succeeded'])
  expect(h.journal.get('original-op')).toBeUndefined()
})

it.each([false, true])(
  'a cold acknowledged operation reports current matching bytes as observation, never causal proof (record lost: %s)',
  async (lost) => {
    const h = setup(),
      ack = h.transport.ack
    writeFileSync(h.target, 'original bytes')
    h.transport.ack = async (id) => {
      await ack(id)
      throw Error('ack response lost before crash')
    }
    await expect(h.runner().run('original-op')).rejects.toThrow('response lost')
    expect(h.writes()).toBe(0)
    if (lost) h.journal.accepted('original-op')
    await h.reopen().run('original-op')
    expect(h.writes()).toBe(0)
    expect(h.acks).toBe(1)
    expect(h.reports).toEqual([
      expect.objectContaining({
        state: 'unknown',
        result: {},
        observation: expect.objectContaining({ exists: true, matches_intended: true }),
      }),
    ])
  },
)

it('an unconfirmed ack response and a failed started write cannot authorize an effect', async () => {
  const h = setup(),
    ack = h.transport.ack,
    runner = h.runner()
  h.box.db.exec(`CREATE TRIGGER fail_started BEFORE INSERT ON local_executor_operations
    WHEN NEW.phase='started' BEGIN SELECT RAISE(ABORT,'disk failure'); END`)
  await expect(runner.run('original-op')).rejects.toThrow('disk failure')
  expect(h.acks).toBe(0)
  expect(h.writes()).toBe(0)
  h.box.db.exec('DROP TRIGGER fail_started')
  h.transport.ack = async () => h.task
  await expect(runner.run('original-op')).rejects.toMatchObject({ code: 'invalid_response' })
  expect(h.writes()).toBe(0)
  expect(h.journal.get('original-op')).toEqual({ phase: 'started' })
  h.transport.ack = ack
  await runner.run('original-op')
  expect(h.writes()).toBe(1)
})

it('a live process can confirm its own lost ack without pretending it crashed or repeating an effect', async () => {
  const h = setup(),
    ack = h.transport.ack,
    runner = h.runner()
  h.transport.ack = async (id) => {
    await ack(id)
    throw Error('ack response lost')
  }
  await expect(runner.run('original-op')).rejects.toThrow('response lost')
  expect(h.writes()).toBe(0)
  await runner.run('original-op')
  expect(h.acks).toBe(1)
  expect(h.writes()).toBe(1)
  expect(h.reports.map((result) => result.state)).toEqual(['succeeded'])
})

it('reconnecting while the original native execution is still running waits for that same execution', async () => {
  const h = setup(),
    runner = h.runner(),
    execute = h.effects.execute
  let release!: () => void, entered!: () => void
  const started = new Promise<void>((resolve) => {
      entered = resolve
    }),
    blocked = new Promise<void>((resolve) => {
      release = resolve
    })
  h.effects.execute = async (task) => {
    entered()
    await blocked
    return execute(task)
  }
  const original = runner.run('original-op')
  await started
  const reconnect = runner.run('original-op')
  expect(reconnect).toBe(original)
  expect(h.reports).toHaveLength(0)
  expect(h.journal.get('original-op')).toEqual({ phase: 'started' })
  release()
  await Promise.all([original, reconnect])
  expect(h.writes()).toBe(1)
  expect(h.acks).toBe(1)
})

it.each([false, true])(
  'a finished operation after a cold restart only reports or clears its original result (server accepted: %s)',
  async (accepted) => {
    const h = setup(),
      report = h.transport.result
    h.transport.result = async (id, result) => {
      if (accepted) await report(id, result)
      throw Error('result response lost')
    }
    await expect(h.runner().run('original-op')).rejects.toThrow('response lost')
    expect(h.journal.get('original-op')?.phase).toBe('finished')
    h.transport.result = report
    await h.reopen().run('original-op')
    expect(h.writes()).toBe(1)
    expect(h.acks).toBe(1)
    expect(h.reports).toHaveLength(1)
    expect(h.journal.get('original-op')).toBeUndefined()
  },
)

it('SQLite failure after the actual write retains the observed outcome in this live process', async () => {
  const h = setup(),
    runner = h.runner()
  h.box.db.exec(`CREATE TRIGGER fail_finished BEFORE INSERT ON local_executor_operations
    WHEN NEW.phase='finished' BEGIN SELECT RAISE(ABORT,'disk failure'); END`)
  await expect(runner.run('original-op')).rejects.toThrow('disk failure')
  expect(h.writes()).toBe(1)
  expect(h.reports).toHaveLength(0)
  h.box.db.exec('DROP TRIGGER fail_finished')
  await runner.run('original-op')
  expect(h.writes()).toBe(1)
  expect(h.reports.map((result) => result.state)).toEqual(['succeeded'])
})

it('executor records cannot share a namespace or replace a previously finished outcome', () => {
  const h = setup(),
    other = new ExecutorJournal(h.box, 'executor-b')
  h.journal.started('original-op')
  expect(other.get('original-op')).toBeUndefined()
  const result: ExecutorResult = { state: 'failed', result: { reason: 'scope_unavailable' } }
  h.journal.finished('original-op', result)
  h.journal.finished('original-op', result)
  expect(() => h.journal.finished('original-op', { state: 'unknown', result: {} })).toThrow()
  other.accepted('original-op')
  expect(h.journal.get('original-op')).toEqual({ phase: 'finished', result })
})
