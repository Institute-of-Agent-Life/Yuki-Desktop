import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { signChecksums, verifySignature } from '../../build-tools/checksums.mjs'
import { hashFile } from '../../build-tools/prepare-upload.mjs'

const run = promisify(execFile)
test('real GPG signs all six fixture targets, verifies the pinned public key and rejects changed bytes and signature', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yuki-gpg-fixture-')),
    home = join(root, 'keyring'),
    output = join(root, 'output')
  await mkdir(home)
  await chmod(home, 0o700)
  await mkdir(output)
  const previous = process.env.GNUPGHOME
  process.env.GNUPGHOME = home
  try {
    await run('gpg', [
      '--batch',
      '--pinentry-mode',
      'loopback',
      '--passphrase',
      '',
      '--quick-generate-key',
      'Yuki release test fixture <fixture@example.invalid>',
      'ed25519',
      'sign',
      '0',
    ])
    const { stdout } = await run('gpg', ['--batch', '--with-colons', '--list-secret-keys'])
    const fingerprint = stdout
      .split('\n')
      .find((line) => line.startsWith('fpr:'))
      .split(':')[9]
    const names = [],
      contentAudits = []
    for (const arch of ['x64', 'arm64'])
      for (const ext of ['AppImage', 'deb', 'rpm']) {
        const labels = {
          x64: { AppImage: 'x86_64', deb: 'amd64', rpm: 'x86_64' },
          arm64: { AppImage: 'arm64', deb: 'arm64', rpm: 'aarch64' },
        }
        const name = `Yuki-1.0.0-linux-${labels[arch][ext]}.${ext}`
        await writeFile(
          join(output, name),
          `Checksum/signature fixture ${arch}/${ext}; not an installer.`,
        )
        names.push(name)
        contentAudits.push({
          name,
          sha256: await hashFile(join(output, name), 'sha256'),
          content: { file: name, archives: 1 },
        })
      }
    // Format-only audit records above are fixtures; this test proves GPG, not native installer inspection.
    await writeFile(
      `${output}.local-audit.json`,
      JSON.stringify({ version: '1.0.0', contentAudits }),
    )
    await writeFile(
      join(output, 'SHA256SUMS'),
      (
        await Promise.all(
          names.map(async (name) => `${await hashFile(join(output, name), 'sha256')}  ${name}\n`),
        )
      ).join(''),
    )
    await signChecksums(output, fingerprint)
    await verifySignature(output, fingerprint)
    await assert.rejects(verifySignature(output, '0'.repeat(40)), /fingerprint differs/)
    const file = join(output, names[0]),
      bytes = await readFile(file)
    await writeFile(file, 'tampered content')
    await assert.rejects(verifySignature(output, fingerprint), /Checksum differs/)
    await writeFile(file, bytes)
    await writeFile(join(output, 'SHA256SUMS.asc'), 'not a valid detached signature')
    await assert.rejects(verifySignature(output, fingerprint))
  } finally {
    await run('gpgconf', ['--homedir', home, '--kill', 'gpg-agent']).catch(() => {})
    if (previous === undefined) delete process.env.GNUPGHOME
    else process.env.GNUPGHOME = previous
    await rm(root, { recursive: true, force: true })
  }
})
