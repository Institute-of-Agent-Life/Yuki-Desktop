import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const manifest = JSON.parse(readFileSync('contracts/source.json', 'utf8'))
if (!/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error('Missing fixed backend commit')
if (manifest.admin.commit !== manifest.commit || manifest.admin.repository !== manifest.repository)
  throw new Error('Client and admin contracts must use the same fixed backend source')
const root = mkdtempSync(join(tmpdir(), 'yuki-contract-'))
try {
  for (const [source, target] of [
    [manifest, 'contract.gen.ts'],
    [manifest.admin, 'admin-contract.gen.ts'],
  ]) {
    const path = join('contracts', source.file)
    const bytes = readFileSync(path)
    if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
      throw new Error(`Contract hash mismatch: ${source.file}`)
    const schema = JSON.parse(bytes)
    if (schema.info.version !== source.serverVersion)
      throw new Error(`Contract source version mismatch: ${source.file}`)
    if (
      source === manifest &&
      (!Number.isSafeInteger(manifest.apiRevision) ||
        schema.info['x-yuki-api-revision'] !== manifest.apiRevision)
    )
      throw new Error('Contract API revision mismatch')
    const output = join(root, target)
    const generated = spawnSync(
      process.execPath,
      ['node_modules/openapi-typescript/bin/cli.js', path, '-o', output],
      { stdio: 'inherit' },
    )
    if (generated.status !== 0) {
      process.exitCode = 1
      break
    }
    if (readFileSync(output, 'utf8') !== readFileSync(join('src/shared', target), 'utf8'))
      throw new Error(`Generated types are stale: ${target}; run npm run generate:contract`)
  }
  if (!process.exitCode)
    console.log(`Contracts and generated types match backend ${manifest.commit.slice(0, 12)}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
