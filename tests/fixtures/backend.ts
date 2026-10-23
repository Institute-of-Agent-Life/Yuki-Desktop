import { expect, test, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { isolatedDesktop } from './isolated-desktop'
import { createServer } from 'node:net'
import type { Connection, EventsPage } from '../../src/shared/api'
import { parsePairing } from '../../src/shared/pairing'

export async function currentConnection(page: Page): Promise<Connection> {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok || !result.value[0]) throw Error('Missing current paired connection')
    return result.value[0]
  })
}

export async function currentEvents(page: Page): Promise<EventsPage> {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok || !result.value[0]) throw Error('Missing current paired connection')
    const connection = result.value[0]
    const events = await window.yuki.client.read<EventsPage>(connection.characterId, {
      kind: 'events',
      conversationId: connection.conversationId,
    })
    if (!events.ok) throw Error(events.code)
    return events.value
  })
}

export async function yukiFixture(options: { managedUpdates?: boolean } = {}) {
  const backend = process.env.YUKI_BACKEND_TEST_ROOT,
    python = process.env.YUKI_BACKEND_TEST_PYTHON
  if (process.env.CI && (!backend || !python))
    throw Error('CI must select YUKI_BACKEND_TEST_ROOT and YUKI_BACKEND_TEST_PYTHON')
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
      spawn(
        python!,
        [
          '-m',
          'tests.support.desktop_reference_server',
          '--root',
          root,
          '--state-file',
          join(root, 'ready.json'),
          '--port',
          String(port),
          '--base-path',
          '/role/yuki',
        ],
        {
          cwd: backend,
          env: {
            ...process.env,
            PYTHONPATH: [join(backend!, 'src'), backend!].join(delimiter),
          },
          stdio: ['ignore', log, log],
        },
      ),
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
  const desktop = await isolatedDesktop(root, options)
  return {
    root,
    base,
    ...desktop,
    state: async () =>
      JSON.parse(await readFile(join(root, 'ready.json'), 'utf8')) as {
        owner_pairing_code: string
        nonowner_pairing_code: string
        owner_person_id: string
        nonowner_person_id: string
        artifact_id: string
        artifact_version: string
        artifact_event_id: number
        artifact_conversation_id: string
      },
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
        await fetch(`${base}/__test/shutdown`, { method: 'POST' })
        await stopped
      }
      server = spawnServer()
      await ready()
    },
    async close(success: boolean) {
      if (server.exitCode === null && server.signalCode === null) {
        const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve()))
        await fetch(`${base}/__test/shutdown`, { method: 'POST' })
        await stopped
      }
      closeSync(log)
      if (success) await rm(root, { recursive: true, force: true })
      else console.error(`Backend evidence retained at ${root}`)
    },
  }
}
export async function pairUI(
  page: Page,
  base: string,
  code: string,
  label?: string,
  timeout = 5000,
) {
  type ProbeWindow = Window & {
    __yukiPairProbe?: { online: Record<string, boolean>; dispose(): void }
  }
  const start = page.getByRole('button', { name: '連接已有 Yuki', exact: true })
  const input = page
    .getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
    .filter({ visible: true })
  await expect(start.or(input)).toBeVisible({ timeout })
  await page.evaluate(() => {
    const target = window as ProbeWindow
    target.__yukiPairProbe?.dispose()
    const online: Record<string, boolean> = {}
    const dispose = window.yuki.client.onHint((id, kind, data) => {
      if (kind === 'connection') online[id] = (data as { state: string }).state === 'online'
    })
    target.__yukiPairProbe = { online, dispose }
  })
  try {
    if (await start.isVisible()) await start.click()
    const parsed = parsePairing(code)
    await input.fill(
      parsed?.server
        ? code
        : `yuki://pair?server=${encodeURIComponent(base)}&code=${encodeURIComponent(parsed?.code ?? code)}`,
    )
    await page.getByRole('button', { name: '繼續', exact: true }).click()
    if (label) await page.getByLabel('這台裝置的名稱').fill(label)
    await page.getByRole('button', { name: '確認並連接', exact: true }).click({ timeout })
    let pairedId = ''
    await expect
      .poll(
        async () => {
          const value = await page.evaluate(async (base) => {
            const list = await window.yuki.client.connections()
            const connection = list.ok
              ? list.value.find(
                  (item) => item.baseUrl.replace(/\/+$/, '') === base.replace(/\/+$/, ''),
                )
              : undefined
            return {
              id: connection?.characterId ?? '',
              online:
                !!connection &&
                !!(window as ProbeWindow).__yukiPairProbe?.online[connection.characterId],
            }
          }, base)
          pairedId = value.id
          return value.online
        },
        // A fresh Windows profile awaits Chromium's deferred encryption-key write before pairing.
        { timeout: 30000 },
      )
      .toBe(true)
    await expect(
      page.locator(`[data-character-session="${pairedId}"] [data-region="toolbar"]`),
    ).toBeVisible()
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath('pairing-failure.png') })
    const state = await page.evaluate(async () => {
      const connections = await window.yuki.client.connections()
      return {
        online: (window as ProbeWindow).__yukiPairProbe?.online,
        connections: connections.ok
          ? connections.value.map((item) => ({ id: item.characterId, base: item.baseUrl }))
          : connections.code,
        errors: Array.from(document.querySelectorAll('[role="alert"], [role="status"]')).map(
          (element) => element.textContent,
        ),
      }
    })
    throw new Error(`Pairing did not become online: ${JSON.stringify(state)}`, { cause: error })
  } finally {
    await page
      .evaluate(() => {
        const target = window as ProbeWindow
        target.__yukiPairProbe?.dispose()
        delete target.__yukiPairProbe
      })
      .catch(() => {})
  }
}
