import type { ApiReply, Connection } from './api'
import type { LocalBotConfiguration, SandboxProfile } from './local-bot'
import type { ProviderPreset } from './models'

export type SshAuth = { kind: 'password' } | { kind: 'key'; path: string } | { kind: 'agent' }
/** Where and as whom to log in. The password or key passphrase lives in the keychain. */
export interface SshTarget {
  host: string
  port: number
  user: string
  auth: SshAuth
}
/**
 * How this desktop reaches a Yuki. SSH forwards the fixed local `localPort` to the server's
 * `127.0.0.1:remotePort`; the connection's baseUrl is `http://127.0.0.1:<localPort>`.
 */
export type Transport =
  | { kind: 'direct' }
  | (SshTarget & { kind: 'ssh'; directory: string; remotePort: number; localPort: number })
export type SshTransport = Extract<Transport, { kind: 'ssh' }>
/** A login for one request; `secret` is new keychain material (omitted: keep the saved one). */
export interface SshAccess {
  target: SshTarget
  secret?: string
  /** The host key the person confirmed for this host. */
  fingerprint: string
}
export interface SshProbe {
  fingerprint: string
  /** This desktop has trusted this key for this host before. */
  known: boolean
}
export type TransportChange =
  { kind: 'direct'; server: string } | { kind: 'ssh'; access: SshAccess; directory: string }
export interface SshBridge {
  probe(host: string, port: number): Promise<ApiReply<SshProbe>>
  forgetHost(host: string, port: number): Promise<ApiReply<void>>
  chooseKey(): Promise<ApiReply<string | null>>
  pair(input: {
    access: SshAccess
    directory: string
    label: string
  }): Promise<ApiReply<Connection>>
  changeTransport(
    characterId: string,
    change: TransportChange,
  ): Promise<ApiReply<{ connection: Connection; connectorProblem?: string }>>
  upgrade(characterId: string): Promise<ApiReply<void>>
  logs(characterId: string): Promise<ApiReply<string>>
}

export interface RemoteCheck {
  os: string
  arch: string
  memoryMiB: number
  diskMiB: number
  docker: boolean
  /** root, or a user with passwordless sudo; anything else cannot install. */
  privilege: 'root' | 'sudo' | 'password'
  /** The sandbox size install.sh would choose for this much memory. */
  recommended: SandboxProfile
}
export interface RemoteDeployState {
  bundled: boolean
  version?: string
}
export interface RemoteDeployInput {
  access: SshAccess
  directory: string
  label: string
  characterName: string
  personName: string
  sandboxProfile: SandboxProfile
  model: NonNullable<LocalBotConfiguration['model']>
}
export interface RemoteDeployBridge {
  state(): Promise<ApiReply<RemoteDeployState>>
  check(access: SshAccess): Promise<ApiReply<RemoteCheck>>
  installDocker(access: SshAccess, mirror: boolean): Promise<ApiReply<RemoteCheck>>
  prepare(access: SshAccess): Promise<ApiReply<ProviderPreset[]>>
  deploy(input: RemoteDeployInput): Promise<ApiReply<Connection>>
  onProgress(callback: (step: RemoteDeployStep) => void): () => void
}
export type RemoteDeployStep = 'upload' | 'install' | 'pair' | 'connect'
