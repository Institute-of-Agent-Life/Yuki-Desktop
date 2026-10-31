import { expect, test, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { isolatedDesktop } from './isolated-desktop'
import { createServer } from 'node:net'
import type {
  Connection,
  EventsPage,
  PublicEvent,
  Home,
  Work,
  OriginalRequest,
  Computer,
} from '../../src/shared/api'
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

/** Wait for this normal UI submission's actual accepted event and original UUID. */
export async function waitForAcceptedMessage(page: Page, characterId: string, text: string) {
  return page.evaluate(
    ({ characterId, text }) =>
      new Promise<{ requestId: string; eventId: number }>((resolve, reject) => {
        let reading = false
        let changed = false
        const dispose = window.yuki.client.onHint((id, kind) => {
          if (id === characterId && kind === 'outbox') void read()
        })
        async function read() {
          if (reading) {
            changed = true
            return
          }
          reading = true
          try {
            do {
              changed = false
              const result = await window.yuki.client.outbox(characterId)
              if (!result.ok) throw Error(result.code)
              const message = result.value.find((item) => item.body.text === text)
              if (message?.eventId) {
                dispose()
                resolve({ requestId: message.requestId, eventId: message.eventId })
                return
              }
            } while (changed)
          } catch (error) {
            dispose()
            reject(error)
          } finally {
            reading = false
          }
        }
        void read()
      }),
    { characterId, text },
  )
}

/** Follow commit hints, while completion remains the original Main receipt. */
export async function waitForMainEnded(
  page: Page,
  characterId: string,
  requestId: string,
): Promise<OriginalRequest> {
  return page.evaluate(
    ({ characterId, requestId }) =>
      new Promise<OriginalRequest>((resolve, reject) => {
        let reading = false
        let changed = false
        const unsubscribe = window.yuki.client.onHint((id, kind) => {
          if (id === characterId && kind !== 'connection') void read()
        })
        async function read() {
          if (reading) {
            changed = true
            return
          }
          reading = true
          try {
            do {
              changed = false
              const result = await window.yuki.client.read<OriginalRequest>(characterId, {
                kind: 'request',
                requestId,
              })
              if (!result.ok) throw Error(result.code)
              if (!result.value.found) throw Error(`Original request not found: ${requestId}`)
              if (result.value.turn?.state === 'ended') {
                unsubscribe()
                resolve(result.value)
                return
              }
            } while (changed)
          } catch (error) {
            unsubscribe()
            reject(error)
          } finally {
            reading = false
          }
        }
        void read()
      }),
    { characterId, requestId },
  )
}

/** Observe the original Work through existing hints, without another execution. */
export async function waitForWorkState(
  page: Page,
  characterId: string,
  workId: string,
  state: Work['state'],
) {
  return page.evaluate(
    ({ characterId, workId, state }) =>
      new Promise<Work>((resolve, reject) => {
        let reading = false
        let changed = false
        const dispose = window.yuki.client.onHint((id, kind) => {
          if (id === characterId && kind !== 'connection') void read()
        })
        async function read() {
          if (reading) {
            changed = true
            return
          }
          reading = true
          try {
            do {
              changed = false
              const value = await window.yuki.client.read<Work>(characterId, {
                kind: 'work',
                workId,
              })
              if (!value.ok) throw Error(value.code)
              if (value.value.state === state) {
                dispose()
                resolve(value.value)
                return
              }
            } while (changed)
          } catch (error) {
            dispose()
            reject(error)
          } finally {
            reading = false
          }
        }
        void read()
      }),
    { characterId, workId, state },
  )
}

type LedgerEvent = Pick<
  PublicEvent,
  | 'event_id'
  | 'content'
  | 'direction'
  | 'author_kind'
  | 'author_person_id'
  | 'conversation_id'
  | 'observed_at'
  | 'attachments'
  | 'asr'
>

export async function ledgerEvents(base: string): Promise<LedgerEvent[]> {
  const response = await fetch(`${base}/__test/events`)
  expect(response.ok).toBe(true)
  const events: LedgerEvent[] = await response.json()
  expect(Array.isArray(events)).toBe(true)
  return events
}

/** Read the original business identities and receipts after an acceptance failure. */
export async function recordBusinessState(page: Page, name: string, computer = false) {
  const state = await page.evaluate(async (computer) => {
    const connections = await window.yuki.client.connections()
    if (!connections.ok) return connections
    return Promise.all(
      connections.value.map(async (connection) => {
        const id = connection.characterId
        const [home, outbox, commands, computerCommands] = await Promise.all([
          window.yuki.client.read<Home>(id, { kind: 'home' }),
          window.yuki.client.outbox(id),
          window.yuki.client.workCommands(id),
          computer ? window.yuki.client.computerCommands(id) : undefined,
        ])
        const requestIds = new Set([
          ...(outbox.ok ? outbox.value.map((item) => item.requestId) : []),
          ...(commands.ok ? commands.value.map((item) => item.requestId) : []),
          ...(computerCommands?.ok ? computerCommands.value.map((item) => item.requestId) : []),
        ])
        const receipts = await Promise.all(
          [...requestIds].map(async (requestId) => ({
            requestId,
            receipt: await window.yuki.client.read<OriginalRequest>(id, {
              kind: 'request',
              requestId,
            }),
          })),
        )
        const workIds = new Set([
          ...(home.ok ? home.value.works.map((work) => work.work_id) : []),
          ...(commands.ok ? commands.value.map((item) => item.command.workId) : []),
          ...receipts.flatMap(({ receipt }) =>
            receipt.ok && receipt.value.work ? [receipt.value.work.work_id] : [],
          ),
        ])
        const works = await Promise.all(
          [...workIds].map(async (workId) => ({
            workId,
            result: await window.yuki.client.read<Work>(id, { kind: 'work', workId }),
          })),
        )
        return {
          connection,
          home,
          outbox,
          commands,
          receipts,
          works,
          ...(computer
            ? {
                computer: await window.yuki.client.read<Computer>(id, { kind: 'computer' }),
                computerCommands,
              }
            : {}),
        }
      }),
    )
  }, computer)
  await writeFile(test.info().outputPath(name), JSON.stringify(state, null, 2))
}

export async function yukiFixture(
  options: {
    managedUpdates?: boolean
    computer?: boolean
    computerWork?: boolean
    character?: boolean
    prompts?: boolean | 'readonly'
    native?: boolean
    maxInputCharacters?: number
    richMedia?: boolean
    modelConfiguration?: boolean
  } = {},
) {
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
          ...(options.richMedia
            ? [join(process.cwd(), 'tests/fixtures/media_reference_server.py')]
            : ['-m', 'tests.support.desktop_reference_server']),
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
            ...(options.maxInputCharacters === undefined
              ? {}
              : { MAX_INPUT_CHARACTERS: String(options.maxInputCharacters) }),
            PYTHONPATH: [join(backend!, 'src'), backend!].join(delimiter),
            YUKI_DESKTOP_COMPUTER_FIXTURE: options.computer || options.computerWork ? '1' : '0',
            YUKI_DESKTOP_COMPUTER_WORK_FIXTURE: options.computerWork ? '1' : '0',
            YUKI_DESKTOP_NATIVE_FIXTURE: options.native ? '1' : '0',
            YUKI_DESKTOP_CHARACTER_FIXTURE: options.character ? '1' : '0',
            YUKI_AUTHORITY_FIXTURE: options.modelConfiguration ? '1' : '0',
            YUKI_DESKTOP_PROMPT_FIXTURE:
              options.prompts === 'readonly' ? 'readonly' : options.prompts ? '1' : '0',
          },
          stdio: ['ignore', 'ignore', log],
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
    await copyFile(join(root, 'server.log'), test.info().outputPath('backend-server.log'))
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
        model_upstream_url: string
        model_upstream_key: string
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
    async crash() {
      const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve()))
      server.kill('SIGKILL')
      await stopped
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
      else {
        await copyFile(join(root, 'server.log'), test.info().outputPath('backend-server.log'))
        console.error(`Backend evidence retained at ${root}`)
      }
    },
  }
}
export async function pairUI(
  page: Page,
  base: string,
  code: string,
  label?: string,
  timeout?: number,
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
    const inspect = page.getByRole('button', { name: '繼續', exact: true })
    if (await inspect.isVisible()) await inspect.click()
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
      const pending = await window.yuki.client.pendingPairings()
      return {
        online: (window as ProbeWindow).__yukiPairProbe?.online,
        connections: connections.ok
          ? connections.value.map((item) => ({ id: item.characterId, base: item.baseUrl }))
          : connections.code,
        pending: pending.ok
          ? pending.value.map((item) => ({
              characterId: item.characterId,
              deviceId: item.deviceId,
              persistentCredentials: item.persistentCredentials,
            }))
          : { code: pending.code },
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
