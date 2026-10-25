import { defineConfig } from '@playwright/test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Kept outside the default tests/e2e tree: invoking this config is deliberate.
export default defineConfig({
  testDir: '.',
  testMatch: 'windows-codex-first-use.spec.ts',
  outputDir: process.env.YUKI_E2E_OUTPUT ?? join(tmpdir(), 'yuki-codex-live-ui'),
  workers: 1,
  retries: 0,
  timeout: 240_000,
  // Native session listings can contain private titles; retain only scoped evidence.
  use: { trace: 'off', screenshot: 'off', video: 'off' },
})
