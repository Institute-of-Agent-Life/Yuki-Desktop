import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const manifest = JSON.parse(readFileSync('contracts/source.json', 'utf8'))
const source = readFileSync('contracts/client-api.openapi.json')
if (!/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error('Missing fixed backend commit')
if (createHash('sha256').update(source).digest('hex') !== manifest.sha256)
  throw new Error('Contract hash mismatch')
const schema = JSON.parse(source)
if (schema.info.version !== manifest.serverVersion)
  throw new Error('Contract source version mismatch')
if (
  !Number.isSafeInteger(manifest.apiRevision) ||
  schema.info['x-yuki-api-revision'] !== manifest.apiRevision
)
  throw new Error('Contract API revision mismatch')
const root = mkdtempSync(join(tmpdir(), 'yuki-contract-'))
try {
  const output = join(root, 'contract.gen.ts')
  const generated = spawnSync(
    process.execPath,
    [
      'node_modules/openapi-typescript/bin/cli.js',
      'contracts/client-api.openapi.json',
      '-o',
      output,
    ],
    { stdio: 'inherit' },
  )
  if (generated.status !== 0) process.exitCode = 1
  else if (readFileSync(output, 'utf8') !== readFileSync('src/shared/contract.gen.ts', 'utf8'))
    throw new Error('Generated types are stale; run npm run generate:contract')
  else console.log(`Contract and generated types match backend ${manifest.commit.slice(0, 12)}`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
