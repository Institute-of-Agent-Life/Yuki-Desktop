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
 *
 * Owner control, activity and permissions (Yuki task book 2026-11-09 §5.5 items 3–5, §7.4 D1,
 * D8–D10), also written before the code:
 *
 * C1 (D10) A restarted child is not told the stopped holder, or that child's own startup line
 *    (`holder:none`, `reason:start`, printed before it read stdin) replaces Desktop's stop, so
 *    the next restart sends `none`.
 * C2 「停止」/「繼續」 is not one JSON line on the live child's stdin, or the state does not
 *    follow the holder and reason the Connector then reports.
 * C3 A stop pressed while the child is between restarts is lost instead of reaching the next one.
 * C4 The Connector's own control lines (its `desktop` answer to 「停止」, `resume` asked in chat)
 *    do not replace Desktop's request with their real reason and time. The owner's own input on
 *    the computer only makes Yuki yield; it is never a control line or a stop reason.
 * C5 Activity: `start` is not shown, `end` clears it at once (flicker between actions) or never
 *    clears it, or a child that exited still reads as operating.
 * C6 An old Connector (0.4.4: no control/activity/permissions lines) receives control lines it
 *    never asked for, or its state grows control/activity/permission facts.
 * C7 Unknown holders, tools, phases or non-boolean permissions are accepted; the new line types
 *    break state-line parsing.
 * C8 The permissions line is not exposed in the state.
 * C9 EOF no longer stops the child once control lines share its stdin.
 *
 * Background operation (Yuki computer-use phase 3b, docs/operations/computer-3b-20261110.md
 * W23), written before the code:
 *
 * C10 A `computer` activity with `mode:"background"` (one window, the owner's cursor untouched)
 *     reads the same as foreground input, or a foreground action right after a background one
 *     keeps showing background; a line without `mode` (Connector 0.5.0) or with an unknown mode
 *     reads as background.
 */
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentConnector, connectorLine, rotatingLog } from '../../src/main/agent-connector'
import type { ConnectorAvailableState, ConnectorState } from '../../src/shared/connector'

