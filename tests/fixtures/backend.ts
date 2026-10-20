import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

export async function yukiFixture(
  options: {
    computer?: boolean
    computerWork?: boolean
    character?: boolean
    prompts?: boolean | 'readonly'
    executor?: boolean
    longText?: boolean
  } = {},
) {
  const backend = process.env.YUKI_BACKEND_TEST_ROOT,
    python = process.env.YUKI_BACKEND_TEST_PYTHON
  test.skip(
    !backend || !python,
    'Requires the explicitly selected backend test checkout and Python.',
  )
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yd-media-real-')))
  const port = await new Promise<number>((resolve) => {
    const socket = createServer()
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address(),
        port = typeof address === 'object' && address ? address.port : 0
      socket.close(() => resolve(port))
    })
  })
  const log = openSync(join(root, 'server.log'), 'w', 0o600),
    spawnServer = () =>
      spawn(python!, ['-m', 'tests.support.desktop_reference_server', root, String(port)], {
        cwd: backend,
        env: {
          ...process.env,
          YUKI_DESKTOP_COMPUTER_FIXTURE: options.computer || options.computerWork ? '1' : '0',
          YUKI_DESKTOP_COMPUTER_WORK_FIXTURE: options.computerWork ? '1' : '0',
          YUKI_DESKTOP_EXECUTOR_FIXTURE: options.executor ? '1' : '0',
          YUKI_DESKTOP_LONG_TEXT_FIXTURE: options.longText ? '1' : '0',
          YUKI_DESKTOP_CHARACTER_FIXTURE: options.character ? '1' : '0',
          YUKI_DESKTOP_PROMPT_FIXTURE:
            options.prompts === 'readonly' ? 'readonly' : options.prompts ? '1' : '0',
        },
        stdio: ['ignore', log, log],
      }),
    base = `http://127.0.0.1:${port}/role/yuki`
  let server = spawnServer()
  const ready = () =>
    expect
      .poll(
        async () => {
          try {
            return (await fetch(`${base}/healthz`)).status
          } catch {
            return 0
          }
        },
        { timeout: 30000 },
      )
      .toBe(200)
  try {
    await ready()
  } catch (error) {
    server.kill('SIGTERM')
    closeSync(log)
    throw new Error(`Backend startup failed; local evidence: ${root}`, { cause: error })
  }
  return {
    root,
    base,
    launch: (profile: string, args: string[] = []) =>
      electron.launch({
        ...(process.env.YUKI_DESKTOP_EXECUTABLE
          ? { executablePath: process.env.YUKI_DESKTOP_EXECUTABLE }
          : {}),
        args: process.env.YUKI_DESKTOP_EXECUTABLE ? args : [...args, '.'],
        env: { ...process.env, YUKI_DESKTOP_DATA: join(root, profile) },
      }),
    async code() {
      return (
        (await (await fetch(`${base}/__test/link-code`, { method: 'POST' })).json()) as {
          code: string
        }
      ).code
    },
    async restart() {
      if (server.exitCode === null && server.signalCode === null) {
        const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve()))
        server.kill('SIGKILL')
        await stopped
      }
      server = spawnServer()
      await ready()
    },
    async close(success: boolean) {
      server.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        if (server.exitCode !== null || server.signalCode !== null) resolve()
        else server.once('exit', () => resolve())
      })
      closeSync(log)
      if (success) await rm(root, { recursive: true, force: true })
      else console.error(`Backend evidence retained at ${root}`)
    },
  }
}
export async function pairUI(page: Page, base: string, code: string, label?: string) {
  const start = page.getByRole('button', { name: '開始', exact: true })
  await expect(start.or(page.getByLabel('伺服器位址'))).toBeVisible()
  if (await start.isVisible()) await start.click()
  await page.getByLabel('伺服器位址').fill(base)
  await page.getByRole('button', { name: '繼續', exact: true }).click()
  await page.getByLabel('綁定碼或完整回覆').fill(code)
  if (label) await page.getByLabel('裝置名稱').fill(label)
  await page.getByRole('button', { name: '配對', exact: true }).click()
  await page.getByRole('button', { name: '進入', exact: true }).click()
  await expect(page.getByText('已連線', { exact: true }).filter({ visible: true })).toBeVisible()
}
