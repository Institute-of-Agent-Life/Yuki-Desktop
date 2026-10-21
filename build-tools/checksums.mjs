import { readFile, writeFile, mkdtemp, chmod, rm, access } from 'node:fs/promises'
import { join, basename, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { hashFile, artifactName } from './release-files.mjs'

const run = promisify(execFile)
export async function verifyChecksums(root) {
  const body = await readFile(join(root, 'SHA256SUMS'), 'utf8'),
    names = new Set()
  for (const line of body.trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64}) {2}([^\r\n]+)$/.exec(line)
    if (!match || basename(match[2]) !== match[2] || names.has(match[2]))
      throw Error('Invalid checksum manifest')
    names.add(match[2])
    if (match[1] !== (await hashFile(join(root, match[2]), 'sha256')))
      throw Error(`Checksum differs: ${match[2]}`)
  }
  return names
}
export async function signChecksums(root, fingerprint) {
  if (!/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(fingerprint))
    throw Error('Use the full approved GPG fingerprint')
  const names = await verifyChecksums(root),
    manifest = JSON.parse(await readFile(`${root}.local-audit.json`, 'utf8'))
  for (const arch of ['x64', 'arm64'])
    for (const ext of ['AppImage', 'deb', 'rpm'])
      if (!names.has(artifactName(manifest.version, 'linux', arch, ext)))
        throw Error(`Missing Linux target: ${arch}/${ext}`)
  for (const name of names)
    if (/^Yuki-.+-linux-(x64|arm64|x86_64|amd64|aarch64)\.(AppImage|deb|rpm)$/.test(name)) {
      const record = manifest.contentAudits?.find((item) => item.name === name)
      if (
        !record ||
        record.sha256 !== (await hashFile(join(root, name), 'sha256')) ||
        record.content?.file !== name ||
        !(record.content.archives > 0 || record.content.payloads > 0)
      )
        throw Error('Missing matching Linux content audit')
    }
  for (const name of ['SHA256SUMS.asc', 'SIGNING-PUBLIC-KEY.asc', 'SIGNING-KEY.txt']) {
    try {
      await access(join(root, name))
    } catch {
      continue
    }
    throw Error(`Signing output already exists: ${name}`)
  }
  const { stdout: key } = await run('gpg', [
    '--batch',
    '--armor',
    '--export-options',
    'export-minimal',
    '--export',
    fingerprint,
  ])
  if (!key.includes('BEGIN PGP PUBLIC KEY BLOCK')) throw Error('Public signing key unavailable')
  await run('gpg', [
    '--batch',
    '--local-user',
    fingerprint,
    '--armor',
    '--output',
    join(root, 'SHA256SUMS.asc'),
    '--detach-sign',
    join(root, 'SHA256SUMS'),
  ])
  await writeFile(join(root, 'SIGNING-PUBLIC-KEY.asc'), key, { flag: 'wx' })
  await writeFile(join(root, 'SIGNING-KEY.txt'), fingerprint.toUpperCase() + '\n', { flag: 'wx' })
  await verifySignature(root, fingerprint)
}
export async function verifySignature(root, approvedFingerprint) {
  if (!/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/.test(approvedFingerprint))
    throw Error('Pass the independently approved public fingerprint')
  await verifyChecksums(root)
  if (
    (await readFile(join(root, 'SIGNING-KEY.txt'), 'utf8')).trim() !==
    approvedFingerprint.toUpperCase()
  )
    throw Error('Published fingerprint differs from the approved fingerprint')
  const home = await mkdtemp(join(tmpdir(), 'yuki-gpg-verify-'))
  await chmod(home, 0o700)
  try {
    const env = { ...process.env, GNUPGHOME: home }
    await run('gpg', ['--batch', '--import', join(root, 'SIGNING-PUBLIC-KEY.asc')], { env })
    const { stdout } = await run(
      'gpg',
      [
        '--batch',
        '--status-fd',
        '1',
        '--verify',
        join(root, 'SHA256SUMS.asc'),
        join(root, 'SHA256SUMS'),
      ],
      { env },
    )
    const valid = stdout.split('\n').filter((line) => line.startsWith('[GNUPG:] VALIDSIG '))
    if (
      !valid.some((line) => {
        const parts = line.split(' ')
        return [parts[2], parts.at(-1)].includes(approvedFingerprint.toUpperCase())
      })
    )
      throw Error('Signature does not match the approved fingerprint')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, root, fingerprint] = process.argv.slice(2)
  if (!root || !fingerprint || !['sign', 'verify'].includes(action))
    throw Error('Usage: checksums.mjs sign|verify DIRECTORY APPROVED_FINGERPRINT')
  if (action === 'sign') await signChecksums(resolve(root), fingerprint)
  else await verifySignature(resolve(root), fingerprint)
  console.log(`${action}: checksum manifest and approved GPG fingerprint verified`)
}
