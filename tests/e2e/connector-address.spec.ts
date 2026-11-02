import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Connection } from '../../src/shared/api'
import type { ConnectorState } from '../../src/shared/connector'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'

test('the original computer keeps its identity across independent client and Connector addresses', async () => {
  test.setTimeout(120000)
  const manifest = JSON.parse(await readFile('.cache/connector-runtime/manifest.json', 'utf8')) as {
    executable: string
    arguments: string[]
  }
  const executable = resolve('.cache/connector-runtime', manifest.executable)
  const rig = await yukiFixture(),
    other = await yukiFixture(),
    oldRoute = await forwardProxy(rig.base, '/original-computer'),
    newRoute = await forwardProxy(rig.base, '/private-network'),
    app = await rig.launch('connector-address')
  let success = false
  let connector: ChildProcessWithoutNullStreams | undefined
  let connectorClosed: Promise<void> | undefined
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await page.evaluate(async () => {
      const result = await window.yuki.client.connections()
      if (!result.ok) throw Error(result.code)
      return result.value[0]!
    })
    // A separate real chat device signs a connector-purpose code for the same Person.
    const chatResponse = await fetch(`${rig.base}/client/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: await rig.code(), device_label: 'Address test setup' }),
    })
    expect(chatResponse.ok).toBe(true)
    const chat = (await chatResponse.json()).data as { token: string }
    const issued = await fetch(`${rig.base}/client/v1/link-codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chat.token}` },
      body: JSON.stringify({ request_id: randomUUID(), purpose: 'connector' }),
    })
    expect(issued.ok).toBe(true)
    const code = (await issued.json()).data.code as string
    const pairedResponse = await fetch(`${rig.base}/agents/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, device_label: 'Original computer' }),
    })
    expect(pairedResponse.ok).toBe(true)
    const paired = (await pairedResponse.json()) as { device_id: string; token: string }
    const dataDirectory = join(rig.root, 'original-connector'),
      configPath = join(dataDirectory, 'config.json'),
      original = {
        url: oldRoute.base.replace('http:', 'ws:') + '/agents/v1/connect',
        device_id: paired.device_id,
        token: paired.token,
        instances: [],
        full_access: false,
      }
    await mkdir(dataDirectory)
    await writeFile(configPath, JSON.stringify(original), { mode: 0o600 })
    const selected = await page.evaluate((input) => window.yuki.connector.useInstallation(input), {
      executable,
      dataDirectory,
    })
    expect(selected.ok).toBe(true)
    const state = await page.evaluate(
      (id) => window.yuki.connector.state(id),
      connection.characterId,
    )
    await writeFile(
      test.info().outputPath('original-device-admission.json'),
      JSON.stringify({ client: connection, connector: state }, null, 2),
    )
    expect(state.ok && state.value.available && state.value.admission?.matched).toBe(true)

    const changed = await page.evaluate(
      ({ id, server }) => window.yuki.client.changeAddress(id, server),
      { id: connection.characterId, server: newRoute.base },
    )
    expect(changed.ok).toBe(true)
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(original)
    oldRoute.faults.offline = true
    await app.evaluate(() => {
      const host = globalThis as typeof globalThis & {
        __connectorAddressProbe: { calls: { url: string; authorized: boolean }[]; restore(): void }
      }
      const fetcher = globalThis.fetch
      const calls: { url: string; authorized: boolean }[] = []
      host.__connectorAddressProbe = {
        calls,
        restore: () => {
          globalThis.fetch = fetcher
        },
      }
      globalThis.fetch = (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (new URL(url).hostname === '100.64.0.1') {
          calls.push({ url, authorized: new Headers(init?.headers).has('Authorization') })
          return Promise.reject(new Error('Refuse a test credential on a plaintext remote target'))
        }
        return fetcher(input, init)
      }
    })
    const insecure = await page.evaluate(
      (id) => window.yuki.connector.server({ characterId: id, server: 'http://100.64.0.1' }),
      connection.characterId,
    )
    const rejectedRequests = await app.evaluate(() => {
      const probe = (
        globalThis as typeof globalThis & {
          __connectorAddressProbe: {
            calls: { url: string; authorized: boolean }[]
            restore(): void
          }
        }
      ).__connectorAddressProbe
      probe.restore()
      return probe.calls
    })
    expect(insecure).toMatchObject({ ok: false, code: 'invalid_server' })
    expect(rejectedRequests).toEqual([])
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(original)
    expect(
      await page.evaluate(async () => {
        const result = await window.yuki.client.connections()
        return result.ok && result.value[0]?.baseUrl
      }),
    ).toBe(newRoute.base)

    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '這台電腦', exact: true }).click()
    await page.getByRole('button', { name: '修改連接器位址', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '修改連接器位址', exact: true }),
      address = dialog.getByRole('textbox', { name: '連接器伺服器位址', exact: true })
    await expect(address).toHaveValue(oldRoute.base)
    await address.fill(other.base)
    await dialog.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(dialog.getByRole('status').filter({ hasText: '另一個 Yuki' })).toBeVisible()
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(original)
    await address.fill(rig.base)
    await dialog.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const saved = JSON.parse(await readFile(configPath, 'utf8')) as typeof original
    expect(saved).toEqual({
      ...original,
      url: rig.base.replace('http:', 'ws:') + '/agents/v1/connect',
    })
    const after = await page.evaluate(async (id) => {
      const connections = await window.yuki.client.connections(),
        state = await window.yuki.connector.state(id)
      return { connections, state }
    }, connection.characterId)
    expect(after.connections.ok && after.connections.value[0]).toEqual({
      ...connection,
      baseUrl: newRoute.base,
    })
    expect(after.state.ok && after.state.value.available && after.state.value.deviceId).toBe(
      paired.device_id,
    )
    const initial = selected.ok ? (selected.value as ConnectorState) : undefined
    expect(after.state.ok && after.state.value.available && after.state.value.running).toEqual(
      initial?.available ? initial.running : undefined,
    )
    await expect(page.getByText('位址已儲存，下次啟動連接時使用。', { exact: true })).toBeVisible()
    connector = spawn(
      executable,
      [...manifest.arguments, '--data-dir', dataDirectory, 'run', '--desktop-stdin'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    )
    connectorClosed = new Promise((resolve) => connector!.once('close', () => resolve()))
    connector.stdout.resume()
    connector.stderr.resume()
    connector.stdin.on('error', () => {})
    await expect
      .poll(async () => {
        const result = await page.evaluate(
          (id) => window.yuki.connector.state(id),
          connection.characterId,
        )
        return result.ok && result.value.available && result.value.admission?.connected
      })
      .toBe(true)
    const nativeId = randomUUID()
    const configured = await page.evaluate(
      ({ id, nativeId, command, script }) =>
        window.yuki.connector.configure(
          {
            id: nativeId,
            create: true,
            driver: 'acp',
            label: 'Original ACP',
            command,
            args: ['-B', script],
          },
          id,
        ),
      {
        id: connection.characterId,
        nativeId,
        command: executable,
        script: resolve(
          process.env.YUKI_BACKEND_TEST_ROOT!,
          'packages/yuki-agent-connector/tests/fakes/acp_agent.py',
        ),
      },
    )
    expect(configured).toMatchObject({ ok: true, value: { instanceId: nativeId } })
    await expect
      .poll(async () => {
        const result = await page.evaluate(
          (id) => window.yuki.connector.state(id),
          connection.characterId,
        )
        return result.ok && result.value.available
          ? result.value.admission?.instances?.find((item) => item.localId === nativeId)?.status
          : undefined
      })
      .toBe('available')
    const renamed = await page.evaluate(
      ({ id, nativeId }) =>
        window.yuki.connector.configure({ id: nativeId, create: false, label: 'Renamed ACP' }, id),
      { id: connection.characterId, nativeId },
    )
    expect(renamed).toMatchObject({ ok: true, value: { instanceId: nativeId } })
    const removed = await page.evaluate(
      ({ id, nativeId }) => window.yuki.connector.remove(nativeId, id),
      { id: connection.characterId, nativeId },
    )
    expect(removed).toMatchObject({ ok: true, value: { instanceId: nativeId } })
    await expect
      .poll(async () => {
        const result = await page.evaluate(
          (id) => window.yuki.connector.state(id),
          connection.characterId,
        )
        return result.ok && result.value.available ? result.value.admission?.instances : undefined
      })
      .toEqual([])
    expect(connector.exitCode).toBeNull()
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual(saved)
    await page.screenshot({ path: test.info().outputPath('original-connector-address.png') })
    await writeFile(
      test.info().outputPath('independent-addresses.json'),
      JSON.stringify(
        {
          originalClient: connection,
          clientAfter: after.connections.ok ? (after.connections.value[0] as Connection) : null,
          originalDevice: original.device_id,
          savedDevice: saved.device_id,
          credentialsUnchanged: saved.token === original.token,
          insecure,
          rejectedRequests,
          connectorAfter: after.state,
          nativeId,
          nativeConfigured: configured,
          nativeRenamed: renamed,
          nativeRemoved: removed,
          originalConnectorPid: connector.pid,
          connectorKeptRunning: connector.exitCode === null,
        },
        null,
        2,
      ),
    )
    success = true
  } finally {
    if (connector) {
      connector.stdin.end()
      await connectorClosed
    }
    await app.close()
    await oldRoute.close()
    await newRoute.close()
    await other.close(success)
    await rig.close(success)
  }
})
