import electron from 'electron'
import { spawnSync } from 'node:child_process'
// Native storage is built for the shipped Electron ABI, so exercise that exact runtime.
const result = spawnSync(
  electron,
  ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
)
process.exit(result.status ?? 1)