type Step = 'crash' | 'connect-then-crash' | 'stay' | 'auth' | 'old' | 'contract' | 'deaf'
interface ChildEvent {
  kind: 'start' | 'eof' | 'stdin'
  step?: Step
  line?: string
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

// A Connector stand-in for the owner-control contract. `contract` answers each stdin control line
// with the Connector's own control line; `deaf` prints its startup line and dies before reading
// stdin (it only records what arrived); `old` is 0.4.4 and prints no control lines. Lines the
// test appends to emit.jsonl are printed as the Connector's own reports (owner input, activity).
const contract = `
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline')
const dir = process.argv[process.argv.indexOf('--data-dir') + 1]
const file = path.join(dir, 'events.jsonl')
const event = (value) =>
  fs.appendFileSync(file, JSON.stringify({ ...value, pid: process.pid, at: Date.now() }) + '\\n')
const starts = fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').split('\\n').filter(Boolean).filter((line) => JSON.parse(line).kind === 'start').length
  : 0
const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'))
const step = plan[Math.min(starts, plan.length - 1)]
const print = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
// Where this child starts reading, fixed before it reports connected: a line the test appends
// after seeing it connected is never taken for one of an earlier child's.
const emit = path.join(dir, 'emit.jsonl')
let offset = fs.existsSync(emit) ? fs.readFileSync(emit, 'utf8').length : 0
event({ kind: 'start', step })
print({ type: 'state', state: 'connected' })
if (step !== 'old')
  print({ type: 'control', holder: 'none', since: new Date().toISOString(), reason: 'start' })
readline
  .createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on('line', (line) => {
    event({ kind: 'stdin', line })
    const value = step === 'contract' ? JSON.parse(line) : {}
    if (value.type === 'control')
      print({ type: 'control', holder: value.holder, since: new Date().toISOString(), reason: 'desktop' })
  })
  .on('close', () => {
    event({ kind: 'eof' })
    process.exit(0)
  })
setInterval(() => {
  if (!fs.existsSync(emit)) return
  const text = fs.readFileSync(emit, 'utf8')
  for (const line of text.slice(offset).split('\\n').filter(Boolean)) process.stdout.write(line + '\\n')
  offset = text.length
}, 20)
`

const temporary: string[] = []
const live: AgentConnector[] = []
afterEach(async () => {
  for (const connector of live.splice(0)) await connector.close()
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})

async function supervised(plan: Step[], script = child) {
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
      arguments: ['-e', script, '--'],
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
  const stdin = async (pid: number) =>
    (await events())
      .filter((event) => event.kind === 'stdin' && event.pid === pid)
      .map((event) => event.line)
  const emit = (value: unknown) =>
    appendFile(join(directory, 'emit.jsonl'), JSON.stringify(value) + '\n')
  return { connector, directory, events, starts, state, changed, stdin, emit }
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

it('reads only the Connector report lines from the shared stdout channel', () => {
  expect(connectorLine('{"type":"state","state":"connected"}\r')).toEqual({
    type: 'state',
    link: 'connected',
  })
  expect(connectorLine('{"type":"state","state":"disconnected","reason":"http_502"}')).toEqual({
    type: 'state',
    link: 'disconnected',
    reason: 'http_502',
  })
  expect(connectorLine('{"problem":"connector_configuration_failed"}')).toBeUndefined()
  expect(connectorLine('{"type":"state","state":"not_a_state"}')).toBeUndefined()
  expect(connectorLine('{"type":"activity","state":"connected"}')).toBeUndefined()
  expect(connectorLine('not json')).toBeUndefined()
  expect(connectorLine('null')).toBeUndefined()
  // C7: the three 3a lines, exactly as the shared contract writes them.
  expect(
    connectorLine(
      '{"type":"control","holder":"owner","since":"2026-11-10T01:00:05Z","reason":"desktop"}',
    ),
  ).toEqual({
    type: 'control',
    control: { holder: 'owner', since: '2026-11-10T01:00:05Z', reason: 'desktop' },
  })
  expect(
    connectorLine('{"type":"activity","tool":"browser","action":"click","phase":"start"}'),
  ).toEqual({ type: 'activity', tool: 'browser', phase: 'start', background: false })
  // C10: only `mode:"background"` is background; 0.5.0 lines and unknown modes are not.
  expect(
    connectorLine(
      '{"type":"activity","tool":"computer","action":"click","mode":"background","phase":"start"}',
    ),
  ).toEqual({ type: 'activity', tool: 'computer', phase: 'start', background: true })
  expect(
    connectorLine(
      '{"type":"activity","tool":"computer","action":"click","mode":"foreground","phase":"end"}',
    ),
  ).toEqual({ type: 'activity', tool: 'computer', phase: 'end', background: false })
  expect(
    connectorLine('{"type":"activity","tool":"computer","mode":"window","phase":"start"}'),
  ).toEqual({ type: 'activity', tool: 'computer', phase: 'start', background: false })
  expect(connectorLine('{"type":"permissions","screen":false,"input":true}')).toEqual({
    type: 'permissions',
    permissions: { screen: false, input: true },
  })
  expect(connectorLine('{"type":"control","holder":"yuki","since":"x","reason":"start"}')).toBe(
    undefined,
  )
  expect(connectorLine('{"type":"activity","tool":"terminal","phase":"start"}')).toBeUndefined()
  expect(connectorLine('{"type":"activity","tool":"computer","phase":"done"}')).toBeUndefined()
  expect(connectorLine('{"type":"permissions","screen":"granted","input":true}')).toBeUndefined()
})

const OWNER = '{"type":"control","holder":"owner"}'
const NONE = '{"type":"control","holder":"none"}'

it('keeps a stop across restarts and round-trips 停止/繼續 through the live child', async () => {
  const fixture = await supervised(['contract', 'deaf', 'contract'], contract)
  const control = async () => (await fixture.state()).supervision?.control
  await fixture.connector.service('start')
  await vi.waitFor(
    async () => expect(await control()).toMatchObject({ holder: 'none', reason: 'start' }),
    until,
  )
  const [first] = await fixture.starts()
  // Desktop knew no holder when it spawned this child, so it wrote none.
  expect(await fixture.stdin(first!.pid)).toEqual([])
  // C2: 「停止」 is one line on the live child's stdin; the state follows the Connector's answer.
  fixture.connector.control('owner')
  await vi.waitFor(async () => expect(await fixture.stdin(first!.pid)).toEqual([OWNER]), until)
  await vi.waitFor(async () =>
    expect(await control()).toMatchObject({ holder: 'owner', reason: 'desktop' }),
  )
  // C1/D10: the restarted child is told before anything else; its own startup line, printed
  // before it read stdin, does not replace the stop even though it dies without answering.
  process.kill(first!.pid, 'SIGKILL')
  await vi.waitFor(async () => expect(await fixture.starts()).toHaveLength(2), until)
  const deaf = (await fixture.starts())[1]!
  await vi.waitFor(async () => expect(await fixture.stdin(deaf.pid)).toEqual([OWNER]), until)
  await vi.waitFor(async () => expect((await fixture.state()).running).toBe(true))
  await wait(300)
  expect(await control()).toMatchObject({ holder: 'owner', reason: 'desktop' })
  // C3: 「繼續」 pressed between restarts reaches the next child first.
  process.kill(deaf.pid, 'SIGKILL')
  await vi.waitFor(
    async () => expect((await fixture.state()).supervision?.restartPending).toBe(true),
    until,
  )
  fixture.connector.control('none')
  expect(await control()).toMatchObject({ holder: 'none', reason: 'desktop' })
  await vi.waitFor(async () => expect(await fixture.starts()).toHaveLength(3), until)
  const third = (await fixture.starts())[2]!
  await vi.waitFor(async () => expect(await fixture.stdin(third.pid)).toEqual([NONE]), until)
  fixture.connector.control('owner')
  await vi.waitFor(async () => expect(await fixture.stdin(third.pid)).toEqual([NONE, OWNER]), until)
  // C4: the Connector's own reports replace Desktop's request with their real reason and time.
  const resumed = {
    type: 'control',
    holder: 'none',
    since: '2026-11-10T01:00:00Z',
    reason: 'resume',
  }
  await fixture.emit(resumed)
  await vi.waitFor(async () =>
    expect(await control()).toEqual({ holder: 'none', since: resumed.since, reason: 'resume' }),
  )
  // The Connector's answer to the 「停止」 written above carries its own time.
  const answer = {
    type: 'control',
    holder: 'owner',
    since: '2026-11-10T01:00:05Z',
    reason: 'desktop',
  }
  await fixture.emit(answer)
  await vi.waitFor(async () =>
    expect(await control()).toEqual({ holder: 'owner', since: answer.since, reason: 'desktop' }),
  )
  // C8: preflight facts are part of the supervision state.
  await fixture.emit({ type: 'permissions', screen: false, input: true })
  await vi.waitFor(async () =>
    expect((await fixture.state()).supervision?.permissions).toEqual({
      screen: false,
      input: true,
    }),
  )
  // C9: EOF still stops the child; nothing restarts it.
  await fixture.connector.service('stop')
  expect((await fixture.events()).at(-1)).toMatchObject({ kind: 'eof', pid: third.pid })
  await wait(1500)
  expect(await fixture.starts()).toHaveLength(3)
  const output = process.env.YUKI_E2E_OUTPUT ?? fixture.directory
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'connector-control.json'),
    JSON.stringify({ events: await fixture.events(), state: await fixture.state() }, null, 2),
  )
}, 40000)

