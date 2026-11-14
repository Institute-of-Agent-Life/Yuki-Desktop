import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Connection, EventsPage } from '../../src/shared/api'
import { currentConnection, yukiFixture } from '../fixtures/backend'
import { fillSsh, sshHost } from '../fixtures/ssh-host'

// Failure cases 18–21 and 24 of the 2026-11-13 usability task book: SSH is only the path to the
// server. A real SSH server (ssh2) forwards to a real Yuki reference service; the "server's"
// answers to the few commands Desktop runs there (pair.sh, reading .env) are this test's.
const password = 'correct horse battery staple ' + randomUUID()

async function filesContaining(root: string, needle: Buffer): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...(await filesContaining(path, needle)))
    else if (entry.isFile() && (await readFile(path)).includes(needle)) found.push(path)
  }
  return found
}
async function events(page: Page, connection: Connection): Promise<number[]> {
  return page.evaluate(async (connection) => {
    const result = await window.yuki.client.read<EventsPage>(connection.characterId, {
      kind: 'events',
      conversationId: connection.conversationId,
    })
    if (!result.ok) throw Error(result.code)
    return result.value.items.map((event) => event.event_id)
  }, connection)
}
async function online(page: Page, id: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const result = await window.yuki.client.read(id, { kind: 'me' })
          return result.ok
        }, id),
      { timeout: 60000 },
    )
    .toBe(true)
}

test('SSH: confirm the host key once, keep the password in the keychain and the local port across restarts, refuse a changed key', async () => {
  test.setTimeout(240000)
  const rig = await yukiFixture({ basePath: '' })
  const host = await sshHost({
    user: 'yuki',
    password,
    async exec(command) {
      if (command.includes('id -u')) return { stdout: 'uid=0\nhome=/root\n' }
      if (command.includes('YUKI_PORT')) return { stdout: `${rig.port}\n` }
      if (command.includes('deploy/pair.sh'))
        return {
          stdout: `Connect Yuki Desktop:\n  Pairing code: ${await rig.code()}\n  One-time, valid for 24 hours\n`,
        }
      return { code: 127, stderr: `unexpected: ${command}` }
    },
  })
  const output: string[] = []
  let app = await rig.launch('ssh')
  let success = false
  try {
    app.process().stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
    app.process().stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
    let page = await app.firstWindow()
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    // The pairing hint points at the SSH entry below it; nobody builds a tunnel first.
    await expect(page.getByText('選「通過 SSH 連接」', { exact: false })).toBeVisible()
    await expect(page.getByText('請先建立網路連線', { exact: false })).toHaveCount(0)
    await page.getByRole('button', { name: '通過 SSH 連接', exact: true }).click()
    await fillSsh(page, { address: 'yuki@127.0.0.1', port: host.port, password })
    await page.getByRole('button', { name: '檢查主機', exact: true }).click()
    // Nothing is sent to an unconfirmed host: the fingerprint comes before any login.
    await expect(page.getByLabel('主機指紋', { exact: true })).toHaveValue(host.fingerprint)
    expect(host.execs).toEqual([])
    await page.screenshot({ path: test.info().outputPath('ssh-01-fingerprint.png') })
    await page.getByRole('button', { name: '確認指紋並連接', exact: true }).click()
    await expect(page.locator('[data-character-session] [data-region="toolbar"]')).toBeVisible({
      timeout: 60000,
    })
    const first = await currentConnection(page)
    expect(first.transport).toMatchObject({
      kind: 'ssh',
      host: '127.0.0.1',
      port: host.port,
      user: 'yuki',
      auth: { kind: 'password' },
      directory: '/root/yuki',
      remotePort: rig.port,
    })
    if (first.transport?.kind !== 'ssh') throw Error('Expected an SSH connection')
    expect(first.baseUrl).toBe(`http://127.0.0.1:${first.transport.localPort}`)
    expect(host.execs.map((item) => item.command).join('\n')).toContain("'/root/yuki'")
    expect(host.forwards).toContain(rig.port)
    await online(page, first.characterId)
    await page.screenshot({ path: test.info().outputPath('ssh-02-chat.png') })

    // 20: the network path goes away and comes back; the tunnel follows without the user.
    await host.stop()
    await expect(page.getByText('連不上這台主機的 SSH', { exact: false })).toBeVisible({
      timeout: 60000,
    })
    await page.screenshot({ path: test.info().outputPath('ssh-03-network-lost.png') })
    await host.start()
    await online(page, first.characterId)
    await expect(page.getByText('連不上這台主機的 SSH', { exact: false })).toHaveCount(0, {
      timeout: 60000,
    })

    // 18: the same local port, device credential and connection after a restart.
    await app.close()
    app = await rig.launch('ssh')
    app.process().stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
    app.process().stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()))
    page = await app.firstWindow()
    await online(page, first.characterId)
    await expect(page.locator('[data-character-session] [data-region="toolbar"]')).toBeVisible()
    expect(await currentConnection(page)).toEqual(first)
    await page.screenshot({ path: test.info().outputPath('ssh-04-after-restart.png') })

    // 19: a changed host key is refused and said so; no request reaches the server.
    await host.rotateKey()
    const forwarded = host.forwards.length
    await expect(page.getByText('主機指紋與第一次連接時不同', { exact: false })).toBeVisible({
      timeout: 60000,
    })
    await page.screenshot({ path: test.info().outputPath('ssh-05-host-key-changed.png') })
    expect(host.forwards.length).toBe(forwarded)

    // 24: the SSH password lives only in the keychain-encrypted credential store.
    await app.close()
    const leaks = await filesContaining(join(rig.root, 'ssh'), Buffer.from(password))
    expect(leaks).toEqual([])
    expect(output.join('')).not.toContain(password)
    success = true
  } finally {
    await writeFile(test.info().outputPath('app-output.log'), output.join(''))
    await app.close().catch(() => {})
    await host.stop().catch(() => {})
    await rig.close(success)
  }
})

