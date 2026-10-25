import { realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { Credentials } from '../credentials'
import type { OutboxOwner } from '../../shared/api'
import { ApiError } from '../api/client'
import {
  scopeDigest,
  sameScopeDigest,
  type ExecutionAuthority,
  type LocalGrant,
  type LocalScope,
} from './effects'

interface Installation {
  executorId: string
  token: string
  scopes: LocalScope[]
  consents: LocalGrant[]
  localPaused: boolean
}
export class ExecutorInstallation {
  private readonly key: string
  constructor(
    private credentials: Pick<Credentials, 'get' | 'set' | 'remove' | 'canPersist'>,
    readonly owner: OutboxOwner,
  ) {
    this.key = `executor:${createHash('sha256').update(JSON.stringify(owner)).digest('hex')}`
  }
  current(): Installation | undefined {
    const raw = this.credentials.get(this.key)
    return raw ? (JSON.parse(raw) as Installation) : undefined
  }
  private save(value: Installation) {
    return this.credentials.set(this.key, JSON.stringify(value))
  }
  install(executorId: string, token: string) {
    const existing = this.current()
    if (existing && existing.executorId !== executorId)
      throw new ApiError('executor_already_installed')
    return this.save({
      executorId,
      token,
      scopes: existing?.scopes ?? [],
      consents: existing?.consents ?? [],
      localPaused: existing?.localPaused ?? false,
    })
  }
  publicState() {
    const current = this.current()
    if (!current) return null
    return {
      executorId: current.executorId,
      paused: current.localPaused,
      persistent: this.credentials.canPersist(),
      scopes: current.scopes.map(({ alias, digest }) => ({ alias, digest })),
      consents: current.consents,
    }
  }
  /** Only the native folder picker passes a physical path here, never renderer IPC. */
  async choose(path: string, alias: string) {
    const current = this.current()
    if (!current) throw new ApiError('executor_not_installed')
    if (!alias.trim()) throw new ApiError('validation_error')
    const root = await realpath(path)
    if (!(await stat(root)).isDirectory()) throw new ApiError('not_a_directory')
    const digest = scopeDigest(current.executorId, root)
    const existing = current.scopes.find((item) => item.alias === alias)
    if (existing && !sameScopeDigest(existing.digest, digest))
      throw new ApiError('scope_alias_conflict')
    if (!existing) current.scopes.push({ alias, realpath: root, digest })
    this.save(current)
    return { alias, digest }
  }
  consent(grants: LocalGrant[]) {
    const current = this.current()
    if (!current) throw new ApiError('executor_not_installed')
    for (const grant of grants)
      if (
        grant.scope &&
        !current.scopes.some(
          (scope) =>
            scope.alias === grant.scope!.alias &&
            sameScopeDigest(scope.digest, grant.scope!.digest),
        )
      )
        throw new ApiError('scope_unavailable')
    current.consents = grants.map((grant) => ({
      capability: grant.capability,
      ...(grant.scope ? { scope: { alias: grant.scope.alias, digest: grant.scope.digest } } : {}),
    }))
    this.save(current)
  }
  removeScope(digest: string) {
    const current = this.current()
    if (!current) throw new ApiError('executor_not_installed')
    current.scopes = current.scopes.filter((scope) => !sameScopeDigest(scope.digest, digest))
    current.consents = current.consents.filter(
      (grant) => !sameScopeDigest(grant.scope?.digest, digest),
    )
    this.save(current)
  }
  pause(paused: boolean) {
    const current = this.current()
    if (!current) throw new ApiError('executor_not_installed')
    current.localPaused = paused
    this.save(current)
  }
  authority(grants: LocalGrant[]): ExecutionAuthority {
    const current = this.current()
    if (!current) throw new ApiError('executor_not_installed')
    return {
      executorId: current.executorId,
      scopes: current.scopes,
      grants: grants.filter((grant) =>
        current.consents.some(
          (allowed) =>
            allowed.capability === grant.capability &&
            allowed.scope?.alias === grant.scope?.alias &&
            sameScopeDigest(allowed.scope?.digest, grant.scope?.digest),
        ),
      ),
    }
  }
  remove() {
    this.credentials.remove(this.key)
  }
}
