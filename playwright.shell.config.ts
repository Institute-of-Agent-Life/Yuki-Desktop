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
    'native-materials.spec.ts',
    'mac-material-contrast.spec.ts',
    'native-toolbar-scroll.spec.ts',
    'native-about-layout.spec.ts',
    'native-file-layout.spec.ts',
    'native-artifact-actions.spec.ts',
    'windows-artifact-actions.spec.ts',
    'windows-application-menu.spec.ts',
  ],
  outputDir: process.env.YUKI_NATIVE_TEST_OUTPUT ?? join(tmpdir(), 'yuki-desktop-native-e2e'),
  workers: 1,
  timeout: 60_000,
  use: { trace: 'retain-on-failure' },
})
