import electron from 'electron'
import { spawnSync } from 'node:child_process'
// Exercise native storage with the exact Electron runtime shipped by the product.
const result = spawnSync(
  electron,
  ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
)
process.exit(result.status ?? 1)
