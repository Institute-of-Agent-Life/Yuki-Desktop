import { constants } from 'node:fs'
import {
  lstat,
  open,
  opendir,
  realpath,
  rename,
  link,
  unlink,
  type FileHandle,
} from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, win32 } from 'node:path'
import type { ExecutorEffects, ExecutorTask } from './runner'
import type { ExecutorResult } from './journal'

export interface LocalScope {
  alias: string
  realpath: string
  digest: string
}
export interface LocalGrant {
  capability: string
  scope?: { alias: string; digest: string } | null
}
export interface ExecutionAuthority {
  executorId: string
  grants: LocalGrant[]
  scopes: LocalScope[]
}
export interface NativeSubmissions {
  openURL(url: string): Promise<void>
  openFile(path: string): Promise<string>
  notify(title: string, body: string): Promise<boolean>
}
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
export const scopeDigest = (executorId: string, path: string) => sha256(`${executorId}:${path}`)
export const sameScopeDigest = (left: string | undefined, right: string | undefined) =>
  left?.replace(/^sha256:/, '') === right?.replace(/^sha256:/, '')
const inside = (root: string, path: string) => {
  const part = relative(root, path)
  return (
    !isAbsolute(part) &&
    part !== '..' &&
    !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  )
}
class Refusal extends Error {}
class ReadTooLarge extends Refusal {
  constructor(readonly size: number) {
    super('too_large')
  }
}
const failed = (reason: string): ExecutorResult => ({ state: 'failed', result: { reason } })
const text = (value: unknown) => {
  if (typeof value !== 'string') throw new Refusal('invalid_parameters')
  return value
}
function inline(value: unknown) {
  const encoded = text(value)
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw new Refusal('invalid_content')
  return Buffer.from(encoded, 'base64')
}
function reason(error: unknown) {
  if (error instanceof Refusal) return error.message
  switch ((error as NodeJS.ErrnoException)?.code) {
    case 'EACCES':
    case 'EPERM':
      return 'permission_denied'
    case 'EROFS':
      return 'read_only'
    case 'ENOENT':
      return 'not_found'
    case 'EEXIST':
      return 'already_exists'
    default:
      return 'io_error'
  }
}

