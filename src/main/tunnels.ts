import { createServer, type Server, type Socket } from 'node:net'
import type { Client } from 'ssh2'
import type { SshTransport } from '../shared/ssh'
import { ApiError } from './api/client'

/**
 * One fixed loopback port per SSH connection. Each local connection rides the current SSH
 * session; a session is opened on demand and dropped when it fails, so the next request after a
 * network change simply logs in again. Requests that hit a dead path fail as transport errors and
 * the API client's own offline handling retries them.
 */
class Tunnel {
  readonly listening: Promise<void>
  problem?: string
  /** It could not listen; the next use tries again. */
  failed = false
  private session?: Promise<Client>
  private readonly sockets = new Set<Socket>()
  private readonly server: Server
  constructor(
    readonly transport: SshTransport,
    private readonly login: (transport: SshTransport) => Promise<Client>,
    /** The previous tunnel on this port, still letting go of it. */
    previous: Promise<void>,
  ) {
    this.server = createServer((socket) => this.forward(socket))
    this.listening = previous.then(
      () =>
        new Promise((resolve, reject) => {
          this.server.once('error', (error: NodeJS.ErrnoException) =>
            reject(
              new ApiError(error.code === 'EADDRINUSE' ? 'ssh_local_port_in_use' : 'ssh_failed'),
            ),
          )
          this.server.listen(transport.localPort, '127.0.0.1', () => resolve())
        }),
    )
    this.listening.catch((error: ApiError) => {
      this.failed = true
      this.problem = error.code
    })
  }
  private client() {
    this.session ??= this.login(this.transport).then(
      (client) => {
        this.problem = undefined
        client.on('close', () => {
          if (this.session === current) this.session = undefined
          for (const socket of this.sockets) socket.destroy()
        })
        client.on('error', () => {})
        return client
      },
      (error: unknown) => {
        this.session = undefined
        this.problem = error instanceof ApiError ? error.code : 'ssh_failed'
        throw error
      },
    )
    const current = this.session
    return current
  }
  private forward(socket: Socket) {
    this.sockets.add(socket)
    socket.on('close', () => this.sockets.delete(socket))
    socket.on('error', () => {})
    socket.pause()
    this.client().then(
      (client) =>
        client.forwardOut(
          '127.0.0.1',
          0,
          '127.0.0.1',
          this.transport.remotePort,
          (error, channel) => {
            if (error) {
              socket.destroy()
              return
            }
            channel.on('error', () => socket.destroy())
            channel.on('close', () => socket.destroy())
            socket.on('close', () => channel.destroy())
            socket.pipe(channel).pipe(socket)
            socket.resume()
          },
        ),
      () => socket.destroy(),
    )
  }
  close() {
    for (const socket of this.sockets) socket.destroy()
    void this.session?.then(
      (client) => client.end(),
      () => {},
    )
    this.session = undefined
    return new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}

export class Tunnels {
  private readonly tunnels = new Map<number, Tunnel>()
  constructor(private readonly login: (transport: SshTransport) => Promise<Client>) {}
  /** Listen on the transport's local port; the same transport keeps its running tunnel. */
  ensure(transport: SshTransport) {
    const current = this.tunnels.get(transport.localPort)
    if (
      current &&
      !current.failed &&
      JSON.stringify(current.transport) === JSON.stringify(transport)
    )
      return current.listening
    const tunnel = new Tunnel(transport, this.login, current?.close() ?? Promise.resolve())
    this.tunnels.set(transport.localPort, tunnel)
    return tunnel.listening
  }
  problem(localPort: number) {
    return this.tunnels.get(localPort)?.problem
  }
  async close(localPort: number) {
    const tunnel = this.tunnels.get(localPort)
    this.tunnels.delete(localPort)
    await tunnel?.close()
  }
  async closeAll() {
    await Promise.all([...this.tunnels.keys()].map((port) => this.close(port)))
  }
}
