import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExecutorInstallation } from '../../src/main/executor/installation'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const owner = {
  characterId: 'role-a',
  personId: 'person-a',
  bindingId: 'entry-a',
  conversationId: 'conversation-a',
}
function credentials() {
  const values = new Map<string, string>()
  return {
    get: (key: string) => values.get(key),
    set(key: string, value: string) {
      values.set(key, value)
      return true
    },
    remove(key: string) {
      values.delete(key)
    },
    canPersist: () => true,
  }
}
async function scope() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yuki-executor-vault-')))
  roots.push(root)
  return root
}
it('keeps the native selection and token in credential storage and exposes only aliases', async () => {
  const vault = new ExecutorInstallation(credentials(), owner),
    root = await scope()
  vault.install('original-executor', 'private-executor-token')
  const chosen = await vault.choose(root, '收件匣')
  vault.consent([{ capability: 'folder.read', scope: chosen }])
  expect(vault.current()!.scopes[0]!.realpath).toBe(root)
  const view = JSON.stringify(vault.publicState())
  expect(view).toContain('收件匣')
  expect(view).not.toContain(root)
  expect(view).not.toContain('private-executor-token')
  await mkdir(join(root, 'another'))
  await expect(vault.choose(join(root, 'another'), '收件匣')).rejects.toThrow(
    'scope_alias_conflict',
  )
})
it('intersects current server grants with consent given on this computer', async () => {
  const vault = new ExecutorInstallation(credentials(), owner)
  vault.install('executor-a', 'token-a')
  const chosen = await vault.choose(await scope(), 'Inbox')
  vault.consent([{ capability: 'folder.read', scope: chosen }])
  const remote = [
    { capability: 'folder.read', scope: chosen },
    { capability: 'folder.write', scope: chosen },
    { capability: 'open.url' },
  ]
  expect(vault.authority(remote).grants).toEqual([{ capability: 'folder.read', scope: chosen }])
  expect(vault.authority([]).grants).toEqual([])
  vault.consent(remote)
  expect(vault.authority(remote).grants).toEqual(remote)
  vault.removeScope(chosen.digest)
  expect(vault.authority(remote).grants).toEqual([{ capability: 'open.url' }])
  expect(vault.current()!.scopes).toEqual([])
})
it('restores the same executor after a cold instance and isolates each role and original entry', async () => {
  const secretStore = credentials(),
    first = new ExecutorInstallation(secretStore, owner)
  first.install('executor-a', 'token-a')
  const chosen = await first.choose(await scope(), 'Inbox')
  first.consent([{ capability: 'folder.write', scope: chosen }])
  first.pause(true)
  const restored = new ExecutorInstallation(secretStore, owner)
  expect(restored.current()).toEqual(first.current())
  const other = new ExecutorInstallation(secretStore, { ...owner, characterId: 'role-b' })
  expect(other.current()).toBeUndefined()
  other.install('executor-b', 'token-b')
  expect(other.current()!.consents).toEqual([])
  other.remove()
  expect(restored.current()!.token).toBe('token-a')
  const anotherEntry = new ExecutorInstallation(secretStore, { ...owner, bindingId: 'entry-b' })
  expect(anotherEntry.current()).toBeUndefined()
  expect(() => restored.install('executor-b', 'token-b')).toThrow('executor_already_installed')
})

it('matches the optional sha256 prefix without changing physical consent or expanding it', async () => {
  const vault = new ExecutorInstallation(credentials(), owner)
  vault.install('executor-a', 'token-a')
  const selected = await vault.choose(await scope(), 'Inbox')
  vault.consent([{ capability: 'folder.read', scope: selected }])
  const grant = {
    capability: 'folder.read',
    scope: { ...selected, digest: `sha256:${selected.digest}` },
  }
  expect(vault.authority([grant]).grants).toEqual([grant])
  expect(vault.authority([{ ...grant, capability: 'folder.write' }]).grants).toEqual([])
  vault.removeScope(grant.scope.digest)
  expect(vault.current()!.scopes).toEqual([])
})
