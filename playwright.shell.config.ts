import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    'shell.spec.ts',
    'windows-shell.spec.ts',
    'windows-client.spec.ts',
    'windows-onboarding.spec.ts',
    'windows-files.spec.ts',
    'windows-avatar.spec.ts',
    'windows-media.spec.ts',
  ],
  outputDir: process.env.YUKI_NATIVE_TEST_OUTPUT ?? join(tmpdir(), 'yuki-desktop-native-e2e'),
  workers: 1,
  timeout: 60_000,
  use: { trace: 'retain-on-failure' },
})
