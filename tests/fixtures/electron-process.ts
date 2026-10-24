import type { ElectronApplication } from '@playwright/test'

/** Crash the actual Electron Main, which may have been started through a shell. */
export async function crashElectron(app: ElectronApplication) {
  const pid = await app.evaluate(() => process.pid)
  const closed = new Promise<void>((resolve) => app.once('close', () => resolve()))
  process.kill(pid, 'SIGKILL')
  await closed
  return pid
}
