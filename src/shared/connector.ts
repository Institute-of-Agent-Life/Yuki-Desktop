import type { ApiReply } from './api'

export type ConnectorServiceAction = 'install' | 'start' | 'stop' | 'uninstall'

export type ConnectorState =
  | { available: false }
  | {
      available: true
      paired: boolean
      deviceId?: string
      instances: { id: string; label: string; driver: string }[]
      service: { installed: boolean; running: boolean | null }
    }

export interface ConnectorPairing {
  server: string
  label: string
  code: string
}

export interface ConnectorBridge {
  state(): Promise<ApiReply<ConnectorState>>
  pair(input: ConnectorPairing): Promise<ApiReply<ConnectorState>>
  service(action: ConnectorServiceAction): Promise<ApiReply<ConnectorState>>
}
