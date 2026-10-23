import { PassThrough } from 'node:stream'
import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentConnector, runConnector } from '../../src/main/agent-connector'
import { ConnectorInstallations } from '../../src/main/connector-installation'
import type { ConnectorServiceAction } from '../../src/shared/connector'

const runtime = {
  directory: tmpdir(),
  executable: join(tmpdir(), 'python.exe'),
  arguments: ['-B', '-m', 'yuki_agent_connector'],
  version: '0.3.0',
  protocol: 3,
  build: 'original',
}
const publicStatus = {
  version: '0.3.0',
  protocol: 3,
  runtime: runtime.executable,
  paired: true,
  server: 'https://yuki.example',
  device_id: 'original-device',
  instances: [{ id: 'original-profile', label: 'Home Codex', driver: 'codex' }],
  service: { installed: true, running: true, executable: runtime.executable },
}
const temporary: string[] = []
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})
function store() {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: (key: string, value: unknown) => {
      values.set(key, value)
    },
  }
}
function fixture(
  run = vi.fn(async (_runtime: unknown, args: readonly string[]) =>
    args.includes('status') ? JSON.stringify(publicStatus) : 'ok',
  ),
) {
  const options = {
    root: join(tmpdir(), 'unused-root'),
    bundledRuntime: join(tmpdir(), 'not-bundled'),
    store: store(),
    authorize: vi.fn(async () => ({ server: 'https://yuki.example', code: 'private-code' })),
    admission: vi.fn(async () => ({ matched: true, connected: false })),
  }
  const connector = new AgentConnector(options, run)
  connector.installations.select({
    managed: false,
    dataDirectory: join(tmpdir(), 'original-data'),
    runtime,
  })
  return { connector, run, options }
}
it('uses an absolute Python and stdin with no shell or credential output', async () => {
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  })
  const launch = vi.fn(() => child as ChildProcessWithoutNullStreams)
  let input = ''
  child.stdin.on('data', (chunk) => {
    input += chunk.toString()
  })
  const args = ['pair', '--label', 'My $PC; & name', '--code-stdin']
  const result = runConnector(runtime, args, 'private-code\n', launch)
  child.stdout.write('paired')
  child.stderr.write('private diagnostic')
  child.emit('close', 0)
  expect(await result).toBe('paired')
  expect(input).toBe('private-code\n')
  expect(launch).toHaveBeenCalledWith(
    runtime.executable,
    [...runtime.arguments, ...args],
    expect.objectContaining({ shell: false, windowsHide: true }),
  )
  await expect(runConnector({ executable: 'python', arguments: [] }, [])).rejects.toHaveProperty(
    'code',
    'connector_runtime_invalid',
  )
})
it('status only projects public fields and never starts a service or changes ownership', async () => {
  const run = vi.fn(async () =>
    JSON.stringify({
      ...publicStatus,
      token: 'private-token',
      instances: [
        { ...publicStatus.instances[0], env: { API_KEY: 'secret' }, endpoint: 'private-owner' },
      ],
    }),
  )
  const { connector } = fixture(run)
  const result = await connector.state('character')
  expect(result).toMatchObject({
    deviceId: 'original-device',
    admission: { matched: true, connected: false },
  })
  expect(JSON.stringify(result)).not.toMatch(/private-token|API_KEY|private-owner/)
  expect(run).toHaveBeenCalledTimes(1)
})
it('matching original pair is reused and another person cannot overwrite it', async () => {
  const { connector, options, run } = fixture()
  await connector.connect({ characterId: 'character', label: 'PC' })
  expect(options.authorize).not.toHaveBeenCalled()
  options.admission.mockResolvedValue({ matched: false, connected: false })
  await expect(connector.connect({ characterId: 'another', label: 'PC' })).rejects.toHaveProperty(
    'code',
    'connector_owner_mismatch',
  )
  expect(run.mock.calls.every((call) => call[1].includes('status'))).toBe(true)
})
it.each(['install', 'start', 'stop', 'uninstall'] as const)(
  'service %s targets original data and rereads actual state',
  async (action) => {
    const { connector, run } = fixture()
    await connector.service(action)
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ['--data-dir', join(tmpdir(), 'original-data'), 'service', action],
      ['--data-dir', join(tmpdir(), 'original-data'), 'status', '--json'],
    ])
  },
)
it('rejects unknown service actions and multiline codes before launching', async () => {
  const { connector, run } = fixture()
  await expect(connector.service('exec' as ConnectorServiceAction)).rejects.toHaveProperty(
    'code',
    'validation_error',
  )
  await expect(
    connector.pair({ server: 'https://yuki.example', label: 'PC', code: 'first\nsecond' }),
  ).rejects.toHaveProperty('code', 'validation_error')
  expect(run).not.toHaveBeenCalled()
})
it('managed upgrades preserve the original data directory and separate installs preserve old data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-install-'))
  temporary.push(root)
  const bundle = join(root, 'bundle')
  await mkdir(bundle)
  async function manifest(content: string) {
    await writeFile(join(bundle, 'python.exe'), content)
    await writeFile(
      join(bundle, 'manifest.json'),
      JSON.stringify({
        version: '0.3.0',
        protocol: 3,
        platform: process.platform,
        arch: process.arch,
        executable: 'python.exe',
        arguments: ['-m', 'yuki_agent_connector'],
        files: [{ path: 'python.exe', sha256: createHash('sha256').update(content).digest('hex') }],
      }),
    )
  }
  await manifest('first')
  const installs = new ConnectorInstallations(join(root, 'managed'), bundle, store())
  const first = await installs.install()
  await mkdir(first.dataDirectory, { recursive: true })
  await writeFile(join(first.dataDirectory, 'journal'), 'receipts')
  await manifest('second')
  const next = await installs.install()
  expect(next.dataDirectory).toBe(first.dataDirectory)
  expect(next.runtime.executable).not.toBe(first.runtime.executable)
  const separate = await installs.install(true)
  expect(separate.dataDirectory).not.toBe(first.dataDirectory)
  await expect(
    import('node:fs/promises').then(({ readFile }) =>
      readFile(join(first.dataDirectory, 'journal'), 'utf8'),
    ),
  ).resolves.toBe('receipts')
})

