/*
 * Desktop supervision of its `run --desktop-stdin` Connector child (Yuki task book 2026-11-09
 * §5.9 item 3, §7.5 S4–S7). Failure cases, written before the code:
 *
 * F1 An unexpected child exit (crash, kill) is not restarted.
 * F2 Restarts have no backoff, the backoff never grows, or it is not reset after the child
 *    reports `connected`, so a crash loop busy-waits or a recovered child waits too long.
 * F3 An explicit stop restarts the child, or a restart already scheduled fires after it.
 * F4 Desktop quit (`close()`) restarts the child, or a scheduled restart fires after it.
 * F5 Replacing the child (explicit start, update) is counted as an unexpected exit.
 * F6 State lines split across chunks, `\r\n`, non-JSON output or the `{"problem"}` line
 *    are mis-parsed; an unknown state is accepted.
 * F7 Child stderr is discarded, grows without bound, or rotation loses the current file.
 * F8 The last exit code/signal is missing, or an expected stop is reported as an exit.
 * F9 The restart count is not reset by an explicit start.
 * F10 `authorization_lost` is treated as a failure to restart; the live child is replaced.
 * F11 The diagnostics export lacks the stderr tail or the supervision facts.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentConnector, rotatingLog, stateLine } from '../../src/main/agent-connector'
import type { ConnectorAvailableState, ConnectorState } from '../../src/shared/connector'

type Step = 'crash' | 'connect-then-crash' | 'stay' | 'auth'
interface ChildEvent {
  kind: 'start' | 'eof'
  step?: Step
  pid: number
  at: number
}

// A Connector stand-in run by the shipped Electron-as-Node runtime. It follows plan.json by
// start index and prints the same stdout channel as `run --desktop-stdin`, including output
// that is not a state line.
const child = `
const fs = require('node:fs'), path = require('node:path')
const dir = process.argv[process.argv.indexOf('--data-dir') + 1]
const file = path.join(dir, 'events.jsonl')
const event = (value) =>
  fs.appendFileSync(file, JSON.stringify({ ...value, pid: process.pid, at: Date.now() }) + '\\n')
const starts = fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').split('\\n').filter((line) => line.includes('"start"')).length
  : 0
const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'))
const step = plan[Math.min(starts, plan.length - 1)]
event({ kind: 'start', step })
process.stdout.write('native library chatter, not JSON\\r\\n')
process.stdout.write(JSON.stringify({ problem: 'unrelated_problem_line' }) + '\\n')
process.stdout.write(JSON.stringify({ type: 'state', state: 'not_a_state' }) + '\\n')
if (step === 'crash') {
  process.stderr.write('Traceback: crash in ' + process.pid + '\\n', () => process.exit(3))
} else {
  process.stdin.resume()
  process.stdin.once('end', () => { event({ kind: 'eof' }); process.exit(0) })
  process.stdout.write('{"type":"state",')
  setTimeout(() => {
    const state = step === 'auth' ? 'authorization_lost' : 'connected'
    process.stdout.write('"state":"' + state + '"}\\r\\n')
    if (step === 'connect-then-crash')
      setTimeout(() => process.stderr.write('later crash\\n', () => process.exit(4)), 100)
  }, 20)
}
`

const temporary: string[] = []
const live: AgentConnector[] = []
afterEach(async () => {
  for (const connector of live.splice(0)) await connector.close()
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})

async function supervised(plan: Step[]) {
  const directory = await mkdtemp(join(tmpdir(), 'connector-supervisor-'))
  temporary.push(directory)
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan))
  const status = {
    data_directory: directory,
    paired: true,
    device_id: 'original-device',
    instances: [],
    service: { installed: false, running: false },
  }
  const changed = vi.fn()
  const connector = new AgentConnector(
    {
      root: join(directory, 'root'),
      bundledRuntime: join(directory, 'not-bundled'),
      store: (() => {
        const values = new Map<string, unknown>()
        return {
          get: <T>(key: string) => values.get(key) as T | undefined,
          set: (key: string, value: unknown) => void values.set(key, value),
        }
      })(),
      authorize: vi.fn(),
      admission: vi.fn(),
      verifyServer: vi.fn(),
      changed,
    },
    vi.fn(async (_runtime: unknown, args: readonly string[]) =>
      args.includes('status') ? JSON.stringify(status) : 'ok',
    ),
  )
  live.push(connector)
  connector.installations.select({
    managed: true,
    dataDirectory: directory,
    runtime: {
      directory,
      executable: process.execPath,
      arguments: ['-e', child, '--'],
      version: '0.4.4',
      protocol: 4,
      build: 'supervisor-fixture',
    },
  })
  vi.spyOn(connector.installations, 'manifest').mockResolvedValue(undefined)
  const events = async () =>
    existsSync(join(directory, 'events.jsonl'))
      ? (await readFile(join(directory, 'events.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as ChildEvent)
      : []
  const starts = async () => (await events()).filter((event) => event.kind === 'start')
  const state = async () => {
    const value: ConnectorState = await connector.state()
    expect(value.available).toBe(true)
    return value as ConnectorAvailableState
  }
  return { connector, directory, events, starts, state, changed }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const until = { timeout: 15000, interval: 25 }

it('restarts unexpected exits with growing backoff, resets it on connected and stops on explicit stop', async () => {
  const fixture = await supervised(['crash', 'crash', 'connect-then-crash', 'stay'])
  await fixture.connector.service('start')
  await vi.waitFor(async () => expect(await fixture.starts()).toHaveLength(4), until)
  await vi.waitFor(async () => expect((await fixture.state()).supervision?.link).toBe('connected'))
  const starts = await fixture.starts()
  const gaps = starts.slice(1).map((start, index) => start.at - starts[index]!.at)
  // F2: 1 s, then 2 s while the child never connected; `connected` resets it to 1 s.
  expect(gaps[0]).toBeGreaterThanOrEqual(1000)
  expect(gaps[1]).toBeGreaterThanOrEqual(2000)
  expect(gaps[2]).toBeGreaterThanOrEqual(1000)
  expect(gaps[2]).toBeLessThan(gaps[1]!)
  const running = await fixture.state()
  expect(running.running).toBe(true)
  expect(running.supervision).toMatchObject({
    link: 'connected',
    restarts: 3,
    restartPending: false,
    lastExit: { code: 4, signal: null },
  })
  // F7: every crash's stderr is on disk next to connector.log.
  const stderr = await readFile(join(fixture.directory, 'connector-stderr.log'), 'utf8')
  for (const crashed of starts.slice(0, 2)) expect(stderr).toContain(`crash in ${crashed.pid}`)
  expect(stderr).toContain('later crash')
  // F11: the export carries both the facts and the stderr tail.
  const diagnostics = await fixture.connector.diagnostics()
  expect(diagnostics.connector.supervision).toMatchObject({ restarts: 3, link: 'connected' })
  expect(diagnostics.connector_stderr_log?.text).toContain('later crash')
  expect(diagnostics.connector_log).toBeNull()
  // F3/F8: an explicit stop closes stdin, is not an exit to report and is never restarted.
  await fixture.connector.service('stop')
  expect((await fixture.events()).at(-1)).toMatchObject({ kind: 'eof', pid: starts[3]!.pid })
  await wait(1500)
  expect(await fixture.starts()).toHaveLength(4)
  const stopped = await fixture.state()
  expect(stopped.running).toBe(false)
  expect(stopped.supervision).toMatchObject({ restartPending: false, lastExit: { code: 4 } })
  // F9: the next explicit start counts from zero.
  await fixture.connector.service('start')
  expect((await fixture.state()).supervision?.restarts).toBe(0)
  // CI uploads this directory; locally the timeline stays in the temporary data directory.
  const output = process.env.YUKI_E2E_OUTPUT ?? fixture.directory
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'connector-supervisor.json'),
    JSON.stringify({ events: await fixture.events(), gaps, diagnostics }, null, 2),
  )
}, 30000)

it('an explicit stop or Desktop quit cancels a restart that is already scheduled', async () => {
  for (const finish of ['stop', 'close'] as const) {
    const fixture = await supervised(['crash', 'stay'])
    await fixture.connector.service('start')
    await vi.waitFor(
      async () => expect((await fixture.state()).supervision?.restartPending).toBe(true),
      until,
    )
    const pending = await fixture.state()
    expect(pending.running).toBe(false)
    expect(pending.supervision?.lastExit?.code).toBe(3)
    if (finish === 'stop') await fixture.connector.service('stop')
    else await fixture.connector.close()
    await wait(1500)
    expect(await fixture.starts()).toHaveLength(1)
  }
}, 30000)

it('Desktop quit ends a connected child without restarting it', async () => {
  const fixture = await supervised(['stay'])
  await fixture.connector.service('start')
  await vi.waitFor(async () => expect((await fixture.state()).supervision?.link).toBe('connected'))
  await fixture.connector.close()
  expect((await fixture.events()).map((event) => event.kind)).toEqual(['start', 'eof'])
  await wait(1500)
  expect(await fixture.starts()).toHaveLength(1)
}, 30000)

it('authorization_lost keeps the live child and reports it without restarting', async () => {
  const fixture = await supervised(['auth'])
  await fixture.connector.service('start')
  await vi.waitFor(async () =>
    expect((await fixture.state()).supervision?.link).toBe('authorization_lost'),
  )
  await wait(1200)
  const current = await fixture.state()
  expect(current.running).toBe(true)
  expect(current.supervision).toMatchObject({ restarts: 0, restartPending: false })
  expect(current.supervision?.lastExit).toBeUndefined()
  expect(await fixture.starts()).toHaveLength(1)
  expect(fixture.changed).toHaveBeenCalled()
}, 30000)

it('reads only state lines from the shared stdout channel', () => {
  expect(stateLine('{"type":"state","state":"connected"}\r')).toEqual({ link: 'connected' })
  expect(stateLine('{"type":"state","state":"disconnected","reason":"http_502"}')).toEqual({
    link: 'disconnected',
    reason: 'http_502',
  })
  expect(stateLine('{"problem":"connector_configuration_failed"}')).toBeUndefined()
  expect(stateLine('{"type":"state","state":"not_a_state"}')).toBeUndefined()
  expect(stateLine('{"type":"activity","state":"connected"}')).toBeUndefined()
  expect(stateLine('not json')).toBeUndefined()
  expect(stateLine('null')).toBeUndefined()
})

it('rotates stderr like connector.log: current file plus two backups, oldest dropped', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'connector-stderr-'))
  temporary.push(directory)
  const path = join(directory, 'connector-stderr.log')
  const write = rotatingLog(path, 10, 2)
  for (const chunk of ['aaaaaa\n', 'bbbbbb\n', 'cccccc\n', 'dddddd\n']) write(Buffer.from(chunk))
  expect((await readdir(directory)).sort()).toEqual([
    'connector-stderr.log',
    'connector-stderr.log.1',
    'connector-stderr.log.2',
  ])
  expect(await readFile(path, 'utf8')).toBe('dddddd\n')
  expect(await readFile(path + '.1', 'utf8')).toBe('cccccc\n')
  expect(await readFile(path + '.2', 'utf8')).toBe('bbbbbb\n')
  // A new writer continues the existing file instead of truncating it.
  rotatingLog(path, 100, 2)(Buffer.from('eeeeee\n'))
  expect(await readFile(path, 'utf8')).toBe('dddddd\neeeeee\n')
})
