import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import ssh2, { type Client, type ConnectConfig } from 'ssh2'
import { parsePairing } from '../shared/pairing'
import type { SshTarget } from '../shared/ssh'
import { ApiError } from './api/client'

/** OpenSSH's `SHA256:` form, the one `ssh-keygen -lf` prints on the server. */
export const fingerprint = (key: Buffer) =>
  'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
export const secretKey = (target: SshTarget) => `ssh/${target.user}@${target.host}:${target.port}`
export const hostKey = (host: string, port: number) => `${host}:${port}`
/** POSIX single quoting: the value reaches the remote shell as one literal word. */
export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`

function failure(error: Error & { level?: string; code?: string }) {
  if (error.level === 'client-authentication') return new ApiError('ssh_authentication_failed')
  if (
    error.level === 'client-timeout' ||
    ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'].includes(
      error.code ?? '',
    )
  )
    return new ApiError('ssh_unreachable')
  return new ApiError('ssh_failed', error.message)
}

/** The host's key, before anything is sent to it: no login is attempted. */
export function probe(host: string, port: number) {
  return new Promise<string>((resolve, reject) => {
    const client = new ssh2.Client()
    let seen: string | undefined
    client.on('error', (error) => {
      client.end()
      if (seen) resolve(seen)
      else reject(failure(error))
    })
    client.connect({
      host,
      port,
      username: '',
      readyTimeout: 20000,
      hostVerifier: (key: Buffer) => {
        seen = fingerprint(key)
        return false
      },
    })
  })
}

/** Log in, accepting only the host key this desktop trusts for the host. */
export async function open(target: SshTarget, trusted: string | undefined, secret?: string) {
  const config: ConnectConfig = {
    host: target.host,
    port: target.port,
    username: target.user,
    readyTimeout: 20000,
    // A path that silently went away (sleep, another network) is noticed within ~15 s.
    keepaliveInterval: 5000,
    keepaliveCountMax: 3,
  }
  if (target.auth.kind === 'password') config.password = secret
  else if (target.auth.kind === 'key') {
    config.privateKey = await readFile(target.auth.path)
    if (secret) config.passphrase = secret
  } else
    config.agent =
      process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK
  return new Promise<Client>((resolve, reject) => {
    const client = new ssh2.Client()
    let presented: string | undefined
    config.hostVerifier = (key: Buffer) => {
      presented = fingerprint(key)
      return presented === trusted
    }
    client.once('ready', () => resolve(client))
    client.once('error', (error) => {
      client.end()
      reject(
        presented !== undefined && presented !== trusted
          ? new ApiError(trusted ? 'ssh_host_key_changed' : 'ssh_host_key_unknown')
          : failure(error),
      )
    })
    // The host can also hang up mid-login without any error, and ssh2 then drops its ready
    // timeout too: the path went away.
    client.once('close', () => reject(new ApiError('ssh_unreachable')))
    client.connect(config)
  })
}

export interface Output {
  stdout: string
  stderr: string
  code: number
}
export function run(client: Client, command: string, input?: string | Readable) {
  return new Promise<Output>((resolve, reject) => {
    client.exec(command, (error, channel) => {
      if (error) return reject(failure(error))
      let stdout = '',
        stderr = ''
      channel.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
      channel.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
      channel.on('close', (code: number | null) => resolve({ stdout, stderr, code: code ?? 1 }))
      if (typeof input === 'object') input.pipe(channel)
      else channel.end(input)
    })
  })
}
/** The last lines of a failed command, as the server printed them. */
export const tail = (output: Output) =>
  (output.stderr.trim() || output.stdout.trim()).split('\n').slice(-30).join('\n')

/** A logged-in account on the server, and how it reaches Docker. */
export class RemoteHost {
  private constructor(
    readonly client: Client,
    readonly home: string,
    /** '' for root, `sudo -n ` for a user with passwordless sudo. */
    readonly sudo: string,
  ) {}
  /** Learn who logged in; root or passwordless sudo is required to reach Docker. */
  static async identify(client: Client) {
    try {
      const facts = parse(await run(client, IDENTIFY))
      const sudo = facts.uid === '0' ? '' : facts.sudo === 'yes' ? 'sudo -n ' : undefined
      if (sudo === undefined) throw new ApiError('remote_sudo_password_required')
      return new RemoteHost(client, facts.home!, sudo)
    } catch (error) {
      client.end()
      throw error
    }
  }
  /** `~` and `~/…` are the login user's home on the server. */
  directory(value: string) {
    const trimmed = value.trim()
    return trimmed === '~'
      ? this.home
      : trimmed.startsWith('~/')
        ? `${this.home}/${trimmed.slice(2)}`
        : trimmed
  }
  run(command: string, input?: string | Readable) {
    return run(this.client, command, input)
  }
  async upload(local: string, remote: string, mode = '') {
    const result = await this.run(
      `mkdir -p ${quote(remote.slice(0, remote.lastIndexOf('/')))} && ${mode}cat > ${quote(remote)}`,
      createReadStream(local),
    )
    if (result.code !== 0) throw new ApiError('remote_upload_failed', tail(result))
  }
  /** The Bot's port on the server's loopback, from the deployment's own .env. */
  async port(directory: string) {
    const result = await this.run(
      `${this.sudo}test -f ${quote(directory + '/.env')} && ${this.sudo}sed -n 's/^YUKI_PORT=//p' ${quote(directory + '/.env')} | tail -n 1`,
    )
    if (result.code !== 0) throw new ApiError('remote_deployment_not_found')
    return Number(result.stdout.trim() || 8080)
  }
  /** A new one-time owner code from the deployment's own pair.sh. */
  async pairingCode(directory: string) {
    const result = await this.run(`cd ${quote(directory)} && ${this.sudo}sh deploy/pair.sh`)
    const code = result.code === 0 ? parsePairing(result.stdout)?.code : undefined
    if (!code) throw new ApiError('remote_pairing_failed', tail(result))
    return code
  }
  close() {
    this.client.end()
  }
}

const IDENTIFY = `printf 'uid=%s\\nhome=%s\\n' "$(id -u)" "$HOME"
[ "$(id -u)" = 0 ] || { sudo -n true >/dev/null 2>&1 && echo sudo=yes || echo sudo=no; }`
export const CHECK = `${IDENTIFY}
printf 'os=%s\\narch=%s\\n' "$(uname -s)" "$(uname -m)"
awk '/^MemTotal:/ {print "memory=" int($2 / 1024)}' /proc/meminfo
df -Pk "$HOME" | awk 'NR == 2 {print "disk=" int($4 / 1024)}'
command -v docker >/dev/null 2>&1 && echo docker=yes || echo docker=no`
export function parse(output: Output) {
  if (output.code !== 0) throw new ApiError('ssh_failed', tail(output))
  return Object.fromEntries(
    output.stdout
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
  ) as Record<string, string | undefined>
}
