import type { components } from './contract.gen'
export type ExecutorConfig = components['schemas']['ExecutorConfig']
export type ExecutorView = components['schemas']['ExecutorView']
export type ExecutorOperation = components['schemas']['ExecutorOperation']
export type ExecutorHistory = components['schemas']['OperationPage']
export type ExecutorGrant = components['schemas']['Grant']
export type ExecutorCreated = components['schemas']['ExecutorCreated']
export type ExecutorCommand =
  | { kind: 'create'; label: string; platform: string }
  | { kind: 'grants'; executorId: string; expectedRevision: number; grants: ExecutorGrant[] }
  | { kind: 'pause' | 'resume' | 'delete'; executorId: string }
export interface ExecutorCommandItem {
  requestId: string
  command: ExecutorCommand
  payloadHash: string
  state: 'submitted' | 'result'
  problem: string | null
  result: ExecutorConfig | Omit<ExecutorCreated, 'token'> | null
}
