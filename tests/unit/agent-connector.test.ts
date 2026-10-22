import { PassThrough } from 'node:stream'
import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { AgentConnector, runConnector } from '../../src/main/agent-connector'
import type { ConnectorServiceAction } from '../../src/shared/connector'
import { ApiError } from '../../src/main/api/client'

const publicStatus = {
  paired: true,
  device_id: 'original-device',
  instances: [{ id: 'original-profile', label: 'Home Codex', driver: 'codex' }],
  service: { installed: true, running: true },
}

it('uses the same installed CLI and sends the one-time code through stdin without a shell', async () => {
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  })
  const launch = vi.fn(() => child as ChildProcessWithoutNullStreams)
  let input = ''
  child.stdin.on('data', (chunk) => (input += chunk.toString()))
  const args = [
    'pair',
    '--url',
    'https://yuki.example',
    '--label',
    'My $PC; & name',
    '--code-stdin',
  ]
  const result = runConnector(args, 'one-time-private-code\n', launch)
  child.stdout.write('paired')
  child.stderr.write('private diagnostic that must not become IPC output')
  child.emit('close', 0)
  expect(await result).toBe('paired')
  expect(input).toBe('one-time-private-code\n')
  expect(launch).toHaveBeenCalledWith('yuki-agent-connector', args, {
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  expect(args.join(' ')).not.toContain('one-time-private-code')
})

it('status returns only public fields and never starts or stops the service', async () => {
  const run = vi.fn(async () =>
    JSON.stringify({
      ...publicStatus,
      token: 'private-device-token',
      url: 'wss://private-host',
      instances: [
        {
          ...publicStatus.instances[0],
          env: { API_KEY: 'native-secret' },
          endpoint: 'private-owner',
        },
      ],
    }),
  )
  const connector = new AgentConnector(run)
  const state = await connector.state()
  expect(state).toEqual({
    available: true,
    paired: true,
    deviceId: 'original-device',
    instances: publicStatus.instances,
    service: publicStatus.service,
  })
  expect(JSON.stringify(state)).not.toMatch(/private|native-secret|API_KEY/)
  expect(run.mock.calls).toEqual([[['status', '--json']]])
})

it('pair uses the connector-owned identity and never starts a second runtime or returns credentials', async () => {
  const calls: { arguments: readonly string[]; input?: string }[] = []
  const connector = new AgentConnector(async (args, input) => {
    calls.push({ arguments: args, input })
    return args[0] === 'status' ? JSON.stringify(publicStatus) : 'saved private configuration'
  })
  expect(
    await connector.pair({
      server: 'https://yuki.example/',
      label: ' My computer ',
      code: ' one-time-code ',
    }),
  ).toMatchObject({ deviceId: 'original-device', available: true })
  expect(calls).toEqual([
    {
      arguments: [
        'pair',
        '--url',
        'https://yuki.example',
        '--label',
        'My computer',
        '--code-stdin',
      ],
      input: 'one-time-code\n',
    },
    { arguments: ['status', '--json'], input: undefined },
  ])
  expect(calls[0]?.arguments.join(' ')).not.toContain('one-time-code')
})

it.each(['install', 'start', 'stop', 'uninstall'] as const)(
  'explicit %s uses the same user service and then reads its actual state',
  async (action) => {
    const calls: string[][] = []
    const connector = new AgentConnector(async (args) => {
      calls.push([...args])
      return args[0] === 'status' ? JSON.stringify(publicStatus) : 'service result'
    })
    await connector.service(action)
    expect(calls).toEqual([
      ['service', action],
      ['status', '--json'],
    ])
  },
)

it('does not turn missing CLI, failed status, or unknown running state into false success', async () => {
  const missing = new AgentConnector(async () => {
    throw new ApiError('connector_not_installed')
  })
  expect(await missing.state()).toEqual({ available: false })
  const failure = new AgentConnector(async () => {
    throw new ApiError('connector_failed')
  })
  await expect(failure.state()).rejects.toHaveProperty('code', 'connector_failed')
  const unknown = new AgentConnector(async () =>
    JSON.stringify({ ...publicStatus, service: { installed: true, running: null } }),
  )
  expect(await unknown.state()).toMatchObject({ service: { installed: true, running: null } })
})

it('IPC cannot choose an arbitrary command or place multiple lines in a pairing code', async () => {
  const run = vi.fn(async () => JSON.stringify(publicStatus))
  const connector = new AgentConnector(run)
  await expect(connector.service('exec' as ConnectorServiceAction)).rejects.toHaveProperty(
    'code',
    'validation_error',
  )
  await expect(
    connector.pair({ server: 'https://yuki.example', label: 'computer', code: 'code\nextra' }),
  ).rejects.toHaveProperty('code', 'validation_error')
  expect(run).not.toHaveBeenCalled()
})
