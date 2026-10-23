import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
it.skipIf(process.platform !== 'win32')(
  'observes the actual key through a Windows 8.3 profile alias',
  async (context) => {
    const profile = realpathSync.native(await directory())
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:YUKI_WATCH_PROFILE).ShortPath',
      ],
      { env: { ...process.env, YUKI_WATCH_PROFILE: profile } },
    )
    const alias = stdout.trim()
    if (alias === profile) context.skip('The test volume does not provide 8.3 aliases.')
    await writeFile(
      join(profile, 'Local State.tmp'),
      JSON.stringify({ os_crypt: { encrypted_key: 'fixture-encrypted-key' } }),
    )
    const ready = windowsEncryptionKeyPersisted(alias)
    await rename(join(profile, 'Local State.tmp'), join(profile, 'Local State'))
    await ready
  },
)
