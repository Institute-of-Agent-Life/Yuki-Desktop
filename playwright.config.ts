import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: [
    'windows-shell.spec.ts',
    'windows-client.spec.ts',
    'windows-onboarding.spec.ts',
    'windows-files.spec.ts',
    'windows-avatar.spec.ts',
    'windows-media.spec.ts',
    'windows-prompts.spec.ts',
    'windows-local-executor.spec.ts',
    'windows-executor-recovery.spec.ts',
    'windows-executor-enrollment.spec.ts',
    'windows-work.spec.ts',
    'windows-executor-submissions.spec.ts',
    'windows-character-data.spec.ts',
    'windows-roles.spec.ts',
    'windows-window-geometry.spec.ts',
    'windows-window-controls.spec.ts',
  ],
  outputDir: join(tmpdir(), 'yuki-desktop-e2e'),
  workers: 1,
  webServer: {
    command: 'npm exec vite -- --config tests/fixtures/vite.config.ts',
    url: 'http://127.0.0.1:4178/components.html',
    reuseExistingServer: !process.env.CI,
  },
  use: { trace: 'retain-on-failure' },
})
