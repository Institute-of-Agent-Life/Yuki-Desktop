import { expect, test, type ElectronApplication } from '@playwright/test'
import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { closeSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { isolatedDesktop } from './isolated-desktop'

export async function soulBackend() {
  const backend = process.env.YUKI_BACKEND_TEST_ROOT,
    python = process.env.YUKI_BACKEND_TEST_PYTHON
  if (process.env.CI && (!backend || !python))
    throw Error('CI must select YUKI_BACKEND_TEST_ROOT and YUKI_BACKEND_TEST_PYTHON')
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
    {
      cwd: backend,
      env: { ...process.env, PYTHONPATH: [join(backend!, 'src'), backend!].join(delimiter) },
      stdio: ['ignore', log, log],
    },
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
    await copyFile(join(root, 'server.log'), test.info().outputPath('backend-server.log'))
    throw new Error(`SOUL backend failed; evidence: ${root}`, { cause: error })
  }
  const desktop = await isolatedDesktop(root)
  return {
    root,
    base: state!.base_url,
    ownerCode: state!.owner_pairing_code,
    nonownerCode: state!.nonowner_pairing_code,
    ...desktop,
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
      else {
        await copyFile(join(root, 'server.log'), test.info().outputPath('backend-server.log'))
        console.error(`SOUL evidence retained: ${root}`)
      }
    },
  }
}

export async function crashSoulApp(app: ElectronApplication) {
  const exited = app.waitForEvent('close')
  await app.evaluate(() => process.exit(17)).catch(() => {})
  await exited
}
