import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
vi.mock('electron', () => ({ safeStorage: {} }))
import { windowsEncryptionKeyPersisted } from '../../src/main/credentials'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'yuki-credential-key-'))
  roots.push(root)
  return root
}
it('waits for the actual Chromium key file and observes its atomic rename, without an elapsed-time gate', async () => {
  const root = await directory()
  let completed = false
  const ready = windowsEncryptionKeyPersisted(root).then(() => {
    completed = true
  })
  await writeFile(join(root, 'unrelated.json'), '{}')
  await writeFile(join(root, 'Local State.empty'), '{}')
  await rename(join(root, 'Local State.empty'), join(root, 'Local State'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(completed).toBe(false)
  await writeFile(
    join(root, 'Local State.tmp'),
    JSON.stringify({ os_crypt: { encrypted_key: 'fixture-encrypted-key' } }),
  )
  await rename(join(root, 'Local State.tmp'), join(root, 'Local State'))
  await ready
  expect(completed).toBe(true)
})
it('accepts an already persisted key and reports invalid state instead of claiming storage succeeded', async () => {
  const root = await directory()
  await writeFile(
    join(root, 'Local State'),
    JSON.stringify({ os_crypt: { encrypted_key: 'fixture-encrypted-key' } }),
  )
  await windowsEncryptionKeyPersisted(root)
  await writeFile(join(root, 'Local State'), 'invalid JSON')
  await expect(windowsEncryptionKeyPersisted(root)).rejects.toBeInstanceOf(SyntaxError)
})
