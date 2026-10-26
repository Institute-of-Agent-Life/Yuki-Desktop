import type { ApiReply, Connection } from './api'

export interface LocalBotInstallation {
  directory: string
  address: string
  image: string
  port: number
  characterName: string
  personName: string
  personRequestId: string
  pairRequestId: string
  personId?: string
}
export interface LocalBotState {
  busy?: boolean
  docker: boolean
  bundled: boolean
  installation: LocalBotInstallation | null
  configured: boolean
  running: boolean
  problem?: string
}
export interface LocalBotConfiguration {
  directory: string
  port: number
  characterName: string
  personName: string
  model: {
    protocol: 'chat_completions' | 'responses' | 'anthropic_messages' | 'gemini'
    base_url: string
    api_key: string
    model: string
    provider?: string
  }
}
export interface LocalBotBridge {
  state(): Promise<ApiReply<LocalBotState>>
  chooseDirectory(): Promise<ApiReply<string | null>>
  deploy(configuration: LocalBotConfiguration): Promise<ApiReply<Connection>>
  start(): Promise<ApiReply<LocalBotState>>
  stop(): Promise<ApiReply<LocalBotState>>
  connect(): Promise<ApiReply<Connection>>
  onProgress(callback: (message: string) => void): () => void
}