it('offline admission keeps real local service controls without claiming another owner', async () => {
  const { ApiError } = await import('../../src/main/api/client')
  const { connector, options } = fixture()
  options.admission.mockRejectedValue(new ApiError('transport_unknown'))
  const state = await connector.state('character')
  expect(state).toMatchObject({
    available: true,
    service: { running: true },
    admission: { matched: null, connected: false, problem: 'transport_unknown' },
  })
  await expect(connector.connect({ characterId: 'character', label: 'PC' })).rejects.toHaveProperty(
    'code',
    'transport_unknown',
  )
  expect(options.authorize).not.toHaveBeenCalled()
})

it('actual launch ignores a same-name executable in an empty-PATH working directory', async () => {
  const { spawn } = await import('node:child_process')
  const root = await mkdtemp(join(tmpdir(), 'connector-cwd-'))
  temporary.push(root)
  await writeFile(
    join(root, process.platform === 'win32' ? 'yuki-agent-connector.exe' : 'yuki-agent-connector'),
    'This unrelated CWD file must never execute',
  )
  const output = await runConnector(
    {
      executable: process.execPath,
      arguments: [
        '-e',
        'process.stdin.resume(); process.stdin.on("end",()=>process.stdout.write("selected-absolute-runtime"))',
        '--',
      ],
    },
    ['pair', '--code-stdin'],
    'synthetic-code\n',
    (command, args, options) =>
      spawn(command, args, {
        ...options,
        cwd: root,
        env: { ...options.env, PATH: '', ELECTRON_RUN_AS_NODE: '1' },
      }),
  )
  expect(output).toBe('selected-absolute-runtime')
})

it('imports the actual pre-upgrade CLI status without requiring newly added fields', async () => {
  const old = {
    paired: true,
    device_id: 'original-device',
    instances: publicStatus.instances,
    service: publicStatus.service,
  }
  const run = vi.fn(async (_runtime: unknown, args: readonly string[]) =>
    args.includes('--version') ? '0.3.0\n' : JSON.stringify(old),
  )
  const { connector } = fixture(run)
  const value = await connector.useInstallation({
    executable: runtime.executable,
    dataDirectory: join(tmpdir(), 'legacy-original-data'),
  })
  expect(value).toMatchObject({
    available: true,
    paired: true,
    version: '0.3.0',
    deviceId: 'original-device',
    runtime: runtime.executable,
  })
  expect(run.mock.calls.map((call) => call[1])).toContainEqual(['--version'])
  expect(run.mock.calls.some((call) => call[1].includes('pair'))).toBe(false)
})

it('explicit adoption re-registers only the original service and preserves its data and identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-adopt-'))
  temporary.push(root)
  const bundle = join(root, 'bundle'),
    data = join(root, 'original-data')
  await mkdir(bundle)
  await mkdir(data)
  await writeFile(join(data, 'journal.sqlite3'), 'original durable receipts')
  await writeFile(join(bundle, 'python.exe'), 'new runtime bytes')
  await writeFile(
    join(bundle, 'manifest.json'),
    JSON.stringify({
      version: '0.3.1',
      protocol: 3,
      platform: process.platform,
      arch: process.arch,
      executable: 'python.exe',
      arguments: ['-I', '-m', 'yuki_agent_connector'],
      files: [
        {
          path: 'python.exe',
          sha256: createHash('sha256').update('new runtime bytes').digest('hex'),
        },
      ],
    }),
  )
  const calls: { executable: string; args: readonly string[] }[] = []
  const options = {
    root: join(root, 'managed'),
    bundledRuntime: bundle,
    store: store(),
    authorize: vi.fn(),
    admission: vi.fn(),
  }
  const connector = new AgentConnector(options, async (selected, args) => {
    calls.push({ executable: selected.executable, args })
    return args.includes('status') ? JSON.stringify(publicStatus) : 'ok'
  })
  connector.installations.select({ managed: false, dataDirectory: data, runtime })
  await expect(connector.install()).rejects.toHaveProperty(
    'code',
    'connector_external_installation',
  )
  calls.length = 0
  const result = await connector.adopt()
  expect(result).toMatchObject({ managed: true, deviceId: 'original-device', dataDirectory: data })
  expect(
    calls.filter((call) => call.args.includes('service')).map((call) => call.args.at(-1)),
  ).toEqual(['stop', 'install', 'start'])
  expect(calls.every((call) => call.args[1] === data)).toBe(true)
  expect(
    calls
      .filter((call) => call.args.includes('service'))
      .every((call) => call.executable !== runtime.executable),
  ).toBe(true)
  expect(options.authorize).not.toHaveBeenCalled()
  const { readFile } = await import('node:fs/promises')
  expect(await readFile(join(data, 'journal.sqlite3'), 'utf8')).toBe('original durable receipts')
})
