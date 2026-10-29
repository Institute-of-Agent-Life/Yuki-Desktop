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
    'windows-work.spec.ts',
    'windows-character-data.spec.ts',
    'windows-roles.spec.ts',
    'windows-window-geometry.spec.ts',
    'windows-window-controls.spec.ts',
    'native-materials.spec.ts',
    'mac-material-contrast.spec.ts',
    'native-toolbar-scroll.spec.ts',
    'native-about-layout.spec.ts',
    'native-file-layout.spec.ts',
    'native-work-layout.spec.ts',
    'native-pairing-availability.spec.ts',
    'native-artifact-actions.spec.ts',
    'windows-artifact-actions.spec.ts',
    'windows-application-menu.spec.ts',
  ],
  outputDir: process.env.YUKI_E2E_OUTPUT ?? join(tmpdir(), 'yuki-desktop-e2e'),
  grepInvert:
    process.platform === 'win32'
      ? /@unix-manager|@linux-supervisor/
      : process.platform === 'darwin'
        ? /@linux-supervisor/
        : undefined,
  workers: 1,
  // Asynchronous assertions share each test's existing overall deadline.
  expect: { timeout: 0 },
  webServer: {
    command: 'npm exec vite -- --config tests/fixtures/vite.config.ts',
    url: 'http://127.0.0.1:4178/components.html',
    reuseExistingServer: !process.env.CI,
  },
  use: { trace: 'retain-on-failure' },
})
