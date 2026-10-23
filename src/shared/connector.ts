import type { ApiReply, OutboxItem } from './api'
import type { components } from './contract.gen'

export type ConnectorServiceAction = 'install' | 'start' | 'stop' | 'uninstall'
export interface ConnectorInstance {
  id: string
  label: string
  driver: string
  command?: string
  cwd?: string
}
export interface ConnectorAdmission {
  matched: boolean | null
  connected: boolean
  problem?: string
  instances?: { id: string; localId?: string; label: string; driver: string }[]
}
export type ConnectorState =
  | { available: false; bundled?: boolean }
  | {
      available: true
      managed?: boolean
      paired: boolean
      deviceId?: string
      server?: string
      version?: string
      protocol?: number
      runtime?: string
      dataDirectory?: string
      updateAvailable?: boolean
      instances: ConnectorInstance[]
      service: {
        installed: boolean
        running: boolean | null
        executable?: string
        arguments?: string[]
      }
      admission?: ConnectorAdmission
    }
export interface ConnectorCandidate {
  id: string
  label: string
  command: string
}
export interface ConnectorConfiguration {
  id?: string
  candidateId?: string
  command?: string
  label: string
  cwd: string
}
export interface ConnectorDiagnostic {
  id: string
  available: boolean
  problem?: string
}
export interface ConnectorPairing {
  server: string
  label: string
  code: string
}
export type ConnectorTarget = components['schemas']['AgentTarget']
export type ConnectorSubmission = Pick<OutboxItem, 'requestId' | 'state' | 'eventId' | 'problem'>
export interface ConnectorSession {
  id: string
  label?: string
  status?: string
  cwd?: string
}
export interface ConnectorOperation {
  id: string
  work_id?: string
  instance_id: string
  session_id?: string
  execution_id?: string
  status: string
  admitted?: boolean
  pending?: boolean
  uncertain?: boolean
  action?: string
  result?: Record<string, unknown> | null
  events?: components['schemas']['NativeEvent'][]
  next_cursor?: number
}
export interface ConnectorBridge {
  state(characterId?: string): Promise<ApiReply<ConnectorState>>
  install(separate?: boolean): Promise<ApiReply<ConnectorState>>
  adopt(): Promise<ApiReply<ConnectorState>>
  useInstallation(input: {
    executable: string
    dataDirectory: string
  }): Promise<ApiReply<ConnectorState>>
  connect(input: { characterId: string; label: string }): Promise<ApiReply<ConnectorState>>
  pair(input: ConnectorPairing): Promise<ApiReply<ConnectorState>>
  service(action: ConnectorServiceAction): Promise<ApiReply<ConnectorState>>
  discover(): Promise<ApiReply<ConnectorCandidate[]>>
  configure(input: ConnectorConfiguration): Promise<ApiReply<ConnectorState>>
  diagnose(instanceId: string): Promise<ApiReply<ConnectorDiagnostic>>
  chooseProject(): Promise<ApiReply<string | null>>
  chooseExecutable(): Promise<ApiReply<string | null>>
  sessions(
    characterId: string,
    instanceId: string,
    cursor?: string,
  ): Promise<ApiReply<{ sessions: ConnectorSession[]; next_cursor?: string | null }>>
  operations(
    characterId: string,
    workId?: string,
    cursor?: string,
  ): Promise<ApiReply<{ operations: ConnectorOperation[]; next_cursor?: string | null }>>
  operation(
    characterId: string,
    operationId: string,
    cursor?: number,
  ): Promise<ApiReply<ConnectorOperation>>
  submit(
    characterId: string,
    input: { text: string; agentTarget: ConnectorTarget },
  ): Promise<ApiReply<ConnectorSubmission>>
}
