import type { ApiReply, OutboxItem } from './api'
import type { components } from './contract.gen'

export type ConnectorServiceAction = 'start' | 'stop'
export type ConnectorDriver = 'codex' | 'claude' | 'acp'
export interface ConnectorInstance {
  id: string
  label: string
  driver: string
  command?: string
  cwd?: string
  args?: string[]
}
export interface ConnectorAdmission {
  matched: boolean | null
  connected: boolean
  serverProtocol?: number
  problem?: string
  instances?: {
    id: string
    localId?: string
    label?: string | null
    driver?: string | null
    online: boolean
    status?: string | null
    errorType?: string | null
  }[]
}
/** Connection state reported by the Connector's own stdout state lines (0.4.4+). */
export type ConnectorLink =
  'connected' | 'disconnected' | 'authorization_lost' | 'protocol_unsupported'
/** Who may give input on this computer: `owner` means Yuki is stopped (「停止」). */
export type ConnectorHolder = 'owner' | 'none'
/** The Connector's own control line; Desktop keeps the last one in memory only. */
export interface ConnectorControl {
  holder: ConnectorHolder
  since: string
  /** `start`, `desktop` (「停止」/「繼續」) or `resume` (asked in chat). */
  reason: string
}
export type ConnectorActivityTool = 'computer' | 'browser'
export type ConnectorPermission = 'screen' | 'input'
/** Desktop's supervision of the Connector child process it owns. */
export interface ConnectorSupervision {
  link?: ConnectorLink
  reason?: string
  /** Reported by 3a Connectors; older ones print no control, activity or permission lines. */
  control?: ConnectorControl
  /** From an activity `start` until 10 s after the last `end`, while the child runs.
   * `background`: one window operated without the owner's cursor (Connector 0.6.0+). */
  activity?: { tool: ConnectorActivityTool; background: boolean }
  /** macOS screen-recording and accessibility preflight results. */
  permissions?: Record<ConnectorPermission, boolean>
  /** Automatic restarts since the last explicit start. */
  restarts: number
  restartPending: boolean
  lastExit?: { code: number | null; signal: string | null; at: string }
}
export type ConnectorState =
  | {
      available: false
      bundled?: boolean
      existing?: {
        installation: { executable: string; dataDirectory: string }
        state: ConnectorAvailableState
      }
    }
  | ConnectorAvailableState
export interface ConnectorAvailableState {
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
  bundledVersion?: string
  catalogProblem?: string
  fullAccess?: boolean
  computer?: {
    platform: string
    shell: string | null
  }
  instances: ConnectorInstance[]
  running: boolean | null
  supervision?: ConnectorSupervision
  admission?: ConnectorAdmission
}
export interface ConnectorCandidate {
  id: string
  label: string
  command: string
  driver: ConnectorDriver
}
export interface ConnectorConfiguration {
  id?: string
  create?: boolean
  candidateId?: string
  command?: string
  label?: string
  cwd?: string
  driver?: ConnectorDriver
  args?: string[]
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
export type ConnectorTerminal = components['schemas']['TerminalRun']
export type ConnectorTerminalControl = components['schemas']['TerminalControl']
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
  server(input: { characterId: string; server: string }): Promise<ApiReply<ConnectorState>>
  service(action: ConnectorServiceAction): Promise<ApiReply<ConnectorState>>
  control(holder: ConnectorHolder, characterId?: string): Promise<ApiReply<ConnectorState>>
  permissionSettings(permission: ConnectorPermission): Promise<ApiReply<void>>
  fullAccess(enabled: boolean, characterId?: string): Promise<ApiReply<ConnectorState>>
  discover(driver?: ConnectorDriver): Promise<ApiReply<ConnectorCandidate[]>>
  configure(
    input: ConnectorConfiguration,
    characterId?: string,
  ): Promise<ApiReply<{ instanceId: string; catalogProblem?: string }>>
  remove(
    instanceId: string,
    characterId?: string,
  ): Promise<ApiReply<{ instanceId: string; catalogProblem?: string }>>
  diagnose(instanceId: string): Promise<ApiReply<ConnectorDiagnostic>>
  exportDiagnostics(): Promise<ApiReply<boolean>>
  revealNative(instanceId: string): Promise<ApiReply<void>>
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
    deviceId?: string,
  ): Promise<ApiReply<{ operations: ConnectorOperation[]; next_cursor?: string | null }>>
  operation(
    characterId: string,
    operationId: string,
    cursor?: number,
  ): Promise<ApiReply<ConnectorOperation>>
  terminals(
    characterId: string,
    deviceId: string,
    cursor?: string,
  ): Promise<ApiReply<{ terminals: ConnectorTerminal[]; next_cursor?: string | null }>>
  terminal(
    characterId: string,
    runId: string,
    cursor?: number,
  ): Promise<ApiReply<ConnectorTerminal>>
  controlTerminal(
    characterId: string,
    runId: string,
    requestId: string,
    action: 'cancel',
  ): Promise<ApiReply<ConnectorTerminalControl>>
  terminalControl(
    characterId: string,
    runId: string,
    requestId: string,
  ): Promise<ApiReply<ConnectorTerminalControl>>
  submit(
    characterId: string,
    input: { text: string; agentTarget: ConnectorTarget },
  ): Promise<ApiReply<ConnectorSubmission>>
}
