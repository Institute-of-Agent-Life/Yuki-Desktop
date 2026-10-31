import { spawnSync } from 'node:child_process'

for (const [source, target] of [
  ['contracts/client-api.openapi.json', 'src/shared/contract.gen.ts'],
  ['contracts/admin-api.openapi.json', 'src/shared/admin-contract.gen.ts'],
]) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/openapi-typescript/bin/cli.js', source, '-o', target],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}
