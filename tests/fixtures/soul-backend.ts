import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { closeSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function soulBackend() {
  const backend = process.env.YUKI_BACKEND_TEST_ROOT,
    python = process.env.YUKI_BACKEND_TEST_PYTHON
  test.skip(
    !backend || !python,
    'Requires the explicitly selected SOUL backend checkout and Python',
  )
  const root = await mkdtemp(join(tmpdir(), 'yd-soul-real-')),
    stateFile = join(root, 'server.json')
  const log = openSync(join(root, 'server.log'), 'w', 0o600)
  const server = spawn(
    python!,
    [
      '-m',
      'tests.support.soul_reference_server',
      '--root',
      root,
      '--state-file',
      stateFile,
      '--port',
      '0',
    ],
    { cwd: backend, stdio: ['ignore', log, log] },
  )
  let state:
    { base_url: string; owner_pairing_code: string; nonowner_pairing_code: string } | undefined
  try {
    await expect
      .poll(
        async () => {
          try {
            state = JSON.parse(await readFile(stateFile, 'utf8'))
            return (await fetch(state!.base_url + '/healthz')).status
          } catch {
            return 0
          }
        },
        { timeout: 30000 },
      )
      .toBe(200)
  } catch (error) {
    server.kill('SIGTERM')
    closeSync(log)
    throw new Error(`SOUL backend failed; evidence: ${root}`, { cause: error })
  }
  return {
    root,
    base: state!.base_url,
    ownerCode: state!.owner_pairing_code,
    nonownerCode: state!.nonowner_pairing_code,
    launch: (profile: string) =>
      electron.launch({
        args: ['.'],
        env: { ...process.env, YUKI_DESKTOP_DATA: join(root, profile) },
      }),
    async code() {
      return (await (await fetch(state!.base_url + '/__test/link-code', { method: 'POST' })).json())
        .code as string
    },
    async close(success: boolean) {
      await fetch(state!.base_url + '/__test/shutdown', { method: 'POST' })
      await new Promise<void>((resolve) => {
        if (server.exitCode !== null || server.signalCode !== null) resolve()
        else server.once('exit', () => resolve())
      })
      closeSync(log)
      if (success) await rm(root, { recursive: true, force: true })
      else console.error(`SOUL evidence retained: ${root}`)
    },
  }
}

export async function crashSoulApp(app: ElectronApplication) {
  const pid = await app.evaluate(() => process.pid),
    launcher = app.process(),
    exited = new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
  expect(process.kill(pid, 'SIGKILL')).toBe(true)
  await exited
  await app.close()
}
