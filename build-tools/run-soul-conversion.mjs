import electron from 'electron'
import { spawnSync } from 'node:child_process'

const result = spawnSync(
  electron,
  ['build-tools/convert-soul-data.mjs', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
)
process.exit(result.status ?? 1)
