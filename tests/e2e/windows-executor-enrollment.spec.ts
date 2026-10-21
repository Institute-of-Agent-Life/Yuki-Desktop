import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Connection, OriginalRequest } from '../../src/shared/api'
import type { ExecutorView } from '../../src/shared/executor'
import { pairUI } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { launchShell } from '../fixtures/shell-app'
import { completeWindowsFileDialog, windowsFileDialogOwner } from '../fixtures/windows-file-dialog'

function expectNonSecret(value: unknown) {
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    expect(key).not.toMatch(/token|authorization|secret/i)
    expectNonSecret(item)
  }
}
async function connection(page: Page) {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok || !result.value[0]) throw Error('Original connection missing')
    return result.value[0]
  })
}
async function listed(page: Page, owner: Connection) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.read<ExecutorView[]>(id, { kind: 'executors' })
    if (!result.ok) throw Error(result.code)
    return result.value
  }, owner.characterId)
}
async function settings(page: Page) {
  await page.keyboard.press('Control+,')
  await page.getByRole('tab', { name: '本機連接', exact: true }).click()
}

test('Windows executor enrollment recovers lost creation and revocation then rejects offline requests without queuing', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an isolated reference server with the executor fixture')
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-executor-enrollment-'))
  const folder = join(data, 'explicit-requests-only')
  const alias = `恢復驗證-${randomUUID().slice(0, 8)}`
  await mkdir(folder)
  const proxy = await forwardProxy(base!, '/windows-executor-enrollment')
  let app = await launchShell(join(data, 'profile'))
  let mainPid: number | undefined = await app.evaluate(() => process.pid)
  let observer: ElectronApplication | undefined
  let observerPid: number | undefined
  let appClosed = false
  const cleanupErrors: unknown[] = []
  try {
    let page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const code = async () => {
      const response = await fetch(`${base}/__test/link-code`, { method: 'POST' })
      expect(response.ok).toBe(true)
      return ((await response.json()) as { code: string }).code
    }
    await pairUI(page, proxy.base, await code(), 'Windows 設定回應遺失', 20000)
    const owner = await connection(page)
    expect(owner.persistentCredentials).toBe(true)
    const local = () =>
      page.evaluate(async (id) => {
        const result = await window.yuki.client.executorState(id)
        if (!result.ok) throw Error(result.code)
        return result.value
      }, owner.characterId)
    const before = await listed(page, owner)
    const native = await app.evaluate(({ app, BrowserWindow }) => ({
      pid: process.pid,
      browserPid: app.getAppMetrics().find((item) => item.type === 'Browser')?.pid,
      platform: process.platform,
      arch: process.arch,
      executable: app.getPath('exe'),
      packaged: app.isPackaged,
      sandboxed: app
        .getAppMetrics()
        .find((item) => item.pid === BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId())
        ?.sandboxed,
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    }))
    expect(native).toMatchObject({
      pid: mainPid,
      browserPid: mainPid,
      platform: 'win32',
      arch: 'x64',
      executable: process.env.YUKI_ELECTRON_EXECUTABLE,
      packaged: true,
      sandboxed: true,
      noSandbox: false,
    })
    const proof: Record<string, unknown> = { native, owner, stages: [] }
    const stages = proof.stages as unknown[]
    const save = () =>
      writeFile(
        test.info().outputPath('windows-executor-enrollment.json'),
        JSON.stringify(proof, null, 2) + '\n',
      )
    const stop = async () => {
      const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
      expect(process.kill(mainPid!, 'SIGKILL')).toBe(true)
      mainPid = undefined
      await exited
      await app.close()
      appClosed = true
    }
    const reopen = async () => {
      app = await launchShell(join(data, 'profile'))
      appClosed = false
      mainPid = await app.evaluate(() => process.pid)
      page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      expect(await connection(page)).toEqual(owner)
    }
    await settings(page)
    proxy.faults.loseNextSuffix = '/executors'
    await page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }).click()
    await expect.poll(() => proxy.lostStatuses.length).toBe(1)
    expect(proxy.lostStatuses).toEqual([200])
    await expect(page.getByText('未完成設定的電腦', { exact: true })).toBeVisible()
    const added = (await listed(page, owner)).filter(
      (row) => !before.some((old) => old.executor_id === row.executor_id),
    )
    expect(added).toHaveLength(1)
    const orphan = added[0]!
    expect(orphan).toMatchObject({ claimed: false, online: false, last_seen_at: null })
    expect((await local()).installation).toBeNull()
    expectNonSecret(orphan)
    const firstCreate = proxy.calls.find(
      (call) => call.method === 'POST' && call.path.endsWith('/executors'),
    )!
    expect(firstCreate.requestId).toBeTruthy()
    stages.push({ stage: 'create-committed-response-lost', orphan, firstCreate })
    await save()
    await page.screenshot({ path: test.info().outputPath('windows-executor-unclaimed.png') })
    await stop()
    proxy.faults.holdReceipts = false
    proxy.faults.loseNextSuffix = `/executors/${orphan.executor_id}`
    await reopen()
    await expect.poll(() => proxy.lostStatuses.length).toBe(2)
    expect(proxy.lostStatuses).toEqual([200, 200])
    const deletion = proxy.calls.find(
      (call) => call.method === 'DELETE' && call.path.endsWith(orphan.executor_id),
    )!
    expect(deletion.requestId).toBeTruthy()
    expect((await listed(page, owner)).some((row) => row.executor_id === orphan.executor_id)).toBe(
      false,
    )
    stages.push({ stage: 'orphan-revoked-response-lost', deletion, nativePid: mainPid })
    await save()
    await stop()
    proxy.faults.holdReceipts = false
    await reopen()
    await expect.poll(async () => (await local()).state, { timeout: 15000 }).toBe('online')
    const executorId = (await local()).installation!.executorId
    expect((await local()).installation!.persistent).toBe(true)
    const replacements = (await listed(page, owner)).filter(
      (row) => !before.some((old) => old.executor_id === row.executor_id),
    )
    expect(replacements).toHaveLength(1)
    expect(replacements[0]).toMatchObject({ executor_id: executorId, claimed: true, online: true })
    expect(executorId).not.toBe(orphan.executor_id)
    const creates = proxy.calls.filter(
      (call) => call.method === 'POST' && call.path.endsWith('/executors'),
    )
    expect(creates).toHaveLength(2)
    expect(creates[1]!.requestId).not.toBe(firstCreate.requestId)
    expect(
      proxy.calls.filter(
        (call) => call.method === 'DELETE' && call.path.endsWith(orphan.executor_id),
      ),
    ).toHaveLength(1)
    for (const requestId of [firstCreate.requestId!, deletion.requestId!]) {
      expect(proxy.calls.some((call) => call.path.endsWith(`/requests/${requestId}`))).toBe(true)
      const receipt = await page.evaluate(
        async ({ id, requestId }) => {
          const result = await window.yuki.client.read<OriginalRequest>(id, {
            kind: 'request',
            requestId,
          })
          if (!result.ok) throw Error(result.code)
          return result.value
        },
        { id: owner.characterId, requestId },
      )
      expect(receipt.found).toBe(true)
      expectNonSecret(receipt)
    }
    const commands = await page.evaluate(async (id) => {
      const result = await window.yuki.client.executorCommands(id)
      if (!result.ok) throw Error(result.code)
      return result.value
    }, owner.characterId)
    expect(commands).toHaveLength(3)
    expect(commands.every((item) => item.state === 'result' && item.problem === null)).toBe(true)
    expectNonSecret(commands)
    expectNonSecret(await listed(page, owner))
    stages.push({ stage: 'replacement-claimed-original-owner', executorId, creates, commands })
    await save()
    await settings(page)
    await page.getByRole('button', { name: '新增資料夾…', exact: true }).click()
    await page.getByRole('textbox', { name: '資料夾別名（可選）', exact: true }).fill(alias)
    const dialogOwner = await windowsFileDialogOwner(app)
    await page.getByRole('button', { name: '選擇資料夾…', exact: true }).click()
    const receipt = await completeWindowsFileDialog(dialogOwner, folder, 'folder')
    await page.getByRole('switch', { name: `寫入檔案：${alias}`, exact: true }).click()
    await expect(
      page.getByRole('switch', { name: `寫入檔案：${alias}`, exact: true }),
    ).toBeChecked()
    observer = await launchShell(join(data, 'observer'))
    observerPid = await observer.evaluate(() => process.pid)
    const otherPage = await observer.firstWindow()
    await otherPage.waitForLoadState('domcontentloaded')
    await pairUI(otherPage, base!, await code(), 'Windows 離線觀察入口', 20000)
    const other = await connection(otherPage)
    expect(other.personId).toBe(owner.personId)
    expect(other.deviceId).not.toBe(owner.deviceId)
    expect(other.bindingId).toBe(owner.bindingId)
    expect(other.conversationId).toBe(owner.conversationId)
    const currentIds = () =>
      fetch(`${base}/__test/executor/state`).then(async (response) => {
        expect(response.ok).toBe(true)
        return ((await response.json()) as { operations: { op_id: string }[] }).operations.map(
          (item) => item.op_id,
        )
      })
    const beforeOffline = await currentIds()
    // Close the real App. An independent authenticated device observes the server, without
    // keeping the original executor transport or credentials alive in a fixture.
    await app.close()
    appClosed = true
    mainPid = undefined
    await expect
      .poll(
        async () =>
          (await listed(otherPage, other)).find((row) => row.executor_id === executorId)?.online,
      )
      .toBe(false)
    const invoke = () =>
      fetch(`${base}/__test/executor/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person_id: owner.personId,
          arguments: {
            executor_id: executorId,
            capability: 'folder.write',
            params: {
              path: `${alias}/explicit.txt`,
              content_base64: Buffer.from('explicit request after reconnect').toString('base64'),
              if_absent: true,
            },
          },
        }),
      })
    const offline = await invoke()
    expect(offline.status).toBe(409)
    expect((await offline.json()).problem.code).toBe('executor_offline')
    expect(await currentIds()).toEqual(beforeOffline)
    await expect(readFile(join(folder, 'explicit.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    stages.push({ stage: 'app-closed-offline-not-queued', receipt, nativePid: observerPid })
    await save()
    await reopen()
    await expect.poll(async () => (await local()).state).toBe('online')
    expect((await local()).installation!.executorId).toBe(executorId)
    expect(await currentIds()).toEqual(beforeOffline)
    await expect(readFile(join(folder, 'explicit.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const explicit = await invoke()
    expect(explicit.ok).toBe(true)
    const result = (await explicit.json()) as { op_id: string; state: string; level: string }
    expect(result).toMatchObject({ state: 'succeeded', level: 'confirmed' })
    expect((await currentIds()).filter((id) => !beforeOffline.includes(id))).toEqual([result.op_id])
    expect(await readFile(join(folder, 'explicit.txt'), 'utf8')).toBe(
      'explicit request after reconnect',
    )
    await settings(otherPage)
    const target = otherPage.getByText(`已授權：${alias}`, { exact: true }).locator('..')
    await expect(target).toHaveCount(1)
    await target.getByRole('button', { name: '移除…', exact: true }).click()
    await otherPage.getByRole('dialog').getByRole('button', { name: '移除', exact: true }).click()
    await settings(page)
    await expect(
      page.getByRole('button', { name: '清除此電腦的失效設定', exact: true }),
    ).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: '清除此電腦的失效設定', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }),
    ).toBeVisible()
    expect((await local()).installation).toBeNull()
    expect(await listed(otherPage, other)).toEqual(before)
    expect(await readFile(join(folder, 'explicit.txt'), 'utf8')).toBe(
      'explicit request after reconnect',
    )
    stages.push({ stage: 'new-explicit-request-then-cross-device-revoke', result, observer: other })
    proof.complete = true
    await save()
    await page.screenshot({ path: test.info().outputPath('windows-executor-revoked.png') })
  } finally {
    for (const pid of [mainPid, observerPid])
      if (pid)
        try {
          process.kill(pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') cleanupErrors.push(error)
        }
    if (!appClosed) await app.close().catch((error) => cleanupErrors.push(error))
    await observer?.close().catch((error) => cleanupErrors.push(error))
    await proxy.close()
    console.log(`Windows executor enrollment evidence profile: ${data}`)
  }
  expect(cleanupErrors).toEqual([])
})
