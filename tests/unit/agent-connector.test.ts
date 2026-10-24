import { PassThrough } from 'node:stream'
import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentConnector, runConnector } from '../../src/main/agent-connector'
import { ConnectorInstallations } from '../../src/main/connector-installation'
import { ApiError } from '../../src/main/api/client'
import type { ConnectorServiceAction } from '../../src/shared/connector'

const runtime = {
  directory: tmpdir(),
  executable: join(tmpdir(), 'python.exe'),
  arguments: ['-B', '-m', 'yuki_agent_connector'],
  version: '0.3.2',
  protocol: 3,
  build: 'original',
}
const publicStatus = {
  version: '0.3.2',
  protocol: 3,
  runtime: runtime.executable,
  paired: true,
  server: 'https://yuki.example',
  device_id: 'original-device',
  instances: [{ id: 'original-profile', label: 'Home Codex', driver: 'codex' }],
  service: { installed: true, running: true, executable: runtime.executable },
}
const temporary: string[] = []
const actualBundle =
  process.env.YUKI_CONNECTOR_COMPAT_RUNTIME ?? join(process.cwd(), '.cache', 'connector-runtime')
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
it.each([undefined, 2, 4])(
  'protocol information remains diagnostic and never replaces an existing grant (server: %s)',
  async (serverProtocol) => {
    const { connector, options } = fixture()
    options.admission.mockImplementation(async () => ({
      matched: true,
      connected: false,
      serverProtocol,
    }))
    expect(await connector.connect({ characterId: 'character', label: 'PC' })).toMatchObject({
      paired: true,
      admission: { matched: true, connected: false },
    })
    expect(options.authorize).not.toHaveBeenCalled()
  },
)
it('first connection prepares its runtime and pairs only the explicitly selected role', async () => {
  let paired = false
  const run = vi.fn(async (_runtime: unknown, args: readonly string[], input?: string) => {
    if (args.includes('status')) return JSON.stringify({ ...publicStatus, paired })
    expect(args).toContain('pair')
    expect(input).toBe('private-code\n')
    paired = true
    return 'paired'
  })
  const options = {
    root: join(tmpdir(), 'unused-root'),
    bundledRuntime: join(tmpdir(), 'not-bundled'),
    store: store(),
    authorize: vi.fn(async () => ({ server: 'https://yuki.example', code: 'private-code' })),
    admission: vi.fn(async () => ({ matched: true, connected: false })),
  }
  const connector = new AgentConnector(options, run)
  const install = vi.spyOn(connector.installations, 'install').mockImplementation(async () => {
    const installation = {
      managed: true,
      dataDirectory: join(tmpdir(), 'new-data'),
      runtime,
    }
    connector.installations.select(installation)
    return installation
  })
  expect(
    await connector.connect({ characterId: 'selected-role', label: 'My computer' }),
  ).toMatchObject({
    available: true,
    paired: true,
    admission: { matched: true, connected: false },
  })
  expect(install).toHaveBeenCalledOnce()
  expect(options.authorize).toHaveBeenCalledExactlyOnceWith('selected-role')
  expect(run.mock.calls.find((call) => call[1].includes('pair'))?.[1]).toEqual([
    '--data-dir',
    join(tmpdir(), 'new-data'),
    'pair',
    '--url',
    'https://yuki.example',
    '--label',
    'My computer',
    '--code-stdin',
  ])
  await connector.connect({ characterId: 'selected-role', label: 'Another label' })
  expect(options.authorize).toHaveBeenCalledOnce()
  expect(run.mock.calls.filter((call) => call[1].includes('pair'))).toHaveLength(1)
})
it('configuration returns the real saved instance ID without inferring an identity from its path', async () => {
  const run = vi.fn(async (_runtime: unknown, args: readonly string[]) => {
    if (args.includes('configure')) return JSON.stringify({ instance_id: 'original-profile' })
    return JSON.stringify(publicStatus)
  })
  const { connector } = fixture(run)
  expect(await connector.configure({ id: 'original-profile', label: 'Same Codex' })).toMatchObject({
    instanceId: 'original-profile',
  })
  expect(run.mock.calls.some((call) => call[1].includes('service'))).toBe(false)
})
it.skipIf(!existsSync(join(actualBundle, 'manifest.json')))(
  'actual standalone CLI keeps the preallocated creation ID through partial failure, human/JSON output and later edits',
  async () => {
    const manifest = JSON.parse(await readFile(join(actualBundle, 'manifest.json'), 'utf8'))
    const root = await mkdtemp(join(tmpdir(), 'connector-cli-original-'))
    temporary.push(root)
    const command = join(root, 'native-codex.exe')
    await writeFile(command, 'Only a configuration target; never executed')
    await writeFile(
      join(root, 'config.json'),
      JSON.stringify({
        url: 'ws://127.0.0.1:9/agents/v1/connect',
        device_id: 'fixture-device',
        token: 'fixture-only',
        instances: [],
      }),
    )
    let fail = true
    const calls: string[][] = [],
      outputs: string[] = []
    const execute: typeof runConnector = async (selected, args, input) => {
      calls.push([...args])
      if (args.includes('configure') && fail) {
        fail = false
        throw new ApiError('connector_failed')
      }
      const output = await runConnector(selected, args, input)
      outputs.push(output)
      return output
    }
    const connector = new AgentConnector(
      {
        root: join(root, 'managed'),
        bundledRuntime: join(root, 'absent'),
        store: store(),
        authorize: vi.fn(),
        admission: vi.fn(),
      },
      execute,
    )
    connector.installations.select({
      managed: false,
      dataDirectory: root,
      runtime: {
        directory: actualBundle,
        executable: join(actualBundle, manifest.executable),
        arguments: manifest.arguments,
        version: manifest.version,
        protocol: manifest.protocol,
        build: 'actual-bundled-cli',
      },
    })
    const input = {
      id: 'created-instance',
      create: true,
      label: 'My native Codex',
      command,
      cwd: root,
    }
    await expect(connector.configure(input)).rejects.toMatchObject({
      code: 'connector_failed',
      reason: 'configure',
    })
    expect(
      JSON.parse(await readFile(join(root, 'config.json'), 'utf8')).instances.map(
        (item: { id: string }) => item.id,
      ),
    ).toEqual(['created-instance'])
    expect(await connector.configure(input)).toEqual({ instanceId: 'created-instance' })
    expect(
      await connector.configure({ ...input, create: false, label: 'Original Codex edited' }),
    ).toEqual({ instanceId: 'created-instance' })
    expect(calls.filter((args) => args.includes('add'))).toHaveLength(1)
    expect(outputs.some((output) => output.includes('Configuration updated'))).toBe(true)
    const before = await readFile(join(root, 'config.json'), 'utf8')
    await expect(
      connector.configure({ ...input, id: 'missing-original', create: false }),
    ).rejects.toHaveProperty('code', 'connector_instance_missing')
    expect(await readFile(join(root, 'config.json'), 'utf8')).toBe(before)
  },
  30000,
)
it('creation, configuration and background actions keep their original installation while discovery is pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-bound-'))
  temporary.push(root)
  const command = join(root, 'codex.exe')
  await writeFile(command, 'Not executed')
  const first = join(root, 'first'),
    second = join(root, 'second')
  let entered!: () => void, release!: () => void
  const discovering = new Promise<void>((resolve) => {
    entered = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const instances: { id: string; label: string; driver: string; command: string; cwd: string }[] =
    []
  const run = vi.fn(async (_runtime: unknown, args: readonly string[]) => {
    expect(args[1]).toBe(first)
    if (args.includes('status'))
      return JSON.stringify({
        ...publicStatus,
        instances,
        service: { installed: false, running: false },
      })
    if (args.includes('discover')) {
      entered()
      await released
      return JSON.stringify([{ id: 'actual-installation', label: 'Codex', command }])
    }
    if (args.includes('add'))
      instances.push({
        id: 'original-created-id',
        label: 'Codex',
        driver: 'codex',
        command,
        cwd: root,
      })
    return 'Configuration updated; human output'
  })
  const { connector } = fixture(run)
  connector.installations.select({ managed: false, dataDirectory: first, runtime })
  const pending = connector.configure(
    {
      id: 'original-created-id',
      create: true,
      candidateId: 'actual-installation',
      cwd: root,
      label: 'Codex',
    },
    true,
  )
  await discovering
  connector.installations.select({ managed: false, dataDirectory: second, runtime })
  release()
  expect(await pending).toEqual({ instanceId: 'original-created-id' })
  expect(
    run.mock.calls.filter((call) => call[1].includes('service')).map((call) => call[1].slice(-2)),
  ).toEqual([
    ['service', 'install'],
    ['service', 'start'],
  ])
  expect(connector.installations.selected()!.dataDirectory).toBe(second)
})
it('upgrades a cached managed runtime before configuring once under the original namespace and instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-cached-'))
  temporary.push(root)
  const bundle = join(root, 'bundle'),
    directory = join(root, 'original-data')
  await mkdir(bundle)
  await mkdir(directory)
  await writeFile(join(directory, 'config.json'), 'original identity')
  await writeFile(join(directory, 'journal.sqlite3'), 'original receipts')
  await writeFile(join(bundle, 'python.exe'), 'new-runtime')
  await writeFile(
    join(bundle, 'manifest.json'),
    JSON.stringify({
      version: '0.3.2',
      protocol: 3,
      platform: process.platform,
      arch: process.arch,
      executable: 'python.exe',
      arguments: ['-m', 'yuki_agent_connector'],
      files: [
        { path: 'python.exe', sha256: createHash('sha256').update('new-runtime').digest('hex') },
      ],
    }),
  )
  const oldExecutable = join(root, 'old-python.exe')
  const run = vi.fn(
    async (selected: Parameters<typeof runConnector>[0], args: readonly string[]) => {
      expect(args[1]).toBe(directory)
      if (args.includes('status'))
        return JSON.stringify({
          ...publicStatus,
          version: selected.executable === oldExecutable ? '0.3.1' : '0.3.2',
        })
      expect(selected.executable).not.toBe(oldExecutable)
      if (args.includes('configure')) return JSON.stringify({ instance_id: 'original-profile' })
      return 'service updated'
    },
  )
  const authorize = vi.fn(),
    connector = new AgentConnector(
      {
        root: join(root, 'managed'),
        bundledRuntime: bundle,
        store: store(),
        authorize,
        admission: vi.fn(),
      },
      run,
    )
  connector.installations.select({
    managed: true,
    dataDirectory: directory,
    runtime: { ...runtime, version: '0.3.1', executable: oldExecutable },
  })
  expect(await connector.configure({ id: 'original-profile', label: 'Same Codex' })).toEqual({
    instanceId: 'original-profile',
  })
  expect(run.mock.calls.filter((call) => call[1].includes('configure'))).toHaveLength(1)
  expect(
    run.mock.calls.filter((call) => call[1].includes('service')).map((call) => call[1].slice(-2)),
  ).toEqual([
    ['service', 'stop'],
    ['service', 'install'],
    ['service', 'start'],
  ])
  expect(connector.installations.selected()!.dataDirectory).toBe(directory)
  expect(await readFile(join(directory, 'config.json'), 'utf8')).toBe('original identity')
  expect(await readFile(join(directory, 'journal.sqlite3'), 'utf8')).toBe('original receipts')
  expect(authorize).not.toHaveBeenCalled()
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
it('a failed service action reports its concrete stage without replacing the selected installation', async () => {
  const run = vi.fn(async () => {
    throw new ApiError('connector_failed')
  })
  const { connector } = fixture(run)
  await expect(connector.service('start')).rejects.toMatchObject({
    code: 'connector_failed',
    reason: 'service-start',
  })
  expect(connector.installations.selected()!.dataDirectory).toBe(join(tmpdir(), 'original-data'))
})
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
it('a prepared original installation does not replace another selection confirmed while preparation was pending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-selection-'))
  temporary.push(root)
  const bundle = join(root, 'bundle')
  await mkdir(bundle)
  await writeFile(join(bundle, 'python.exe'), 'prepared-runtime')
  const installations = new ConnectorInstallations(join(root, 'managed'), bundle, store())
  const original = { managed: true, dataDirectory: join(root, 'original'), runtime }
  const other = { managed: false, dataDirectory: join(root, 'other'), runtime }
  installations.select(original)
  let entered!: () => void, release!: () => void
  const preparing = new Promise<void>((resolve) => {
    entered = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.spyOn(installations, 'manifest').mockImplementation(async () => {
    entered()
    await released
    return {
      version: '0.3.2',
      protocol: 3,
      platform: process.platform,
      arch: process.arch,
      executable: 'python.exe',
      arguments: ['-m', 'yuki_agent_connector'],
      files: [
        {
          path: 'python.exe',
          sha256: createHash('sha256').update('prepared-runtime').digest('hex'),
        },
      ],
    }
  })
  const pending = installations.install()
  await preparing
  installations.select(other)
  release()
  expect((await pending).dataDirectory).toBe(original.dataDirectory)
  expect(installations.selected()).toEqual(other)
})
it('an older external-installation probe does not replace a selection confirmed during that probe', async () => {
  let entered!: () => void, release!: () => void
  const probing = new Promise<void>((resolve) => {
    entered = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const candidate = join(tmpdir(), 'pending-external'),
    other = join(tmpdir(), 'confirmed-other')
  const run = vi.fn(async (_runtime: unknown, args: readonly string[]) => {
    if (args[1] === candidate) {
      entered()
      await released
    }
    return JSON.stringify(publicStatus)
  })
  const { connector } = fixture(run)
  const pending = connector.useInstallation({
    executable: runtime.executable,
    dataDirectory: candidate,
  })
  await probing
  const confirmed = { managed: false, dataDirectory: other, runtime }
  connector.installations.select(confirmed)
  release()
  expect(await pending).toMatchObject({ dataDirectory: other })
  expect(connector.installations.selected()).toEqual(confirmed)
})
it('a separate installation leaves the other role configuration, journal and running service untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-separate-'))
  temporary.push(root)
  const bundle = join(root, 'bundle'),
    original = join(root, 'original-data')
  await mkdir(bundle)
  await mkdir(original)
  await writeFile(join(bundle, 'python.exe'), 'runtime')
  await writeFile(
    join(bundle, 'manifest.json'),
    JSON.stringify({
      version: '0.3.1',
      protocol: 3,
      platform: process.platform,
      arch: process.arch,
      executable: 'python.exe',
      arguments: ['-m', 'yuki_agent_connector'],
      files: [{ path: 'python.exe', sha256: createHash('sha256').update('runtime').digest('hex') }],
    }),
  )
  const originals = {
    'config.json': 'original role identity',
    'journal.sqlite3': 'original receipts',
    'service.xml': 'original running service',
  }
  for (const [file, content] of Object.entries(originals))
    await writeFile(join(original, file), content)
  const run = vi.fn(async (_runtime: unknown, args: readonly string[]) => {
    expect(args).toContain('status')
    expect(args[1]).not.toBe(original)
    return JSON.stringify({
      ...publicStatus,
      paired: false,
      service: { installed: false, running: false },
    })
  })
  const connector = new AgentConnector(
    {
      root: join(root, 'managed'),
      bundledRuntime: bundle,
      store: store(),
      authorize: vi.fn(),
      admission: vi.fn(),
    },
    run,
  )
  connector.installations.select({ managed: true, dataDirectory: original, runtime })
  expect(await connector.install(true)).toMatchObject({
    paired: false,
    service: { installed: false, running: false },
  })
  expect(connector.installations.selected()!.dataDirectory).not.toBe(original)
  for (const [file, content] of Object.entries(originals))
    expect(await readFile(join(original, file), 'utf8')).toBe(content)
  expect(run.mock.calls.some((call) => call[1].includes('service'))).toBe(false)
})

it('reveals only the native executable saved in the selected installation without launching it', async () => {
  const executable = join(tmpdir(), 'actual-codex.exe')
  const run = vi.fn(async () =>
    JSON.stringify({
      ...publicStatus,
      instances: [{ ...publicStatus.instances[0], command: executable }],
    }),
  )
  const { connector } = fixture(run)
  expect(await connector.nativeExecutable('original-profile')).toBe(executable)
  await expect(connector.nativeExecutable('another-instance')).rejects.toHaveProperty(
    'code',
    'native_not_installed',
  )
  expect(run.mock.calls).toHaveLength(2)
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
