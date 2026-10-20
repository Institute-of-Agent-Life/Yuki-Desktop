import { expect, test, type ElectronApplication } from '@playwright/test'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Connection } from '../../src/shared/api'
import { pairUI } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'

interface Facts {
  work_count: number
  operations: { op_id: string; state: string; tool_call_key: string; work_id: string | null }[]
}
interface Result {
  op_id: string
  state: string
  level?: string | null
  observation?: Record<string, unknown> | null
}

test('Windows native open URL reports submitted and a real journal failure after the OS effect recovers unknown without reopening', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires a fresh isolated reference server with the executor fixture')
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-native-submissions-'))
  const marker = randomUUID()
  const replyText = `已請你的電腦開啟本機驗證頁 ${marker}`
  const hits: { stage: string; userAgent: string }[] = []
  const landing = createServer((request, response) => {
    const stage =
      request.url === `/${marker}/first`
        ? 'first'
        : request.url === `/${marker}/uncertain`
          ? 'uncertain'
          : null
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.setHeader('Content-Security-Policy', "default-src 'none'")
    if (!stage) {
      response.writeHead(404).end()
      return
    }
    hits.push({ stage, userAgent: request.headers['user-agent'] ?? '' })
    response.end(
      '<!doctype html><html lang="zh-Hant"><title>Yuki 本機開啟測試</title><h1>本機開啟測試完成</h1><p>這是本機驗證頁，可以關閉這個分頁。</p></html>',
    )
  })
  await new Promise<void>((resolve) => landing.listen(0, '127.0.0.1', resolve))
  const address = landing.address()
  if (!address || typeof address === 'string') throw Error('No native landing port')
  const url = (stage: string) => `http://127.0.0.1:${address.port}/${marker}/${stage}`
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
  const code = async () => {
    const response = await fetch(`${base}/__test/link-code`, { method: 'POST' })
    expect(response.ok).toBe(true)
    return ((await response.json()) as { code: string }).code
  }
  let app = await launchShell(join(data, 'profile'))
  let mainPid: number | undefined = await app.evaluate(() => process.pid)
  const observer = await launchShell(join(data, 'observer'))
  const observerPid = await observer.evaluate(() => process.pid)
  let faultInstalled = false
  let journalFile: string | undefined
  const cleanupErrors: unknown[] = []
  const journal = (app: ElectronApplication, mode: 'read' | 'fail' | 'repair') =>
    app.evaluate(
      ({ app }, { filename, mode }) => {
        if (!filename) throw Error('Test journal path missing')
        const path = process.getBuiltinModule('node:path')
        const module = process.getBuiltinModule('node:module')
        const require = module.createRequire(path.join(app.getAppPath(), 'package.json'))
        const Database = require('better-sqlite3') as typeof import('better-sqlite3')
        const db = new Database(filename, { fileMustExist: true, readonly: mode === 'read' })
        try {
          if (mode === 'fail')
            db.exec(
              "CREATE TRIGGER test_native_submission_journal_failure BEFORE UPDATE ON local_executor_operations WHEN NEW.phase='finished' BEGIN SELECT RAISE(ABORT,'test journal write failed'); END",
            )
          if (mode === 'repair')
            db.exec('DROP TRIGGER IF EXISTS test_native_submission_journal_failure')
          return db
            .prepare('SELECT op_id,phase FROM local_executor_operations ORDER BY rowid')
            .all() as { op_id: string; phase: string }[]
        } finally {
          db.close()
        }
      },
      { filename: journalFile, mode },
    )
  try {
    let page = await app.firstWindow()
    const other = await observer.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await other.waitForLoadState('domcontentloaded')
    await pairUI(page, base!, await code(), 'Windows 真系統動作', 20000)
    await pairUI(other, base!, await code(), 'Windows 系統動作觀察', 20000)
    const connection = () =>
      page.evaluate(async () => {
        const result = await window.yuki.client.connections()
        if (!result.ok || !result.value[0]) throw Error('Original owner missing')
        return result.value[0]
      })
    const owner: Connection = await connection()
    expect(owner.persistentCredentials).toBe(true)
    const local = () =>
      page.evaluate(async (id) => {
        const result = await window.yuki.client.executorState(id)
        if (!result.ok) throw Error(result.code)
        return result.value
      }, owner.characterId)
    const native = await app.evaluate(({ app, BrowserWindow }) => ({
      pid: process.pid,
      browserPid: app.getAppMetrics().find((item) => item.type === 'Browser')?.pid,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      executable: app.getPath('exe'),
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
      packaged: true,
      executable: process.env.YUKI_ELECTRON_EXECUTABLE,
      sandboxed: true,
      noSandbox: false,
    })
    await page.keyboard.press('Control+,')
    await page.getByRole('tab', { name: '本機連接', exact: true }).click()
    await page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }).click()
    await expect.poll(async () => (await local()).state).toBe('online')
    const executorId = (await local()).installation!.executorId
    journalFile = await app.evaluate(({ app }, owner) => {
      const path = process.getBuiltinModule('node:path')
      return path.join(
        app.getPath('userData'),
        'connections',
        owner.characterId,
        'outbox',
        owner.personId,
        owner.bindingId + '.sqlite3',
      )
    }, owner)
    await page.getByRole('switch', { name: '允許開啟網址', exact: true }).click()
    await expect(page.getByRole('switch', { name: '允許開啟網址', exact: true })).toBeChecked()
    const before = await request<Facts>('state')
    await request('script', [
      {
        name: 'local_device',
        arguments: {
          action: 'invoke',
          executor_id: executorId,
          capability: 'open.url',
          params: { url: url('first') },
        },
      },
      { name: 'send_message', arguments: { text: replyText } },
    ])
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page
      .getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
      .fill(`請開啟本機驗證頁 ${marker}`)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText(replyText, { exact: true })).toBeVisible({
      timeout: 30000,
    })
    await expect
      .poll(() => hits.filter((hit) => hit.stage === 'first').length, { timeout: 30000 })
      .toBe(1)
    expect(hits.find((hit) => hit.stage === 'first')!.userAgent).toMatch(/Mozilla\/.*Windows NT/)
    const after = await request<Facts>('state')
    const added = after.operations.filter(
      (item) => !before.operations.some((old) => old.op_id === item.op_id),
    )
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ state: 'succeeded', work_id: null })
    expect(added[0]!.tool_call_key).not.toMatch(/^fixture:/)
    expect(after.work_count).toBe(0)
    const proof: Record<string, unknown> = {
      native,
      owner,
      executorId,
      mainOperation: added[0],
      hits,
      stages: [],
    }
    const stages = proof.stages as unknown[]
    const save = () =>
      writeFile(
        test.info().outputPath('windows-native-submissions.json'),
        JSON.stringify(proof, null, 2) + '\n',
      )
    await page.keyboard.press('Control+,')
    await page.getByRole('tab', { name: '本機連接', exact: true }).click()
    const openHistory = async () =>
      page
        .getByRole('button', { name: '移除此電腦…', exact: true })
        .locator('..')
        .getByRole('button', { name: '操作紀錄', exact: true })
        .click()
    await openHistory()
    await expect(page.getByRole('dialog').getByText('已交給系統', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('dialog').getByText('已確認', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '完成', exact: true }).click()
    stages.push({ stage: 'ordinary-main-url-submitted-to-the-real-system', hits: [...hits] })
    await save()
    // A real SQLite write failure prevents the finished witness from committing after
    // shell.openExternal has already reached the system browser. No row is assigned.
    await journal(observer, 'fail')
    faultInstalled = true
    const beforeSecond = await request<Facts>('state')
    const pending = request<Result>('invoke', {
      person_id: owner.personId,
      arguments: {
        executor_id: executorId,
        capability: 'open.url',
        params: { url: url('uncertain') },
      },
    })
    await expect
      .poll(() => hits.filter((hit) => hit.stage === 'uncertain').length, { timeout: 30000 })
      .toBe(1)
    expect(hits.find((hit) => hit.stage === 'uncertain')!.userAgent).toMatch(
      /Mozilla\/.*Windows NT/,
    )
    await expect.poll(async () => (await local()).problem).toBe('unknown')
    const second = (await request<Facts>('state')).operations.filter(
      (item) => !beforeSecond.operations.some((old) => old.op_id === item.op_id),
    )
    expect(second).toHaveLength(1)
    expect(second[0]!.state).toBe('acknowledged')
    const rows = await journal(observer, 'read')
    expect(rows.find((row) => row.op_id === second[0]!.op_id)?.phase).toBe('started')
    stages.push({
      stage: 'native-browser-request-arrived-but-finished-write-failed',
      operation: second[0],
      journal: rows,
      hits: [...hits],
      nativePid: mainPid,
    })
    await save()
    const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
    expect(process.kill(mainPid!, 'SIGKILL')).toBe(true)
    mainPid = undefined
    await exited
    await app.close()
    await journal(observer, 'repair')
    faultInstalled = false
    app = await launchShell(join(data, 'profile'))
    mainPid = await app.evaluate(() => process.pid)
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    expect(await connection()).toEqual(owner)
    await expect.poll(async () => (await local()).state).toBe('online')
    expect((await local()).installation!.executorId).toBe(executorId)
    const unknown = await pending
    expect(unknown).toMatchObject({
      op_id: second[0]!.op_id,
      state: 'unknown',
      level: null,
      observation: null,
    })
    expect(hits.filter((hit) => hit.stage === 'first')).toHaveLength(1)
    expect(hits.filter((hit) => hit.stage === 'uncertain')).toHaveLength(1)
    expect(
      (await request<Facts>('state')).operations.filter(
        (item) => !before.operations.some((old) => old.op_id === item.op_id),
      ),
    ).toHaveLength(2)
    await expect.poll(async () => (await journal(observer, 'read')).length).toBe(0)
    stages.push({
      stage: 'original-operation-recovered-unknown-before-ui-history',
      unknown,
      hits: [...hits],
      nativePid: mainPid,
    })
    await save()
    await expect(
      page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true }),
    ).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('windows-cold-conversation-ready.png') })
    await page.keyboard.press('Control+,')
    await page.getByRole('tab', { name: '本機連接', exact: true }).click()
    await openHistory()
    await expect(page.getByRole('dialog').getByText('已交給系統', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('dialog').getByText('結果未確認', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('dialog').getByText('已確認', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重做', exact: true })).toHaveCount(0)
    await page.screenshot({
      path: test.info().outputPath('windows-native-submitted-and-unknown.png'),
    })
    stages.push({
      stage: 'same-operation-cold-unknown-without-a-second-browser-request',
      unknown,
      hits: [...hits],
      nativePid: mainPid,
    })
    proof.complete = true
    await save()
  } finally {
    if (faultInstalled)
      await journal(observer, 'repair').catch((error) => cleanupErrors.push(error))
    for (const pid of [mainPid, observerPid])
      if (pid)
        try {
          process.kill(pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') cleanupErrors.push(error)
        }
    await app.close().catch((error) => cleanupErrors.push(error))
    await observer.close().catch((error) => cleanupErrors.push(error))
    landing.closeAllConnections()
    await new Promise<void>((resolve) => landing.close(() => resolve()))
    console.log(`Windows native submissions evidence profile: ${data}`)
  }
  expect(cleanupErrors).toEqual([])
})
