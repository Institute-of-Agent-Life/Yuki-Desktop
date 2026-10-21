import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Meta } from '../../src/shared/api'
import { yukiFixture } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'

test('missing desktop metadata stays before pairing and retries the actual compatible backend', async () => {
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  const rig = await yukiFixture()
  const metadata = await fetch(rig.base + '/client/v1/meta')
  expect(metadata.ok).toBe(true)
  const meta = ((await metadata.json()) as { data: Meta }).data
  let missing = true
  const requests: { method: string | undefined; path: string | undefined; authorized: boolean }[] =
    []
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      path: request.url,
      authorized: !!request.headers.authorization,
    })
    if (missing || request.method !== 'GET' || request.url !== '/client/v1/meta') {
      response
        .writeHead(404, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ detail: 'Not Found' }))
      return
    }
    try {
      const upstream = await fetch(rig.base + '/client/v1/meta')
      response
        .writeHead(upstream.status, { 'Content-Type': 'application/json' })
        .end(await upstream.text())
    } catch {
      response.writeHead(502).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('No test port')
  const base = `http://127.0.0.1:${address.port}`
  const data = await mkdtemp(join(tmpdir(), 'yuki-native-pairing-availability-'))
  const app = await launchShell(data)
  try {
    const page = await app.firstWindow()
    const native = await app.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        packaged: app.isPackaged,
        sandboxed: app
          .getAppMetrics()
          .find((entry) => entry.pid === win.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    expect(native).toEqual({ packaged: true, sandboxed: true, noSandbox: false })
    await page.getByRole('button', { name: '開始', exact: true }).click()
    await page.getByLabel('伺服器位址', { exact: true }).fill(base)
    await page.getByRole('button', { name: '繼續', exact: true }).press('Enter')
    await expect(page.getByRole('status')).toHaveText(
      '此位址未提供桌面連線介面，請確認位址或更新 Yuki。',
    )
    await expect(page.getByLabel('綁定碼或完整回覆', { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('伺服器位址', { exact: true })).toHaveValue(base)
    expect(await page.evaluate(() => window.yuki.client.connections())).toEqual({
      ok: true,
      value: [],
    })
    await page.screenshot({ path: test.info().outputPath('missing-desktop-api.png') })
    missing = false
    await page.getByRole('button', { name: '繼續', exact: true }).press('Enter')
    await expect(
      page.getByRole('heading', { name: meta.character.display_name, exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('綁定碼或完整回覆', { exact: true })).toBeVisible()
    await expect(
      page.getByText('此位址未提供桌面連線介面，請確認位址或更新 Yuki。', { exact: true }),
    ).toHaveCount(0)
    await expect(page.getByRole('status')).toHaveText('沒有找到 32 字元的綁定碼')
    expect(requests).toEqual([
      { method: 'GET', path: '/client/v1/meta', authorized: false },
      { method: 'GET', path: '/client/v1/meta', authorized: false },
    ])
    await writeFile(
      test.info().outputPath('availability.json'),
      JSON.stringify({ data, native, requests, recoveredCharacterId: meta.character.id }, null, 2) +
        '\n',
    )
  } finally {
    await app.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rig.close(false)
  }
})
