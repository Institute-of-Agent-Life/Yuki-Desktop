import { PassThrough } from 'node:stream'
import { ChildProcess, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  chmod,
  realpath,
  symlink,
  unlink,
} from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { afterEach, expect, it, onTestFailed, vi } from 'vitest'
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
const reader = {
  ...runtime,
  executable: join(tmpdir(), 'bundled-python.exe'),
  version: '0.3.5',
  build: 'bundled-reader',
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
  vi.spyOn(connector.installations, 'bundled').mockResolvedValue(reader)
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
it('management reads require the bundled reader instead of falling back to the selected CLI', async () => {
  const { connector, run, options } = fixture()
  vi.mocked(connector.installations.bundled).mockResolvedValue(undefined)
  await expect(connector.state()).rejects.toHaveProperty('code', 'connector_runtime_unavailable')
  await expect(connector.discover()).rejects.toHaveProperty('code', 'connector_runtime_unavailable')
  options.store.set('agent-connector-installation', undefined)
  expect(await connector.state()).toEqual({ available: false, bundled: false })
  expect(run).not.toHaveBeenCalled()
})
it('a pending management read keeps the captured data and admission when another installation is selected', async () => {
  let entered!: () => void, release!: () => void
  const reading = new Promise<void>((resolve) => (entered = resolve))
  const released = new Promise<void>((resolve) => (release = resolve))
  const run = vi.fn(async (selected: unknown, args: readonly string[]) => {
    expect(selected).toBe(reader)
    expect(args[1]).toBe(join(tmpdir(), 'original-data'))
    entered()
    await released
    return JSON.stringify(publicStatus)
  })
  const { connector, options } = fixture(run)
  const original = connector.installations.selected()!
  const pending = connector.state('original-character')
  await reading
  const other = { ...original, dataDirectory: join(tmpdir(), 'other-owner-data') }
  connector.installations.select(other)
  release()
  expect(await pending).toMatchObject({
    dataDirectory: original.dataDirectory,
    deviceId: publicStatus.device_id,
  })
  expect(options.admission).toHaveBeenCalledExactlyOnceWith(
    'original-character',
    publicStatus.server,
    publicStatus.device_id,
  )
  expect(connector.installations.selected()).toEqual(other)
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
  vi.spyOn(connector.installations, 'bundled').mockResolvedValue(reader)
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
it.each([false, true])(
  'an unsupported write stays on the old runtime and reports its failure without updating it (managed=%s)',
  async (managed) => {
    const run = vi.fn(async (selected: unknown, args: readonly string[]) => {
      if (args.includes('status')) {
        expect(selected).toBe(reader)
        return JSON.stringify(publicStatus)
      }
      expect(selected).toBe(runtime)
      expect(args.slice(2)).toEqual(['instance', 'configure'])
      throw new ApiError('connector_failed')
    })
    const { connector } = fixture(run)
    connector.installations.select({ ...connector.installations.selected()!, managed })
    vi.spyOn(connector.installations, 'manifest').mockResolvedValue({
      version: reader.version,
      protocol: reader.protocol,
      platform: process.platform,
      arch: process.arch,
      executable: 'python.exe',
      arguments: reader.arguments,
      files: [],
    })
    const original = connector.installations.selected()
    await expect(
      connector.configure({ id: 'original-profile', label: 'Home Codex' }),
    ).rejects.toMatchObject({
      code: 'connector_failed',
      reason: 'configure',
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(connector.installations.selected()).toEqual(original)
  },
)
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
        bundledRuntime: actualBundle,
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
it.skipIf(!existsSync(join(actualBundle, 'manifest.json')))(
  'actual standalone CLI follows the original instance through a directory-alias upgrade and preserves its receipts',
  async () => {
    const started = performance.now()
    const phases: {
      phase: string
      startedMs: number
      elapsedMs?: number
      code?: number | null
    }[] = []
    onTestFailed(() => {
      console.error('Alias upgrade CLI phases', {
        elapsedMs: performance.now() - started,
        phases,
      })
    })
    const manifest = JSON.parse(await readFile(join(actualBundle, 'manifest.json'), 'utf8'))
    const root = await realpath(await mkdtemp(join(tmpdir(), 'connector-cli-upgrade-')))
    temporary.push(root)
    const firstVersion = join(root, 'version-one'),
      nextVersion = join(root, 'version-two'),
      bin = join(root, 'bin'),
      data = join(root, 'data'),
      project = join(root, 'project'),
      editedProject = join(root, 'edited-project')
    for (const directory of [firstVersion, nextVersion, data, project, editedProject])
      await mkdir(directory)
    const name = process.platform === 'win32' ? 'codex.exe' : 'codex'
    const oldExecutable = join(firstVersion, name),
      currentExecutable = join(nextVersion, name)
    for (const executable of [oldExecutable, currentExecutable]) {
      await writeFile(executable, 'Native configuration target only; never executed')
      await chmod(executable, 0o755)
    }
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(firstVersion, bin, linkType)
    const parentPath = process.env.PATH
    const launched: { executable: string; args: readonly string[] }[] = []
    const launch: NonNullable<Parameters<typeof runConnector>[3]> = (executable, args, options) => {
      launched.push({ executable, args })
      const phase: (typeof phases)[number] = {
        phase: args.includes('-c')
          ? 'journal'
          : args
              .filter((arg) => ['discover', 'status', 'instance', 'add', 'configure'].includes(arg))
              .join(' '),
        startedMs: performance.now() - started,
      }
      phases.push(phase)
      const child = spawn(executable, args, {
        ...options,
        env: { ...options.env, PATH: bin + delimiter + parentPath },
      })
      child.once('close', (code) => {
        phase.elapsedMs = performance.now() - started - phase.startedMs
        phase.code = code
      })
      return child
    }
    const execute: typeof runConnector = (selected, args, input) =>
      runConnector(selected, args, input, launch)
    const selected = {
      directory: actualBundle,
      executable: join(actualBundle, manifest.executable),
      arguments: manifest.arguments,
      version: manifest.version,
      protocol: manifest.protocol,
      build: 'actual-bundled-cli',
    }
    const connector = new AgentConnector(
      {
        root: join(root, 'managed'),
        bundledRuntime: actualBundle,
        store: store(),
        authorize: vi.fn(),
        admission: vi.fn(),
      },
      execute,
    )
    connector.installations.select({ managed: false, dataDirectory: data, runtime: selected })
    const identity = {
      url: 'ws://127.0.0.1:9/agents/v1/connect',
      device_id: 'original-upgrade-device',
      token: 'fixture-only',
      instances: [],
    }
    const configPath = join(data, 'config.json'),
      journalPath = join(data, 'journal.sqlite3')
    await writeFile(configPath, JSON.stringify(identity))
    const alias = join(bin, name)
    const candidate = (await connector.discover()).find((item) => item.command === alias)
    expect(candidate).toBeDefined()
    expect(await realpath(candidate!.command)).toBe(oldExecutable)
    const instanceId = 'original-upgrade-instance'
    await execute(selected, [
      '--data-dir',
      data,
      'instance',
      'add',
      '--id',
      instanceId,
      '--driver',
      'codex',
      '--label',
      'Original Codex',
      '--command',
      candidate!.command,
      '--cwd',
      project,
      '--env',
      'UPGRADE_FIXTURE=original-environment',
      '--endpoint',
      'ws://127.0.0.1:9/original-native-owner',
      '--agent-arg=--original-argument',
    ])
    expect(
      await connector.configure({
        id: instanceId,
        create: false,
        candidateId: candidate!.id,
        label: '原安裝',
        cwd: project,
      }),
    ).toEqual({ instanceId })
    const originalConfig = JSON.parse(await readFile(configPath, 'utf8'))
    expect(originalConfig.instances).toHaveLength(1)
    expect(originalConfig.instances[0].command).toBe(alias)
    expect(originalConfig.instances[0].installation).toBe(`path:${alias}`)
    await execute(
      {
        ...selected,
        arguments: [
          ...selected.arguments.slice(0, selected.arguments.indexOf('-m')),
          '-c',
          `import json,sys\nfrom pathlib import Path\nfrom yuki_agent_connector.config import Config\nfrom yuki_agent_connector.journal import Journal\nconfig=Config.load(Path(sys.argv[2]))\njournal=Journal(Path(sys.argv[1]),namespace=json.dumps([config.url,config.device_id]))\njournal.begin({'id':'original-journal-operation','action':'list'})\njournal.complete('original-journal-operation',{'type':'response','id':'original-journal-operation','result':{'status':'completed'}})\njournal.close()`,
        ],
      },
      [journalPath, configPath],
    )
    const configBytes = await readFile(configPath),
      journalBytes = await readFile(journalPath)
    expect(await realpath(bin)).toBe(firstVersion)
    await unlink(bin)
    await symlink(nextVersion, bin, linkType)
    await unlink(oldExecutable)
    expect(await realpath(bin)).toBe(nextVersion)
    expect(existsSync(oldExecutable)).toBe(false)
    const resolved = await connector.nativeExecutable(instanceId)
    expect(resolved).toBe(alias)
    expect(await realpath(resolved)).toBe(currentExecutable)
    expect(await readFile(configPath)).toEqual(configBytes)
    expect(await readFile(journalPath)).toEqual(journalBytes)
    expect(
      await connector.configure({
        id: instanceId,
        create: false,
        command: originalConfig.instances[0].command,
        label: '升級後的原安裝',
        cwd: editedProject,
      }),
    ).toEqual({ instanceId })
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      ...originalConfig,
      instances: [
        {
          ...originalConfig.instances[0],
          command: alias,
          label: '升級後的原安裝',
          cwd: editedProject,
        },
      ],
    })
    expect(
      await realpath(JSON.parse(await readFile(configPath, 'utf8')).instances[0].command),
    ).toBe(currentExecutable)
    expect(await readFile(journalPath)).toEqual(journalBytes)
    expect(process.env.PATH).toBe(parentPath)
    expect(launched.every((call) => call.executable === selected.executable)).toBe(true)
    expect(
      launched.some((call) => call.args.includes('service') || call.args.includes('diagnose')),
    ).toBe(false)
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
it('saving a managed instance keeps its running service and runtime while a bundled update is available', async () => {
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
      expect(selected.executable).toBe(oldExecutable)
      expect(args).toContain('configure')
      return JSON.stringify({ instance_id: 'original-profile' })
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
  const original = connector.installations.selected()
  const install = vi.spyOn(connector.installations, 'install')
  expect(await connector.state()).toMatchObject({
    managed: true,
    updateAvailable: true,
    service: { running: true },
  })
  expect(await connector.configure({ id: 'original-profile', label: 'Same Codex' })).toEqual({
    instanceId: 'original-profile',
  })
  expect(run.mock.calls.filter((call) => call[1].includes('configure'))).toHaveLength(1)
  expect(run.mock.calls.some((call) => call[1].includes('service'))).toBe(false)
  expect(install).not.toHaveBeenCalled()
  expect(connector.installations.selected()).toEqual(original)
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
    expect(run.mock.calls.map((call) => call[0])).toEqual([runtime, reader])
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
    if (args.includes('--version')) {
      entered()
      await released
      return '0.3.0\n'
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
  expect(await pending).toMatchObject({ dataDirectory: candidate })
  expect(run.mock.calls.at(-1)?.[1][1]).toBe(candidate)
  expect(connector.installations.selected()).toEqual(confirmed)
})
it('a failed management read cannot select an unverified external data directory', async () => {
  const run = vi.fn(async (selected: unknown, args: readonly string[]) => {
    if (args.includes('--version')) return '0.3.0\n'
    expect(selected).toBe(reader)
    throw new ApiError('connector_failed')
  })
  const { connector } = fixture(run)
  const original = connector.installations.selected()
  await expect(
    connector.useInstallation({
      executable: runtime.executable,
      dataDirectory: join(tmpdir(), 'unverified-external-data'),
    }),
  ).rejects.toHaveProperty('code', 'connector_failed')
  expect(connector.installations.selected()).toEqual(original)
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

it.each(['0.3.1', '0.3.3'])(
  'resolves the original %s installation through the bundled reader without upgrading it',
  async (version) => {
    const executable = join(tmpdir(), 'actual-codex.exe')
    const run = vi.fn(async (selected: unknown, args: readonly string[]) => {
      expect(selected).toBe(reader)
      expect(args.slice(2)).toEqual(['discover', '--instance', args[4], '--json'])
      if (args[4] !== 'original-profile') throw new ApiError('connector_instance_missing')
      return JSON.stringify({ instance_id: 'original-profile', command: executable })
    })
    const { connector } = fixture(run)
    connector.installations.select({
      ...connector.installations.selected()!,
      runtime: { ...runtime, version },
    })
    const installation = connector.installations.selected()
    expect(await connector.nativeExecutable('original-profile')).toBe(executable)
    await expect(connector.nativeExecutable('another-instance')).rejects.toHaveProperty(
      'code',
      'connector_instance_missing',
    )
    expect(run.mock.calls).toHaveLength(2)
    expect(connector.installations.selected()).toEqual(installation)
  },
)

it('resolves the original instance source after an upgrade without opening its stale command', async () => {
  const stale = join(tmpdir(), 'Codex-previous-version', 'codex.exe')
  const current = join(tmpdir(), 'Codex-current-version', 'codex.exe')
  const run = vi.fn(async (_runtime: unknown, args: readonly string[]) => {
    if (args.includes('status'))
      return JSON.stringify({
        ...publicStatus,
        version: '0.3.4',
        instances: [{ ...publicStatus.instances[0], command: stale }],
      })
    expect(args.slice(2)).toEqual(['discover', '--instance', 'original-profile', '--json'])
    return JSON.stringify({ instance_id: 'original-profile', command: current })
  })
  const { connector } = fixture(run)
  const installation = connector.installations.selected()
  expect(await connector.nativeExecutable('original-profile')).toBe(current)
  expect(run.mock.calls).toHaveLength(1)
  expect(connector.installations.selected()).toEqual(installation)
})

it('propagates a missing original installation instead of revealing the stale command', async () => {
  const run = vi.fn(async (_runtime: unknown, args: readonly string[]) => {
    if (args.includes('status'))
      return JSON.stringify({
        ...publicStatus,
        version: '0.3.4',
        instances: [{ ...publicStatus.instances[0], command: join(tmpdir(), 'old-codex.exe') }],
      })
    throw new ApiError('native_not_installed')
  })
  const { connector } = fixture(run)
  await expect(connector.nativeExecutable('original-profile')).rejects.toHaveProperty(
    'code',
    'native_not_installed',
  )
  expect(run.mock.calls).toHaveLength(1)
})

it('never reveals a resolved executable returned for another instance', async () => {
  const run = vi.fn(async (_runtime: unknown, args: readonly string[]) =>
    JSON.stringify(
      args.includes('status')
        ? {
            ...publicStatus,
            version: '0.3.4',
            instances: [{ ...publicStatus.instances[0], command: join(tmpdir(), 'old-codex.exe') }],
          }
        : { instance_id: 'another-instance', command: join(tmpdir(), 'other-codex.exe') },
    ),
  )
  const { connector } = fixture(run)
  await expect(connector.nativeExecutable('original-profile')).rejects.toHaveProperty(
    'code',
    'connector_instance_missing',
  )
})

it('keeps the original installation while its native executable read is pending', async () => {
  let entered!: () => void, release!: () => void
  const reading = new Promise<void>((resolve) => (entered = resolve))
  const released = new Promise<void>((resolve) => (release = resolve))
  const run = vi.fn(async (_runtime: unknown, args: readonly string[]) => {
    expect(args).toContain('discover')
    entered()
    await released
    return JSON.stringify({
      instance_id: 'original-profile',
      command: join(tmpdir(), 'original-current-codex.exe'),
    })
  })
  const { connector } = fixture(run)
  const first = connector.installations.selected()!
  const second = { ...first, dataDirectory: join(tmpdir(), 'other-data') }
  const pending = connector.nativeExecutable('original-profile')
  await reading
  connector.installations.select(second)
  release()
  expect(await pending).toBe(join(tmpdir(), 'original-current-codex.exe'))
  expect(run.mock.calls.map((call) => call[1][1])).toEqual([first.dataDirectory])
  expect(connector.installations.selected()).toEqual(second)
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

it('reads a pre-upgrade installation through the bundled reader and keeps the actual runtime identity', async () => {
  const old = {
    paired: true,
    device_id: 'original-device',
    instances: [{ id: 'original-profile', label: 'Home Codex', driver: 'codex' }],
    service: { installed: true, running: true },
  }
  const command = join(tmpdir(), 'original-native-codex.exe')
  const run = vi.fn(async (selected: unknown, args: readonly string[]) => {
    if (selected === reader)
      return JSON.stringify({
        ...publicStatus,
        version: reader.version,
        instances: [{ ...publicStatus.instances[0], command }],
      })
    return args.includes('--version') ? '0.3.0\n' : JSON.stringify(old)
  })
  const { connector, options } = fixture(run)
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
    protocol: undefined,
    server: publicStatus.server,
    instances: [{ ...publicStatus.instances[0], command }],
  })
  await connector.state('character')
  expect(options.admission).toHaveBeenCalledExactlyOnceWith(
    'character',
    publicStatus.server,
    'original-device',
  )
  expect(
    run.mock.calls.filter(([selected]) => selected !== reader).map(([, args]) => args),
  ).toEqual([['--version']])
  expect(run.mock.calls.map((call) => call[1])).toContainEqual(['--version'])
  expect(run.mock.calls.some((call) => call[1].includes('pair'))).toBe(false)
})

it.each([
  { action: 'install', running: true, selected: true },
  { action: 'install', running: false, selected: true },
  { action: 'adopt', running: true, selected: false },
  { action: 'adopt', running: false, selected: false },
] as const)(
  'explicit $action keeps the original data and service state (running=$running, selected=$selected)',
  async ({ action, running, selected }) => {
    const root = await mkdtemp(join(tmpdir(), 'connector-adopt-'))
    temporary.push(root)
    const bundle = join(root, 'bundle'),
      data = join(root, 'original-data')
    await mkdir(bundle)
    await mkdir(data)
    const originalExecutable = join(root, 'python.exe')
    await writeFile(originalExecutable, 'old runtime, never launched')
    const configuration = JSON.stringify({
      device_id: 'original-device',
      instances: [
        { id: 'original-profile', args: ['--original-owner'], env: { PROFILE: 'original' } },
      ],
    })
    await writeFile(join(data, 'config.json'), configuration)
    await writeFile(join(data, 'journal.sqlite3'), 'original durable receipts')
    await writeFile(join(bundle, 'python.exe'), 'new runtime bytes')
    await writeFile(
      join(bundle, 'manifest.json'),
      JSON.stringify({
        version: '0.3.5',
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
      if (args.includes('--version')) return '0.3.0\n'
      return args.includes('status')
        ? JSON.stringify({
            ...publicStatus,
            data_directory: data,
            service: { installed: true, running, executable: originalExecutable },
          })
        : 'ok'
    })
    if (selected) connector.installations.select({ managed: false, dataDirectory: data, runtime })
    const result = await connector[action]()
    expect(result).toMatchObject({
      managed: true,
      version: '0.3.5',
      deviceId: 'original-device',
      dataDirectory: data,
      service: { running },
    })
    expect(connector.installations.selected()).toMatchObject({ managed: true, dataDirectory: data })
    expect(
      calls.filter((call) => call.args.includes('service')).map((call) => call.args.at(-1)),
    ).toEqual(running ? ['stop', 'install', 'start'] : ['install'])
    expect(
      calls.filter((call) => call.args.includes('service')).every((call) => call.args[1] === data),
    ).toBe(true)
    expect(
      calls
        .filter((call) => call.args.includes('service'))
        .every((call) => call.executable !== runtime.executable),
    ).toBe(true)
    expect(options.authorize).not.toHaveBeenCalled()
    expect(calls.some((call) => call.args.includes('pair'))).toBe(false)
    expect(await readFile(join(data, 'config.json'), 'utf8')).toBe(configuration)
    expect(await readFile(join(data, 'journal.sqlite3'), 'utf8')).toBe('original durable receipts')
  },
)

it.each(['not JSON', '{"instances":[]}'])(
  'discovery reports an invalid local response without presenting an execution receipt (%s)',
  async (output) => {
    const { connector } = fixture(vi.fn(async () => output))
    await expect(connector.discover()).rejects.toMatchObject({
      code: 'connector_invalid_response',
      reason: 'discover',
    })
  },
)

it('a missing original Python is reported as an unavailable installation, without pairing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-missing-runtime-'))
  temporary.push(root)
  const { connector, options } = fixture(
    vi.fn(async () =>
      JSON.stringify({
        ...publicStatus,
        data_directory: root,
        service: { installed: true, running: false, executable: join(root, 'python.exe') },
      }),
    ),
  )
  options.store.set('agent-connector-installation', undefined)
  await expect(connector.state()).rejects.toMatchObject({
    code: 'connector_existing_runtime_unavailable',
  })
  expect(options.authorize).not.toHaveBeenCalled()
  expect(connector.installations.selected()).toBeUndefined()
})

it.each(['preview', 'use', 'connect'])(
  '%s of the default independent installation preserves its runtime, identity and receipts without pairing or service operations',
  async (action) => {
    const root = await mkdtemp(join(tmpdir(), 'connector-existing-'))
    temporary.push(root)
    const data = join(root, 'original-data'),
      legacy = join(root, 'original-runtime')
    await mkdir(data)
    await mkdir(legacy)
    const executable = join(legacy, 'python.exe')
    const native = {
      ...publicStatus.instances[0],
      command: join(legacy, 'original-codex.exe'),
      cwd: join(root, 'original-project'),
      env: { ORIGINAL_ENV: 'native-owner-value' },
      args: ['--original-argument'],
      socket: 'original-socket',
      endpoint: 'original-endpoint',
    }
    const config = JSON.stringify({ device_id: 'original-device', instances: [native] })
    await writeFile(executable, 'fixture, never launched')
    await writeFile(join(legacy, 'pythonw.exe'), 'fixture, never launched')
    await writeFile(join(data, 'config.json'), config)
    await writeFile(join(data, 'journal.sqlite3'), 'original operation receipts')
    const run = vi.fn(async (selected: unknown, args: readonly string[]) => {
      if (args.includes('--version')) {
        expect(selected).toMatchObject({ executable })
        return '0.3.0\n'
      }
      expect(selected).toBe(reader)
      expect(args).toContain('status')
      return JSON.stringify({
        ...publicStatus,
        version: reader.version,
        runtime: reader.executable,
        data_directory: data,
        instances: [native],
        service: { installed: true, running: true, executable: join(legacy, 'pythonw.exe') },
      })
    })
    const options = {
      root: join(root, 'desktop'),
      bundledRuntime: join(root, 'bundle'),
      store: store(),
      authorize: vi.fn(),
      admission: vi.fn(async () => ({ matched: true, connected: true })),
    }
    const connector = new AgentConnector(options, run)
    vi.spyOn(connector.installations, 'bundled').mockResolvedValue(reader)
    vi.spyOn(connector.installations, 'manifest').mockResolvedValue({
      version: reader.version,
      protocol: reader.protocol,
      platform: process.platform,
      arch: process.arch,
      executable: 'python.exe',
      arguments: reader.arguments,
      files: [],
    })
    const install = vi.spyOn(connector.installations, 'install')
    const preview = await connector.state('role')
    expect(preview).toMatchObject({
      available: false,
      existing: {
        installation: { executable, dataDirectory: data },
        state: {
          managed: false,
          version: '0.3.0',
          bundledVersion: '0.3.5',
          updateAvailable: true,
          protocol: undefined,
          deviceId: 'original-device',
          instances: [{ id: native.id, command: native.command, cwd: native.cwd }],
          admission: { matched: true, connected: true },
        },
      },
    })
    expect(connector.installations.selected()).toBeUndefined()
    expect(JSON.stringify(preview)).not.toMatch(
      /native-owner-value|original-argument|original-socket|original-endpoint/,
    )
    if (action !== 'preview') {
      const selected =
        action === 'use'
          ? await connector.useInstallation({ executable, dataDirectory: data })
          : await connector.connect({ characterId: 'role', label: 'PC' })
      expect(selected).toMatchObject({ available: true, managed: false, dataDirectory: data })
      expect(connector.installations.selected()).toMatchObject({
        managed: false,
        dataDirectory: data,
        runtime: { executable, version: '0.3.0' },
      })
    }
    expect(install).not.toHaveBeenCalled()
    expect(options.authorize).not.toHaveBeenCalled()
    expect(
      run.mock.calls.every(([, args]) => !args.includes('service') && !args.includes('pair')),
    ).toBe(true)
    expect(await readFile(join(data, 'config.json'), 'utf8')).toBe(config)
    expect(await readFile(join(data, 'journal.sqlite3'), 'utf8')).toBe(
      'original operation receipts',
    )
  },
)

it('connecting a discovered old installation keeps its original owner while another selection is confirmed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-connect-selection-'))
  temporary.push(root)
  const executable = join(root, 'python.exe')
  await writeFile(executable, 'fixture, never launched')
  let entered!: () => void, release!: () => void
  const reading = new Promise<void>((resolve) => (entered = resolve))
  const released = new Promise<void>((resolve) => (release = resolve))
  const run = vi.fn(async (selected: unknown, args: readonly string[]) => {
    if (args.includes('--version')) {
      expect(selected).toMatchObject({ executable })
      entered()
      await released
      return '0.3.0\n'
    }
    expect(selected).toBe(reader)
    expect(args).toEqual(['status', '--json'])
    return JSON.stringify({
      ...publicStatus,
      data_directory: root,
      service: { installed: true, running: true, executable },
    })
  })
  const { connector, options } = fixture(run)
  options.store.set('agent-connector-installation', undefined)
  const pending = connector.connect({ characterId: 'original-character', label: 'PC' })
  await reading
  const other = { managed: false, dataDirectory: join(tmpdir(), 'confirmed-other'), runtime }
  connector.installations.select(other)
  release()
  expect(await pending).toMatchObject({ dataDirectory: root, deviceId: publicStatus.device_id })
  expect(connector.installations.selected()).toEqual(other)
  expect(options.admission).toHaveBeenCalledExactlyOnceWith(
    'original-character',
    publicStatus.server,
    publicStatus.device_id,
  )
  expect(options.authorize).not.toHaveBeenCalled()
  expect(run.mock.calls.map(([, args]) => args)).toEqual([['status', '--json'], ['--version']])
})

it('an existing paired directory with an unknown service runtime cannot silently create another device', async () => {
  const run = vi.fn(async () =>
    JSON.stringify({ ...publicStatus, data_directory: tmpdir(), service: { installed: false } }),
  )
  const { connector, options } = fixture(run)
  options.store.set('agent-connector-installation', undefined)
  const install = vi.spyOn(connector.installations, 'install')
  await expect(connector.connect({ characterId: 'role', label: 'PC' })).rejects.toHaveProperty(
    'code',
    'connector_existing_runtime_unavailable',
  )
  expect(install).not.toHaveBeenCalled()
  expect(options.authorize).not.toHaveBeenCalled()
})

it('Claude discovery uses the bundled reader while leaving the original runtime selected', async () => {
  const run = vi.fn(async (selected: unknown, args: readonly string[]) => {
    expect(selected).toBe(reader)
    expect(args.slice(2)).toEqual(['discover', '--json', '--driver', 'claude'])
    return JSON.stringify([
      { id: 'claude-native', label: 'Claude Code', command: runtime.executable },
    ])
  })
  const { connector } = fixture(run)
  const original = connector.installations.selected()
  expect(await connector.discover('claude')).toEqual([
    { id: 'claude-native', label: 'Claude Code', command: runtime.executable, driver: 'claude' },
  ])
  expect(connector.installations.selected()).toEqual(original)
})

it('editing an original Claude instance preserves its driver without revalidating a missing default task directory', async () => {
  const run = vi.fn(async (_runtime: unknown, args: readonly string[], input?: string) => {
    if (args.includes('status'))
      return JSON.stringify({
        ...publicStatus,
        instances: [
          {
            id: 'claude',
            label: 'Claude',
            driver: 'claude',
            command: runtime.executable,
            cwd: join(tmpdir(), 'original-project-no-longer-exists'),
          },
        ],
      })
    expect(args).toContain('configure')
    expect(JSON.parse(input!)).toMatchObject({ id: 'claude', driver: 'claude' })
    expect(JSON.parse(input!)).not.toHaveProperty('cwd')
    return '{}'
  })
  const { connector } = fixture(run)
  expect(
    await connector.configure({ id: 'claude', driver: 'codex', label: 'Original Claude' }),
  ).toEqual({ instanceId: 'claude' })
  expect(run.mock.calls.some(([, args]) => args.includes('add'))).toBe(false)
})

it('ACP creation preserves argument values without shell splitting or another discovery pass', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-acp-arguments-'))
  temporary.push(root)
  const command = join(root, 'acp.exe')
  await writeFile(command, 'native configuration target, never launched')
  const args = ['--stdio', 'value with spaces', '--owner=original']
  const run = vi.fn(async (_runtime: unknown, commandArgs: readonly string[]) =>
    commandArgs.includes('status') ? JSON.stringify({ ...publicStatus, instances: [] }) : '{}',
  )
  const { connector } = fixture(run)
  const result = await connector.configure({
    command,
    label: 'ACP',
    driver: 'acp',
    args,
  })
  const add = run.mock.calls.find(([, commandArgs]) => commandArgs.includes('add'))!
  expect(add[1]).toEqual([
    '--data-dir',
    join(tmpdir(), 'original-data'),
    'instance',
    'add',
    '--id',
    result.instanceId,
    '--driver',
    'acp',
    '--label',
    'ACP',
    '--command',
    command,
    '--cwd',
    expect.any(String),
    ...args.map((value) => '--agent-arg=' + value),
  ])
  expect(
    run.mock.calls.some(
      ([, commandArgs]) => commandArgs.includes('discover') || commandArgs.includes('service'),
    ),
  ).toBe(false)
})

it('ACP parameter edits are explicit and do not replace the original driver or hidden owner settings', async () => {
  const run = vi.fn(async (_runtime: unknown, args: readonly string[], input?: string) => {
    if (args.includes('status'))
      return JSON.stringify({
        ...publicStatus,
        instances: [
          {
            id: 'original-acp',
            label: 'ACP',
            driver: 'acp',
            command: runtime.executable,
            args: ['--stdio'],
            env: { PRIVATE: 'owner' },
            socket: 'private-owner',
          },
        ],
      })
    expect(args).toContain('configure')
    const value = JSON.parse(input!)
    expect(value).toMatchObject({ id: 'original-acp', driver: 'acp' })
    expect(value).not.toHaveProperty('env')
    expect(value).not.toHaveProperty('socket')
    return '{}'
  })
  const { connector } = fixture(run)
  expect(await connector.state()).toMatchObject({ instances: [{ args: ['--stdio'] }] })
  await connector.configure({ id: 'original-acp', label: 'Renamed ACP' })
  const first = run.mock.calls.find(([, args]) => args.includes('configure'))!
  expect(JSON.parse(first[2]!)).not.toHaveProperty('args')
  await connector.configure({ id: 'original-acp', label: 'Renamed ACP', args: [] })
  const last = run.mock.calls.filter(([, args]) => args.includes('configure')).at(-1)!
  expect(JSON.parse(last[2]!)).toMatchObject({ args: [] })
})

it('a missing new executable reports a configuration error without starting a service or creating an instance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connector-missing-command-'))
  temporary.push(root)
  const run = vi.fn(async () => JSON.stringify({ ...publicStatus, instances: [] }))
  const { connector } = fixture(run)
  await expect(
    connector.configure({
      driver: 'acp',
      command: join(root, 'missing.exe'),
      label: 'ACP',
    }),
  ).rejects.toMatchObject({ code: 'validation_error', reason: 'configure' })
  expect(run).toHaveBeenCalledOnce()
})
