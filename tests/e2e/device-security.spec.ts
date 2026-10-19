import { expect, test, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
async function security(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('tab', { name: '裝置與安全', exact: true }).click()
  await expect(page.getByRole('button', { name: '產生綁定碼', exact: true })).toBeEnabled()
}
async function selected(page: Page) {
  return page.evaluate(async () => {
    const r = await window.yuki.client.connections()
    if (!r.ok) throw Error(r.code)
    return r.value[0]!
  })
}
async function requests(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const r = await window.yuki.client.linkCodeRequests(id)
    if (!r.ok) throw Error(r.code)
    return r.value
  }, id)
}
async function assertNotOnDisk(root: string, secret: string) {
  for (const file of await readdir(root, { recursive: true, withFileTypes: true }))
    if (file.isFile())
      expect(
        (await readFile(join(file.parentPath, file.name))).includes(Buffer.from(secret)),
        file.name,
      ).toBe(false)
}

test('real QR pixels pair a second device once; original device revocation survives a lost response and cold restart', async () => {
  test.setTimeout(180000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/security')
  let a = await rig.launch('security-a'),
    success = false
  const b = await rig.launch('security-b')
  try {
    let pa = await a.firstWindow()
    const pb = await b.firstWindow()
    await a.evaluate(({ clipboard }) => {
      let value = ''
      clipboard.writeText = (text) => {
        value = text
      }
      clipboard.readText = () => value
    })
    await pairUI(pa, proxy.base, await rig.code(), 'Mac A')
    const original = await selected(pa)
    await security(pa)
    await pa.getByRole('button', { name: '產生綁定碼', exact: true }).click()
    const sheet = pa.getByRole('dialog', { name: '連接另一台裝置', exact: true })
    const code = await sheet.getByLabel('一次性綁定碼', { exact: true }).textContent()
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/)
    const link = (await sheet.getByLabel('一次性綁定連結', { exact: true }).textContent())!
    await expect(sheet.getByRole('img', { name: '綁定連結 QR', exact: true })).toBeVisible()
    if (process.platform === 'darwin') {
      const source = (await sheet.getByRole('img').getAttribute('src'))!,
        path = join(rig.root, 'actual-qr.png')
      await writeFile(path, Buffer.from(source.split(',')[1]!, 'base64'))
      const decoded = await promisify(execFile)(
        '/usr/bin/swift',
        [fileURLToPath(new URL('../fixtures/decode-qr.swift', import.meta.url)), path],
        { timeout: 60000 },
      )
      expect(decoded.stdout).toBe(link)
    }
    await sheet.getByRole('button', { name: '複製綁定連結', exact: true }).click()
    expect(await a.evaluate(({ clipboard }, link) => clipboard.readText() === link, link)).toBe(
      true,
    )
    const issued = (await requests(pa, original.characterId))[0]!
    expect(issued).toMatchObject({ state: 'result', problem: null })
    expect(JSON.stringify(issued)).not.toContain(code!)
    await sheet.getByRole('button', { name: '完成', exact: true }).click()
    await expect(pa.getByLabel('一次性綁定碼', { exact: true })).toHaveCount(0)
    await pa.getByRole('button', { name: '查看上次發碼結果', exact: true }).click()
    await expect(sheet.getByText(/綁定碼明文無法重新取得/)).toBeVisible()
    await expect(sheet.getByRole('img')).toHaveCount(0)
    await sheet.getByRole('button', { name: '完成', exact: true }).click()
    await pairUI(pb, proxy.base, link, 'Mac B')
    const second = await selected(pb)
    await security(pb)
    await pb.getByRole('button', { name: '產生綁定碼', exact: true }).click()
    const secondSheet = pb.getByRole('dialog', { name: '連接另一台裝置', exact: true })
    await expect(secondSheet.getByRole('img', { name: '綁定連結 QR', exact: true })).toBeVisible()
    const reused = await fetch(`${rig.base}/client/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device_label: 'must not pair twice' }),
    })
    expect(reused.status).toBe(401)
    await pa.getByRole('button', { name: '重新讀取裝置', exact: true }).click()
    const button = pa.getByRole('button', { name: '撤銷 Mac B', exact: true })
    await expect(button).toBeVisible()
    await button.click()
    await pa.keyboard.press('Enter')
    await expect(pa.getByRole('dialog', { name: '撤銷裝置？', exact: true })).not.toBeVisible()
    expect(
      await pb.evaluate(
        async (id) => (await window.yuki.client.read(id, { kind: 'me' })).ok,
        second.characterId,
      ),
    ).toBe(true)
    await button.click()
    proxy.faults.loseNextSuffix = `/devices/${second.deviceId}`
    await pa
      .getByRole('dialog', { name: '撤銷裝置？', exact: true })
      .getByRole('button', { name: '撤銷裝置', exact: true })
      .click()
    await expect(pa.getByText('裝置撤銷：結果尚未確認。', { exact: true })).toBeVisible()
    await expect(secondSheet).not.toBeVisible()
    await expect(pb.getByLabel('一次性綁定碼', { exact: true })).toHaveCount(0)
    expect(proxy.lostStatuses).toEqual([200])
    expect(
      await pb.evaluate(async (id) => {
        const r = await window.yuki.client.read(id, { kind: 'me' })
        return r.ok ? 'unexpected' : r.code
      }, second.characterId),
    ).toBe('unauthenticated')
    const revocation = await pa.evaluate(async (id) => {
      const r = await window.yuki.client.characterCommands(id)
      if (!r.ok) throw Error(r.code)
      return r.value.find((i) => i.command.kind === 'device-revoke')!
    }, original.characterId)
    const writes = () =>
      proxy.calls.filter(
        (c) => c.method === 'DELETE' && c.path.endsWith(`/devices/${second.deviceId}`),
      )
    expect(writes()).toHaveLength(1)
    a.process().kill('SIGKILL')
    await a.close().catch(() => {})
    proxy.faults.holdReceipts = false
    a = await rig.launch('security-a')
    pa = await a.firstWindow()
    await expect(pa.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toBeVisible()
    await security(pa)
    await expect
      .poll(() =>
        pa.evaluate(
          async ({ id, requestId }) => {
            const r = await window.yuki.client.characterCommands(id)
            const item = r.ok && r.value.find((i) => i.requestId === requestId)
            return item && { state: item.state, problem: item.problem }
          },
          { id: original.characterId, requestId: revocation.requestId },
        ),
      )
      .toEqual({ state: 'result', problem: null })
    expect(writes()).toHaveLength(1)
    await expect(pa.getByRole('button', { name: '撤銷 Mac B', exact: true })).toHaveCount(0)
    await expect(pa.getByText('已撤銷', { exact: true })).toBeVisible()
    await assertNotOnDisk(join(rig.root, 'security-a'), code!)
    await pa.screenshot({ path: test.info().outputPath('darwin-2x-device-security.png') })
    success = true
  } finally {
    await a.close().catch(() => {})
    await b.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('a code created before its response is lost can be verified but never silently regenerated or recovered as plaintext', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/codes'),
    app = await rig.launch('code-loss')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code(), 'Lost code device')
    const original = await selected(page)
    await security(page)
    proxy.faults.loseNextSuffix = '/link-codes'
    await page.getByRole('button', { name: '產生綁定碼', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '連接另一台裝置', exact: true })
    await expect(
      sheet.getByText('發碼結果尚未確認。可關閉此視窗，稍後查證原請求。', { exact: true }),
    ).toBeVisible()
    await expect(sheet.getByRole('img')).toHaveCount(0)
    const pending = (await requests(page, original.characterId))[0]!
    expect(pending.state).toBe('submitted')
    expect(proxy.lostStatuses).toEqual([200])
    await sheet.getByRole('button', { name: '完成', exact: true }).click()
    proxy.faults.holdReceipts = false
    await page.getByRole('button', { name: '查看上次發碼結果', exact: true }).click()
    await expect(sheet.getByText(/綁定碼明文無法重新取得/)).toBeVisible()
    await expect(sheet.getByRole('img')).toHaveCount(0)
    expect(
      proxy.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/link-codes')),
    ).toHaveLength(1)
    expect((await requests(page, original.characterId))[0]).toMatchObject({
      requestId: pending.requestId,
      state: 'result',
      problem: null,
    })
    await sheet.getByRole('button', { name: '另外產生綁定碼', exact: true }).click()
    await expect(sheet.getByLabel('一次性綁定碼', { exact: true })).toHaveText(
      /^[A-Za-z0-9_-]{32}$/,
    )
    expect(
      proxy.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/link-codes')),
    ).toHaveLength(2)
    expect((await requests(page, original.characterId))[1]!.requestId).not.toBe(pending.requestId)
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('an open secret expires in the renderer without automatically issuing another code', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/expiry'),
    app = await rig.launch('code-expiry')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code(), 'Expiry display')
    await security(page)
    await page.clock.install()
    await page.getByRole('button', { name: '產生綁定碼', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '連接另一台裝置', exact: true })
    await expect(sheet.getByLabel('一次性綁定碼', { exact: true })).toHaveText(
      /^[A-Za-z0-9_-]{32}$/,
    )
    await expect(sheet.getByRole('img', { name: '綁定連結 QR', exact: true })).toBeVisible()
    // Browser VM time only; server-side expiry remains covered by the real
    // identity service tests. This checks removal of the displayed secret.
    await page.clock.fastForward(601000)
    await expect(
      sheet.getByText('綁定碼已過期。可明確產生另一個碼。', { exact: true }),
    ).toBeVisible()
    await expect(sheet.getByRole('img')).toHaveCount(0)
    await expect(sheet.getByLabel('一次性綁定碼', { exact: true })).toHaveCount(0)
    expect(
      proxy.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/link-codes')),
    ).toHaveLength(1)
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('device and one-time-code sheets keep actual controls reachable in four themes and small workspaces', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('security-visual')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code(), '視覺驗證裝置')
    await security(page)
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900),
      )
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('tab', { name: mode === 'dark' ? '深色' : '淺色', exact: true }).click()
      for (const [label, value] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = page.getByRole('switch', { name: label, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(value)) await toggle.click()
      }
      await page.getByRole('tab', { name: '裝置與安全', exact: true }).click()
      for (const [width, height] of [
        [1440, 900],
        [1100, 760],
        [960, 492],
      ] as const) {
        await app.evaluate(
          ({ BrowserWindow }, size) => {
            const win = BrowserWindow.getAllWindows()[0]!
            win.setMinimumSize(960, 492)
            win.setContentSize(size.width, size.height)
          },
          { width, height },
        )
        await expect
          .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
          .toEqual([width, height])
        await page.screenshot({
          path: test.info().outputPath(`darwin-2x-${mode}-devices-${width}x${height}.png`),
          animations: 'disabled',
        })
        await page.getByRole('button', { name: '產生綁定碼', exact: true }).click()
        const sheet = page.getByRole('dialog', { name: '連接另一台裝置', exact: true })
        await expect(sheet.getByRole('img', { name: '綁定連結 QR', exact: true })).toBeVisible()
        await expect(sheet.getByRole('button', { name: '完成', exact: true })).toBeVisible()
        await page.screenshot({
          path: test.info().outputPath(`darwin-2x-${mode}-pair-code-${width}x${height}.png`),
          animations: 'disabled',
        })
        await sheet.getByRole('button', { name: '完成', exact: true }).click()
        await expect(page.getByRole('dialog')).not.toBeVisible()
      }
    }
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})
