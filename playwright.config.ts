import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: join(tmpdir(), 'yuki-desktop-e2e'),
  workers: 1,
  webServer: {
    command: 'npm exec vite -- --config tests/fixtures/vite.config.ts',
    url: 'http://127.0.0.1:4178/components.html',
    reuseExistingServer: !process.env.CI,
  },
  use: { trace: 'retain-on-failure' },
})
