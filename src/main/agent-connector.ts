import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { ConnectorPairing, ConnectorServiceAction, ConnectorState } from '../shared/connector'
import { ApiError, normalizeServer } from './api/client'

type Launch = (
  command: string,
  args: readonly string[],
  options: { shell: false; windowsHide: true; stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams

export type ConnectorRunner = (args: readonly string[], input?: string) => Promise<string>

export function runConnector(
  args: readonly string[],
  input?: string,
  launch: Launch = spawn,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = launch('yuki-agent-connector', args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    // CLI diagnostics can contain private native paths. Only status's public projection leaves main.
    child.stderr.resume()
    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(new ApiError(error.code === 'ENOENT' ? 'connector_not_installed' : 'connector_failed'))
    })
    child.once('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new ApiError('connector_failed'))
    })
    child.stdin.on('error', () => reject(new ApiError('connector_failed')))
    child.stdin.end(input)
  })
}

export class AgentConnector {
  constructor(private readonly run: ConnectorRunner = runConnector) {}

  async state(): Promise<ConnectorState> {
    let output: string
    try {
      output = await this.run(['status', '--json'])
    } catch (error) {
      if (error instanceof ApiError && error.code === 'connector_not_installed')
        return { available: false }
      throw error
    }
    const state = JSON.parse(output)
    if (
      typeof state.paired !== 'boolean' ||
      !Array.isArray(state.instances) ||
      typeof state.service?.installed !== 'boolean' ||
      ![true, false, null].includes(state.service.running)
    )
      throw new ApiError('connector_invalid_response')
    // Whitelist the CLI's public status, never forward config/token/environment to renderer.
    return {
      available: true,
      paired: state.paired,
      ...(typeof state.device_id === 'string' ? { deviceId: state.device_id } : {}),
      instances: state.instances.map((instance: Record<string, unknown>) => {
        if (
          typeof instance.id !== 'string' ||
          typeof instance.label !== 'string' ||
          typeof instance.driver !== 'string'
        )
          throw new ApiError('connector_invalid_response')
        return { id: instance.id, label: instance.label, driver: instance.driver }
      }),
      service: { installed: state.service.installed, running: state.service.running },
    }
  }

  async pair(input: ConnectorPairing): Promise<ConnectorState> {
    if (
      typeof input.label !== 'string' ||
      !input.label.trim() ||
      typeof input.code !== 'string' ||
      !input.code.trim() ||
      /[\r\n]/.test(input.code)
    )
      throw new ApiError('validation_error')
    const server = normalizeServer(input.server)
    await this.run(
      ['pair', '--url', server, '--label', input.label.trim(), '--code-stdin'],
      `${input.code.trim()}\n`,
    )
    return this.state()
  }

  async service(action: ConnectorServiceAction): Promise<ConnectorState> {
    if (!['install', 'start', 'stop', 'uninstall'].includes(action))
      throw new ApiError('validation_error')
    await this.run(['service', action])
    return this.state()
  }
}