it('shows Yuki operating from an activity start until a while after its end, never after an exit', async () => {
  const fixture = await supervised(['contract'], contract)
  const activity = async () => (await fixture.state()).supervision?.activity
  await fixture.connector.service('start')
  await vi.waitFor(async () => expect((await fixture.state()).supervision?.link).toBe('connected'))
  expect(await activity()).toBeUndefined()
  const browser = { tool: 'browser', background: false }
  const window = { tool: 'computer', background: true }
  const screen = { tool: 'computer', background: false }
  await fixture.emit({ type: 'activity', tool: 'browser', action: 'navigate', phase: 'start' })
  await vi.waitFor(async () => expect(await activity()).toEqual(browser), until)
  // C5: no flicker between one action's end and the next action's start.
  await fixture.emit({ type: 'activity', tool: 'browser', action: 'navigate', phase: 'end' })
  await wait(500)
  expect(await activity()).toEqual(browser)
  // C10: one window in the background, then the whole screen in the foreground.
  const click = { type: 'activity', tool: 'computer', action: 'click' }
  await fixture.emit({ ...click, mode: 'background', phase: 'start' })
  await vi.waitFor(async () => expect(await activity()).toEqual(window), until)
  await fixture.emit({ ...click, mode: 'background', phase: 'end' })
  await fixture.emit({ ...click, mode: 'foreground', phase: 'start' })
  await vi.waitFor(async () => expect(await activity()).toEqual(screen), until)
  await fixture.emit({ ...click, mode: 'foreground', phase: 'end' })
  const ended = Date.now()
  await wait(500)
  expect(await activity()).toEqual(screen)
  await vi.waitFor(async () => expect(await activity()).toBeUndefined(), {
    timeout: 20000,
    interval: 100,
  })
  expect(Date.now() - ended).toBeGreaterThanOrEqual(9000)
  // An exited child operates nothing, even mid-action.
  await fixture.emit({ type: 'activity', tool: 'computer', action: 'type', phase: 'start' })
  await vi.waitFor(async () => expect(await activity()).toEqual(screen), until)
  const [started] = await fixture.starts()
  process.kill(started!.pid, 'SIGKILL')
  await vi.waitFor(
    async () => expect((await fixture.state()).supervision?.restartPending).toBe(true),
    until,
  )
  expect(await activity()).toBeUndefined()
}, 40000)

it('an old Connector without control lines is never sent one and reports no control facts', async () => {
  const fixture = await supervised(['old'], contract)
  await fixture.connector.service('start')
  await vi.waitFor(async () => expect((await fixture.state()).supervision?.link).toBe('connected'))
  await wait(300)
  const [started] = await fixture.starts()
  expect(await fixture.stdin(started!.pid)).toEqual([])
  const { supervision } = await fixture.state()
  expect(supervision?.control).toBeUndefined()
  expect(supervision?.activity).toBeUndefined()
  expect(supervision?.permissions).toBeUndefined()
  // A restart of the old child still has nothing to send.
  process.kill(started!.pid, 'SIGKILL')
  await vi.waitFor(async () => expect(await fixture.starts()).toHaveLength(2), until)
  await vi.waitFor(async () => expect((await fixture.state()).supervision?.link).toBe('connected'))
  await wait(300)
  expect(await fixture.stdin((await fixture.starts())[1]!.pid)).toEqual([])
}, 30000)

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
