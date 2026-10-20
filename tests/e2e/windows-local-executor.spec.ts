import { expect, test } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecutorView, LocalExecutorState } from '../../src/shared/executor'
import { pairUI } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'
import { completeWindowsFileDialog, windowsFileDialogOwner } from '../fixtures/windows-file-dialog'

interface Operation {
  op_id: string
  state: string
  level?: string
  result: { content_base64?: string; sha256?: string; size?: number; reason?: string }
}
interface ExecutorFacts {
  operations: {
    op_id: string
    tool_call_key: string
    work_id: string | null
    state: string
    capability: string
  }[]
  work_count: number
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

test('Windows native local executor grants a real folder, rejects a junction escape, writes original artifacts and revokes access', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an isolated reference server with the executor fixture')
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(
      `${base}/__test/executor/${path}`,
      body === undefined
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    )
    expect(response.ok, await response.clone().text()).toBe(true)
    return response.json() as Promise<T>
  }
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-executor-'))
  const folder = join(data, '本機收件匣')
  const outside = join(data, '未授權位置')
  await mkdir(folder)
  await mkdir(outside)
  const input = Buffer.from(`只讀取授權範圍 ${randomUUID()}`)
  const privateInput = Buffer.from(`不能經 junction 取得 ${randomUUID()}`)
  await writeFile(join(folder, 'hello.txt'), input)
  await writeFile(join(outside, 'private.txt'), privateInput)
  await symlink(outside, join(folder, 'escape'), 'junction')
  const app = await launchShell(join(data, 'profile'))
  const mainPid = await app.evaluate(() => process.pid)
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const link = await fetch(`${base}/__test/link-code`, { method: 'POST' })
    expect(link.ok).toBe(true)
    await pairUI(
      page,
      base!,
      ((await link.json()) as { code: string }).code,
      'Windows 原生執行器',
      20000,
    )
    const native = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        pid: process.pid,
        executable: app.getPath('exe'),
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
        sandboxed: app
          .getAppMetrics()
          .find((item) => item.pid === window.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    expect(native).toMatchObject({
      pid: mainPid,
      executable: process.env.YUKI_ELECTRON_EXECUTABLE,
      platform: 'win32',
      arch: 'x64',
      packaged: true,
      sandboxed: true,
      noSandbox: false,
    })
    await writeFile(
      test.info().outputPath('windows-native-executor-before.json'),
      JSON.stringify({ native, data }, null, 2) + '\n',
    )
    const connections = await page.evaluate(() => window.yuki.client.connections())
    if (!connections.ok) throw Error(connections.code)
    const owner = connections.value[0]!
    const local = async (): Promise<LocalExecutorState> =>
      page.evaluate(async (id) => {
        const result = await window.yuki.client.executorState(id)
        if (!result.ok) throw Error(result.code)
        return result.value
      }, owner.characterId)
    const listed = async (): Promise<ExecutorView[]> =>
      page.evaluate(async (id) => {
        const result = await window.yuki.client.read<ExecutorView[]>(id, { kind: 'executors' })
        if (!result.ok) throw Error(result.code)
        return result.value
      }, owner.characterId)
    await page.keyboard.press('Control+,')
    await page.getByRole('tab', { name: '本機連接', exact: true }).click()
    await page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }).click()
    await expect.poll(async () => (await local()).state).toBe('online')
    expect((await local()).installation?.persistent).toBe(true)
    const executorId = (await local()).installation!.executorId
    await page.getByRole('button', { name: '新增資料夾…', exact: true }).click()
    await page.getByRole('textbox', { name: '資料夾別名（可選）', exact: true }).fill('收件匣')
    const nativeOwner = await windowsFileDialogOwner(app)
    await page.getByRole('button', { name: '選擇資料夾…', exact: true }).click()
    const receipt = await completeWindowsFileDialog(nativeOwner, folder, 'folder')
    expect(receipt).toMatchObject({
      Action: 'folder',
      DialogClass: '#32770',
      FilenameControl: 1152,
      DefaultButton: 1,
      Method: 'native-win32-controls',
    })
    expect(receipt.SessionId).toBeGreaterThan(0)
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(page.getByRole('switch', { name: '讀取檔案：收件匣', exact: true })).toBeChecked()
    await expect(
      page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true }),
    ).not.toBeChecked()
    const publicState = { local: await local(), server: await listed() }
    const encoded = JSON.stringify(publicState).toLowerCase()
    expect(encoded).not.toContain(JSON.stringify(folder).slice(1, -1).toLowerCase())
    expect(encoded).not.toContain(folder.replaceAll('\\', '/').toLowerCase())
    const invoke = (capability: string, params: Record<string, unknown>) =>
      request<Operation>('invoke', {
        person_id: owner.personId,
        arguments: { executor_id: executorId, capability, params },
      })
    const read = await invoke('folder.read', { mode: 'read', path: '收件匣/hello.txt' })
    expect(read).toMatchObject({
      state: 'succeeded',
      level: 'confirmed',
      result: { sha256: sha256(input), size: input.byteLength },
    })
    expect(Buffer.from(read.result.content_base64!, 'base64')).toEqual(input)
    const escaped = await invoke('folder.read', { mode: 'read', path: '收件匣/escape/private.txt' })
    expect(escaped).toMatchObject({ state: 'failed', result: { reason: 'path_outside_scope' } })
    expect(escaped.result.content_base64).toBeUndefined()
    expect(await readFile(join(outside, 'private.txt'))).toEqual(privateInput)
    await page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true }).click()
    await expect(page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true })).toBeChecked()
    await expect
      .poll(async () =>
        (await listed())
          .find((item) => item.executor_id === executorId)
          ?.grants.some((grant) => grant.capability === 'folder.write'),
      )
      .toBe(true)
    const artifact = await request<{ artifact_id: string; version: string }>('artifact', {})
    const written = await invoke('folder.write', {
      path: '收件匣/artifact.txt',
      ...artifact,
      if_absent: true,
    })
    expect(written).toMatchObject({
      state: 'succeeded',
      level: 'confirmed',
      result: { sha256: artifact.version },
    })
    const target = join(folder, 'artifact.txt')
    const stored = await readFile(target)
    expect(sha256(stored)).toBe(artifact.version)
    expect(written.result.size).toBe(stored.byteLength)
    const originalStat = await stat(target, { bigint: true })
    const duplicate = await invoke('folder.write', {
      path: '收件匣/artifact.txt',
      content_base64: Buffer.from('不可覆寫原成果').toString('base64'),
      if_absent: true,
    })
    expect(duplicate).toMatchObject({ state: 'failed', result: { reason: 'already_exists' } })
    const afterDuplicate = await stat(target, { bigint: true })
    expect(afterDuplicate.ino).toBe(originalStat.ino)
    expect(afterDuplicate.mtimeNs).toBe(originalStat.mtimeNs)
    expect(await readFile(target)).toEqual(stored)
    await page.getByRole('switch', { name: '暫停本機連接', exact: true }).click()
    await expect
      .poll(async () => (await listed()).find((item) => item.executor_id === executorId)?.paused)
      .toBe(true)
    const beforePause = await request<ExecutorFacts>('state')
    const paused = await fetch(`${base}/__test/executor/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_id: owner.personId,
        arguments: {
          executor_id: executorId,
          capability: 'folder.read',
          params: { mode: 'read', path: '收件匣/hello.txt' },
        },
      }),
    })
    expect(paused.status).toBe(409)
    expect((await paused.json()).problem.code).toBe('executor_paused')
    expect((await request<ExecutorFacts>('state')).operations).toHaveLength(
      beforePause.operations.length,
    )
    await page.getByRole('switch', { name: '暫停本機連接', exact: true }).click()
    await expect
      .poll(async () => (await listed()).find((item) => item.executor_id === executorId)?.paused)
      .toBe(false)
    const completion = `主程序已確認本機成果 ${randomUUID()}`
    const beforeMain = await request<ExecutorFacts>('state')
    await request('script', [
      {
        name: 'local_device',
        arguments: {
          action: 'invoke',
          executor_id: executorId,
          capability: 'folder.write',
          params: { path: '收件匣/from-main.txt', ...artifact, if_absent: true },
        },
      },
      { name: 'send_message', arguments: { text: completion } },
    ])
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page
      .getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
      .fill('請把原成果寫入已授權的本機收件匣')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText(completion, { exact: true })).toBeVisible({ timeout: 30000 })
    expect(sha256(await readFile(join(folder, 'from-main.txt')))).toBe(artifact.version)
    const afterMain = await request<ExecutorFacts>('state')
    const mainOperation = afterMain.operations.filter(
      (item) => !beforeMain.operations.some((before) => before.op_id === item.op_id),
    )
    expect(mainOperation).toHaveLength(1)
    expect(mainOperation[0]).toMatchObject({
      state: 'succeeded',
      capability: 'folder.write',
      work_id: null,
    })
    expect(mainOperation[0]!.tool_call_key).not.toMatch(/^fixture:/)
    expect(afterMain.work_count).toBe(0)
    await page.keyboard.press('Control+,')
    await page.getByRole('tab', { name: '本機連接', exact: true }).click()
    const ownActions = page.getByRole('button', { name: '移除此電腦…', exact: true }).locator('..')
    await ownActions.getByRole('button', { name: '操作紀錄', exact: true }).click()
    await expect(page.getByRole('dialog').getByText('已確認', { exact: true })).toHaveCount(3)
    await expect(page.getByRole('button', { name: '重做', exact: true })).toHaveCount(0)
    await page.screenshot({
      path: test.info().outputPath('windows-native-executor-history.png'),
      animations: 'disabled',
    })
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.getByRole('button', { name: '移除此電腦…', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '移除', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }),
    ).toBeVisible()
    expect((await listed()).some((item) => item.executor_id === executorId)).toBe(false)
    expect(await readFile(target)).toEqual(stored)
    await writeFile(
      test.info().outputPath('windows-native-executor.json'),
      JSON.stringify(
        {
          native,
          receipt,
          executorId,
          publicState,
          read: { ...read, result: { ...read.result, content_base64: undefined } },
          junctionRefusal: escaped,
          artifact,
          written,
          noOverwrite: {
            inode: originalStat.ino.toString(),
            mtimeNs: originalStat.mtimeNs.toString(),
            sha256: sha256(stored),
          },
          duplicate,
          mainOperation,
          workCount: afterMain.work_count,
          pauseRejectedWithoutOperation: true,
          revoked: true,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    process.kill(mainPid, 'SIGKILL')
    await app.close()
    console.log(`Windows local executor evidence profile: ${data}`)
  }
})