test('SSH: switching between SSH and direct keeps the original connection and moves the Connector', async () => {
  test.setTimeout(240000)
  const manifest = JSON.parse(await readFile('.cache/connector-runtime/manifest.json', 'utf8')) as {
    executable: string
  }
  const executable = resolve('.cache/connector-runtime', manifest.executable)
  const rig = await yukiFixture({ basePath: '' })
  const host = await sshHost({
    user: 'yuki',
    password,
    async exec(command) {
      if (command.includes('id -u')) return { stdout: 'uid=0\nhome=/root\n' }
      if (command.includes('YUKI_PORT')) return { stdout: `${rig.port}\n` }
      if (command.includes('deploy/pair.sh'))
        return { stdout: `  Pairing code: ${await rig.code()}\n` }
      return { code: 127, stderr: `unexpected: ${command}` }
    },
  })
  const app = await rig.launch('switch')
  let success = false
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '通過 SSH 連接', exact: true }).click()
    await fillSsh(page, { address: 'yuki@127.0.0.1', port: host.port, password })
    await page.getByRole('button', { name: '檢查主機', exact: true }).click()
    await page.getByRole('button', { name: '確認指紋並連接', exact: true }).click()
    await expect(page.locator('[data-character-session] [data-region="toolbar"]')).toBeVisible({
      timeout: 60000,
    })
    const original = await currentConnection(page)
    await online(page, original.characterId)
    const composer = page.locator(`[data-character-session="${original.characterId}"] textarea`)
    await composer.fill('經 SSH 送出的原訊息')
    await composer.press('Enter')
    await expect
      .poll(async () => (await events(page, original)).length, { timeout: 30000 })
      .toBeGreaterThan(0)
    const history = await events(page, original)

    // The Connector of this computer, paired to the same Person, follows the connection.
    const chatResponse = await fetch(`${rig.base}/client/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: await rig.code(), device_label: 'Switch test setup' }),
    })
    const chat = (await chatResponse.json()).data as { token: string }
    const issued = await fetch(`${rig.base}/client/v1/link-codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chat.token}` },
      body: JSON.stringify({ request_id: randomUUID(), purpose: 'connector' }),
    })
    const code = (await issued.json()).data.code as string
    const paired = (await (
      await fetch(`${rig.base}/agents/v1/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, device_label: 'This computer' }),
      })
    ).json()) as { device_id: string; token: string }
    const dataDirectory = join(rig.root, 'connector'),
      configPath = join(dataDirectory, 'config.json')
    await mkdir(dataDirectory)
    await writeFile(
      configPath,
      JSON.stringify({
        url: rig.base.replace('http:', 'ws:') + '/agents/v1/connect',
        device_id: paired.device_id,
        token: paired.token,
        instances: [],
        full_access: false,
      }),
      { mode: 0o600 },
    )
    const selected = await page.evaluate((input) => window.yuki.connector.useInstallation(input), {
      executable,
      dataDirectory,
    })
    expect(selected.ok).toBe(true)

    const switchTo = async (kind: 'direct' | 'ssh', name: string) => {
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '連線', exact: true }).click()
      await page.getByRole('button', { name: '更改…', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '更改連線方式', exact: true })
      if (kind === 'direct') {
        await dialog.getByRole('radio', { name: '直接連線', exact: true }).click()
        await dialog.getByLabel('伺服器位址', { exact: true }).fill(rig.base)
        await page.screenshot({ path: test.info().outputPath(`${name}-form.png`) })
        await dialog.getByRole('button', { name: '確認並連線', exact: true }).click()
      } else {
        await dialog.getByRole('radio', { name: '通過 SSH', exact: true }).click()
        await fillSsh(dialog, { address: 'yuki@127.0.0.1', port: host.port, password })
        await dialog.getByRole('button', { name: '檢查主機', exact: true }).click()
        await expect(dialog.getByLabel('主機指紋', { exact: true })).toHaveValue(host.fingerprint)
        await page.screenshot({ path: test.info().outputPath(`${name}-form.png`) })
        await dialog.getByRole('button', { name: '確認指紋並連接', exact: true }).click()
      }
      await expect(dialog).toHaveCount(0, { timeout: 60000 })
      // The one 連線方式 row names the address, or the SSH login, now in use.
      await expect(
        page.locator('[data-settings-row]').filter({ hasText: '連線方式' }),
      ).toContainText(kind === 'direct' ? rig.base : 'yuki@127.0.0.1')
      await page.screenshot({ path: test.info().outputPath(`${name}-done.png`) })
      await page.keyboard.press('Escape')
      return currentConnection(page)
    }
    const direct = await switchTo('direct', 'switch-01-direct')
    expect(direct).toEqual({ ...original, baseUrl: rig.base, transport: { kind: 'direct' } })
    expect(JSON.parse(await readFile(configPath, 'utf8')).url).toBe(
      rig.base.replace('http:', 'ws:') + '/agents/v1/connect',
    )
    const back = await switchTo('ssh', 'switch-02-ssh')
    if (back.transport?.kind !== 'ssh') throw Error('Expected SSH again')
    expect(back).toEqual({
      ...original,
      baseUrl: `http://127.0.0.1:${back.transport.localPort}`,
      transport: back.transport,
    })
    expect(JSON.parse(await readFile(configPath, 'utf8')).url).toBe(
      `ws://127.0.0.1:${back.transport.localPort}/agents/v1/connect`,
    )
    // One connection, never re-paired, and the original conversation is still there.
    const after = await page.evaluate(async () => ({
      connections: await window.yuki.client.connections(),
      pending: await window.yuki.client.pendingPairings(),
    }))
    expect(after.connections.ok && after.connections.value.length).toBe(1)
    expect(after.pending.ok && after.pending.value).toEqual([])
    await online(page, back.characterId)
    expect(await events(page, back)).toEqual(expect.arrayContaining(history))
    await writeFile(
      test.info().outputPath('switch.json'),
      JSON.stringify({ original, direct, back }, null, 2),
    )
    expect((await stat(configPath)).isFile()).toBe(true)
    success = true
  } finally {
    await app.close().catch(() => {})
    await host.stop().catch(() => {})
    await rig.close(success)
  }
})
