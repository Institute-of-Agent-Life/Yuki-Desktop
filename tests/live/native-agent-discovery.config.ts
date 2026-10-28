import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

// Independent from the paid-turn acceptance: no backend or native model task is started.
export default defineConfig({
  testDir: '.',
  testMatch: 'native-agent-discovery.spec.ts',
  outputDir: resolve('.cache/native-agent-discovery'),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: { trace: 'off', screenshot: 'off', video: 'off' },
})