/** All physical paths and native submissions stay in the main process. */
export class NativeExecutorEffects implements ExecutorEffects {
  constructor(
    private authority: () => Promise<ExecutionAuthority>,
    private native: NativeSubmissions,
    private content: (task: ExecutorTask) => Promise<Uint8Array>,
  ) {}
  private async authorized(task: ExecutorTask) {
    const authority = await this.authority()
    if (!authority.grants.some((grant) => grant.capability === task.capability))
      throw new Refusal('permission_denied')
    return authority
  }
  private async target(task: ExecutorTask, authority: ExecutionAuthority, writing = false) {
    const path = text(task.params.path)
    const grants = authority.grants
      .filter((grant) => grant.capability === task.capability && grant.scope)
      .sort((a, b) => b.scope!.alias.length - a.scope!.alias.length)
    const grant = grants.find(
      ({ scope }) => path === scope!.alias || path.startsWith(`${scope!.alias}/`),
    )
    if (!grant?.scope) throw new Refusal('scope_unavailable')
    const scope = authority.scopes.find(
      (item) =>
        item.alias === grant.scope!.alias &&
        sameScopeDigest(item.digest, grant.scope!.digest) &&
        scopeDigest(authority.executorId, item.realpath) === item.digest.replace(/^sha256:/, ''),
    )
    if (!scope || (await realpath(scope.realpath)) !== scope.realpath)
      throw new Refusal('scope_unavailable')
    const part = path.slice(grant.scope.alias.length).replace(/^\//, '')
    if (part.includes('\\') || isAbsolute(part) || win32.isAbsolute(part) || part.includes('\0'))
      throw new Refusal('path_outside_scope')
    const candidate = join(scope.realpath, part)
    if (!inside(scope.realpath, candidate)) throw new Refusal('path_outside_scope')
    let resolved: string
    try {
      resolved = await realpath(candidate)
    } catch (error) {
      if (!writing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = await realpath(dirname(candidate))
      if (!inside(scope.realpath, parent)) throw new Refusal('path_outside_scope')
      resolved = join(parent, basename(candidate))
    }
    if (!inside(scope.realpath, resolved)) throw new Refusal('path_outside_scope')
    // Publish to the selected path, never silently retarget a symlink's destination.
    if (writing && resolved !== candidate) throw new Refusal('path_is_symlink')
    return { path: resolved, root: scope.realpath }
  }
  private async intended(task: ExecutorTask) {
    const bytes = task.params.artifact_id
      ? Buffer.from(await this.content(task))
      : inline(task.params.content_base64)
    if (task.params.artifact_id && sha256(bytes) !== task.params.version)
      throw new Refusal('content_mismatch')
    return bytes
  }
  private async readFile(path: string) {
    if (!(await lstat(path)).isFile()) throw new Refusal('not_a_file')
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    )
    try {
      const info = await handle.stat()
      if (!info.isFile()) throw new Refusal('not_a_file')
      try {
        return { bytes: await handle.readFile(), info }
      } catch (error) {
        if (
          ['ERR_FS_FILE_TOO_LARGE', 'ERR_BUFFER_TOO_LARGE', 'EFBIG'].includes(
            (error as NodeJS.ErrnoException).code ?? '',
          )
        )
          throw new ReadTooLarge((await handle.stat()).size)
        throw error
      }
    } finally {
      await handle.close()
    }
  }
  async execute(task: ExecutorTask): Promise<ExecutorResult> {
    let issued = false
    try {
      const authority = await this.authorized(task)
      switch (task.capability) {
        case 'folder.read': {
          const target = await this.target(task, authority)
          if (task.params.mode === 'list') {
            const directory = await opendir(target.path),
              entries = []
            for await (const item of directory) {
              const info = await lstat(join(target.path, item.name))
              entries.push({
                name: item.name,
                kind: info.isDirectory()
                  ? 'directory'
                  : info.isSymbolicLink()
                    ? 'symlink'
                    : info.isFile()
                      ? 'file'
                      : 'other',
                size: info.size,
                mtime: info.mtime.toISOString(),
              })
            }
            entries.sort((a, b) => a.name.localeCompare(b.name))
            return { state: 'succeeded', level: 'confirmed', result: { entries } }
          }
          if (task.params.mode !== 'read') throw new Refusal('invalid_parameters')
          const { bytes } = await this.readFile(target.path)
          return {
            state: 'succeeded',
            level: 'confirmed',
            result: {
              sha256: sha256(bytes),
              size: bytes.length,
              content_base64: bytes.toString('base64'),
            },
          }
        }
        case 'folder.write': {
          const target = await this.target(task, authority, true)
          const bytes = await this.intended(task)
          let created = false
          try {
            if (!(await lstat(target.path)).isFile()) throw new Refusal('not_a_file')
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            created = true
          }
          if (task.params.if_absent !== undefined && typeof task.params.if_absent !== 'boolean')
            throw new Refusal('invalid_parameters')
          if (task.params.if_absent && !created) return failed('already_exists')
          const temporary = join(dirname(target.path), `.yuki-${randomUUID()}.tmp`)
          let handle: FileHandle | undefined
          try {
            handle = await open(temporary, 'wx', 0o600)
            await handle.writeFile(bytes)
            await handle.sync()
            await handle.close()
            handle = undefined
            const current = await this.target(task, authority, true)
            if (current.path !== target.path) throw new Refusal('path_changed')
            issued = true
            if (task.params.if_absent) await link(temporary, target.path)
            else await rename(temporary, target.path)
          } finally {
            await handle?.close().catch(() => {})
            await unlink(temporary).catch(() => {})
          }
          const readback = await this.readFile(target.path)
          if (sha256(readback.bytes) !== sha256(bytes) || readback.bytes.length !== bytes.length)
            return { state: 'unknown', result: {}, observation: await this.observe(task) }
          return {
            state: 'succeeded',
            level: 'confirmed',
            result: {
              sha256: sha256(readback.bytes),
              size: readback.bytes.length,
              created,
            },
          }
        }
        case 'open.url': {
          const url = new URL(text(task.params.url))
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Refusal('unsupported_url')
          issued = true
          await this.native.openURL(url.toString())
          break
        }
        case 'open.file': {
          const target = await this.target(task, authority)
          issued = true
          if (await this.native.openFile(target.path)) return failed('open_failed')
          break
        }
        case 'notify': {
          const title = text(task.params.title),
            body = text(task.params.body)
          issued = true
          if (!(await this.native.notify(title, body))) return failed('notification_failed')
          break
        }
        default:
          return failed('unsupported_capability')
      }
      return { state: 'succeeded', level: 'submitted', result: { submitted: true } }
    } catch (error) {
      if (
        task.capability === 'folder.write' &&
        task.params.if_absent === true &&
        (error as NodeJS.ErrnoException)?.code === 'EEXIST'
      )
        return failed('already_exists')
      if (issued) return { state: 'unknown', result: {}, observation: await this.observe(task) }
      if (error instanceof ReadTooLarge)
        return { state: 'failed', result: { reason: 'too_large', size: error.size } }
      return failed(reason(error))
    }
  }
  async observe(task: ExecutorTask): Promise<Record<string, unknown> | undefined> {
    if (task.capability !== 'folder.write') return
    try {
      const authority = await this.authorized(task)
      const target = await this.target(task, authority, true)
      try {
        const { bytes, info } = await this.readFile(target.path),
          digest = sha256(bytes)
        const intended = task.params.artifact_id
          ? text(task.params.version)
          : sha256(inline(task.params.content_base64))
        return {
          exists: true,
          sha256: digest,
          size: bytes.length,
          mtime: info.mtime.toISOString(),
          matches_intended: digest === intended,
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
        throw error
      }
    } catch {
      return
    }
  }
}
