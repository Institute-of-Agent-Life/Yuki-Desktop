import { createHash } from 'node:crypto'
import { connect, type Server as NetServer, type Socket } from 'node:net'
import ssh2, { type Connection, type Server } from 'ssh2'

const { utils } = ssh2

export interface ExecResult {
  stdout?: string
  stderr?: string
  code?: number
}
export interface ExecRecord {
  command: string
  input: Buffer
}

const fingerprintOf = (publicKey: string) => {
  const parsed = utils.parseKey(publicKey)
  if (parsed instanceof Error) throw parsed
  return (
    'SHA256:' +
    createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  )
}

/**
 * A real SSH protocol server standing in for the user's Linux server: password, public key and
 * agent authentication, exec channels and local forwards (direct-tcpip to this machine's
 * loopback). What the "server" answers to each command is the test's script.
 */
export async function sshHost(options: {
  user: string
  password?: string
  /** OpenSSH public key lines accepted for this user. */
  keys?: string[]
  exec(command: string, input: Buffer): ExecResult | Promise<ExecResult>
}) {
  let host = utils.generateKeyPairSync('ed25519')
  const execs: ExecRecord[] = [],
    forwards: number[] = [],
    clients = new Set<Connection>(),
    sockets = new Set<Socket>()
  const accepted = (options.keys ?? []).map((line) => {
    const key = utils.parseKey(line)
    if (key instanceof Error) throw key
    return key
  })
  let server: Server
  let port = 0
  const listen = () =>
    new Promise<void>((resolve) => {
      server = new ssh2.Server({ hostKeys: [host.private] }, (client) => {
        clients.add(client)
        client.on('close', () => clients.delete(client))
        client.on('error', () => {})
        client.on('authentication', (context) => {
          if (context.username !== options.user) return context.reject()
          if (
            context.method === 'password' &&
            options.password !== undefined &&
            context.password === options.password
          )
            return context.accept()
          if (context.method === 'publickey') {
            const key = accepted.find(
              (item) =>
                item.type === context.key.algo && item.getPublicSSH().equals(context.key.data),
            )
            if (
              key &&
              (!context.signature || key.verify(context.blob!, context.signature, context.hashAlgo))
            )
              return context.accept()
          }
          context.reject(['password', 'publickey'])
        })
        client.on('ready', () => {
          client.on('tcpip', (accept, _reject, info) => {
            forwards.push(info.destPort)
            const channel = accept(),
              socket = connect(info.destPort, '127.0.0.1')
            sockets.add(socket)
            socket.on('close', () => sockets.delete(socket))
            socket.on('error', () => channel.destroy())
            channel.on('error', () => socket.destroy())
            channel.pipe(socket).pipe(channel)
          })
          client.on('session', (accept) => {
            const session = accept()
            session.on('exec', (acceptExec, _reject, info) => {
              const channel = acceptExec(),
                chunks: Buffer[] = []
              channel.on('data', (chunk: Buffer) => chunks.push(chunk))
              channel.on('end', () => {
                const input = Buffer.concat(chunks)
                execs.push({ command: info.command, input })
                void Promise.resolve(options.exec(info.command, input)).then(
                  (result) => {
                    if (result.stdout) channel.write(result.stdout)
                    if (result.stderr) channel.stderr.write(result.stderr)
                    channel.exit(result.code ?? 0)
                    channel.end()
                  },
                  (error: unknown) => {
                    channel.stderr.write(String(error))
                    channel.exit(1)
                    channel.end()
                  },
                )
              })
            })
          })
        })
      })
      server.listen(port, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port
        resolve()
      })
    })
  await listen()
  return {
    get port() {
      return port
    },
    get fingerprint() {
      return fingerprintOf(host.public)
    },
    execs,
    forwards,
    /** The server was reinstalled: same address, a new host key. */
    async rotateKey() {
      await this.stop()
      host = utils.generateKeyPairSync('ed25519')
      await listen()
    },
    /** The network path went away: every session and forwarded connection is cut. */
    drop() {
      for (const socket of sockets) socket.destroy()
      for (const client of clients) client.end()
    },
    async stop() {
      this.drop()
      await new Promise<void>((resolve) => (server as unknown as NetServer).close(() => resolve()))
    },
    start: listen,
  }
}

/** Fill the shared SSH form the way a person does, up to the host fingerprint. */
export async function fillSsh(
  scope: import('@playwright/test').Page | import('@playwright/test').Locator,
  values: {
    address: string
    port: number
    password?: string
    key?: string
    directory?: string
  },
) {
  await scope.getByLabel('SSH 位址', { exact: true }).fill(values.address)
  await scope.getByLabel('SSH 連接埠', { exact: true }).fill(String(values.port))
  if (values.password !== undefined) {
    await scope.getByLabel('登入方式', { exact: true }).selectOption({ label: '密碼' })
    await scope.getByLabel('SSH 密碼', { exact: true }).fill(values.password)
  }
  if (values.key !== undefined) {
    await scope.getByLabel('登入方式', { exact: true }).selectOption({ label: '金鑰檔案' })
    await scope.getByLabel('金鑰檔案', { exact: true }).fill(values.key)
  }
  if (values.directory !== undefined)
    await scope.getByLabel('Yuki 部署目錄', { exact: true }).fill(values.directory)
}
