import { _electron as electron, expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { pairUI } from '../fixtures/backend'

test('actual Yuki container: pairing, real ledger reply, lost response, cold recovery and draft', async () => {
  const backend = process.env.YUKI_BACKEND_TEST_ROOT,
    python = process.env.YUKI_BACKEND_TEST_PYTHON
  test.skip(
    !backend || !python,
    'Requires the explicitly selected Yuki backend test checkout and Python environment.',
  )
  test.setTimeout(120000)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'yd-real-api-'))),
    data = join(root, 'desktop')
  const port = await new Promise<number>((resolve) => {
    const socket = createServer()
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address()
      const port = typeof address === 'object' && address ? address.port : 0
      socket.close(() => resolve(port))
    })
  })
  const log = openSync(join(root, 'server.log'), 'w', 0o600)
  const server = spawn(
    python!,
    ['-m', 'tests.support.desktop_reference_server', root, String(port)],
    { cwd: backend, stdio: ['ignore', log, log] },
  )
  const base = `http://127.0.0.1:${port}/role/yuki`
  const launch = () =>
    electron.launch({ args: ['.'], env: { ...process.env, YUKI_DESKTOP_DATA: data } })
  let app: Awaited<ReturnType<typeof launch>> | undefined
  let completed = false
  try {
    await expect
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
    const ready = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8')) as { code: string }
    app = await launch()
    let page = await app.firstWindow()
    await page.getByRole('button', { name: '開始', exact: true }).click()
    await page.getByLabel('伺服器位址').fill(base)
    await page.getByRole('button', { name: '繼續', exact: true }).click()
    await expect(page.getByLabel('綁定碼或完整回覆')).toBeVisible()
    await page.getByLabel('綁定碼或完整回覆').fill(`綁定碼：${ready.code}（10 分鐘內有效）`)
    await page.getByRole('button', { name: '配對', exact: true }).click()
    await expect(page.getByRole('button', { name: '進入', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '進入', exact: true }).click()
    await expect(page.getByText('已連線', { exact: true })).toBeVisible()
    let composer = page.getByRole('textbox', { name: '和 Yuki 說點什麼' })
    await fetch(`${base}/__test/pause-next-me`, { method: 'POST' })
    await composer.fill('第一則原始訊息')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(
        async () =>
          ((await (await fetch(`${base}/__test/me-blocked`)).json()) as { blocked: boolean })
            .blocked,
      )
      .toBe(true)
    await composer.fill('等待送出期間的新草稿')
    await fetch(`${base}/__test/resume-me`, { method: 'POST' })
    await expect(page.getByRole('button', { name: '送出', exact: true })).toBeEnabled()
    await expect(composer).toHaveValue('等待送出期間的新草稿')
    await expect
      .poll(
        async () => {
          const events = (await (await fetch(`${base}/__test/events`)).json()) as { text: string }[]
          return events.filter((item) => item.text === '真實帳本回覆').length
        },
        { timeout: 20000 },
      )
      .toBe(1)
    await expect(page.getByText('真實帳本回覆', { exact: true })).toBeVisible({ timeout: 20000 })
    await page
      .getByRole('article')
      .filter({ has: page.getByText('第一則原始訊息', { exact: true }) })
      .getByRole('button', { name: '引用回覆' })
      .click()
    await expect(
      page.locator('[data-region="composer"]').getByText('引用：第一則原始訊息', { exact: true }),
    ).toBeVisible()
    await composer.fill('繼續原引用')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('繼續原引用', { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        const events = (await (await fetch(`${base}/__test/events`)).json()) as { text: string }[]
        return events.some((item) => item.text.endsWith('\n繼續原引用'))
      })
      .toBe(true)
    const facts = (await (await fetch(`${base}/__test/events`)).json()) as {
      id: number
      text: string
    }[]
    const source = facts.find((item) => item.text === '第一則原始訊息')!
    const quoted = facts.find((item) => item.text.endsWith('\n繼續原引用'))!
    expect(quoted.text).toContain(` event=${source.id}]]`)
    expect(
      (await fetch(`${base}/__test/events/${source.id}?lose_hint=true`, { method: 'DELETE' }))
        .status,
    ).toBe(200)
    await expect(page.getByText('第一則原始訊息', { exact: true })).toHaveCount(0)
    await expect(page.getByText('引用的訊息無法讀取', { exact: true })).toBeVisible()
    await expect(page.getByText('引用：真實帳本回覆', { exact: true })).toHaveCount(0)
    await fetch(`${base}/__test/lose-next-response`, { method: 'POST' })
    await composer.fill('原回應遺失的訊息')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    await composer.fill('尚未送出的草稿')
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const connections = await window.yuki.client.connections()
          if (!connections.ok || !connections.value[0]) return ''
          const draft = await window.yuki.client.draft(connections.value[0].characterId)
          return draft.ok ? draft.value : ''
        }),
      )
      .toBe('尚未送出的草稿')
    const process = app.process()
    const stopped = new Promise<void>((resolve) => process.once('exit', () => resolve()))
    process.kill('SIGKILL')
    await stopped
    app = undefined
    app = await launch()
    page = await app.firstWindow()
    composer = page.getByRole('textbox', { name: '和 Yuki 說點什麼' })
    await expect(composer.or(page.getByLabel('伺服器位址'))).toBeVisible()
    if (await page.getByLabel('伺服器位址').isVisible()) {
      const code = (await (await fetch(`${base}/__test/link-code`, { method: 'POST' })).json()) as {
        code: string
      }
      await pairUI(page, base, code.code)
    }
    await expect(composer).toHaveValue('尚未送出的草稿')
    await expect(page.getByText('原回應遺失的訊息', { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        const events = (await (await fetch(`${base}/__test/events`)).json()) as { text: string }[]
        return events.filter((item) => item.text === '原回應遺失的訊息').length
      })
      .toBe(1)
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('real-backend-conversation.png'),
    })
    completed = true
  } finally {
    await fetch(`${base}/__test/resume-me`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    }).catch(() => {})
    await app?.close()
    server.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve()
      else server.once('exit', () => resolve())
    })
    closeSync(log)
    if (completed) await rm(root, { recursive: true, force: true })
    else console.error(`Isolated backend evidence retained at ${root}`)
  }
})
