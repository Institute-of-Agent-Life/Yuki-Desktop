import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Connection } from '../../src/shared/api'
import { pairUI } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { launchShell } from '../fixtures/shell-app'
import { completeWindowsFileDialog, windowsFileDialogOwner } from '../fixtures/windows-file-dialog'

interface JournalRow {
  op_id: string
  phase: 'started' | 'finished'
}
interface Facts {
  operations: { op_id: string; state: string }[]
}
interface Result {
  op_id: string
  state: string
  level?: string
  observation?: { exists: boolean; matches_intended?: boolean }
}

async function journal(app: ElectronApplication, owner: Connection, executorId: string) {
  return app.evaluate(
    ({ app }, args) => {
      const path = process.getBuiltinModule('node:path')
      const module = process.getBuiltinModule('node:module')
      const packagedRequire = module.createRequire(path.join(app.getAppPath(), 'package.json'))
      const Database = packagedRequire('better-sqlite3') as typeof import('better-sqlite3')
      const filename = path.join(
        app.getPath('userData'),
        'connections',
        args.owner.characterId,
        'outbox',
        args.owner.personId,
        args.owner.bindingId + '.sqlite3',
      )
      // Observe only the test profile's committed journal; never create or update its rows.
      const database = new Database(filename, { readonly: true, fileMustExist: true })
      try {
        return database
          .prepare(
            'SELECT op_id,phase FROM local_executor_operations WHERE executor_id=? ORDER BY rowid',
          )
          .all(args.executorId) as JournalRow[]
      } finally {
        database.close()
      }
    },
    { owner, executorId },
  )
}

test('Windows executor cold recovery distinguishes finished, accepted ack and unaccepted ack without changing op IDs', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an isolated reference server with the executor fixture')
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-executor-recovery-'))
  const folder = join(data, 'recovery-target')
  await mkdir(folder)
  const proxy = await forwardProxy(base!, '/windows-executor-recovery')
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
  let app = await launchShell(join(data, 'profile'))
  let mainPid: number | undefined = await app.evaluate(() => process.pid)
  const cleanupErrors: unknown[] = []
  try {
    let page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const link = await fetch(`${base}/__test/link-code`, { method: 'POST' })
    expect(link.ok).toBe(true)
    await pairUI(
      page,
      proxy.base,
      ((await link.json()) as { code: string }).code,
      'Windows 原操作冷恢復',
      20000,
    )
    const connections = async () =>
      page.evaluate(async () => {
        const result = await window.yuki.client.connections()
        if (!result.ok || !result.value[0]) throw Error('Original owner missing')
        return result.value[0]
      })
    const owner = await connections()
    expect(owner.persistentCredentials).toBe(true)
    const local = async () =>
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
    await page.keyboard.press('Control+,')
    await page.getByRole('tab', { name: '本機連接', exact: true }).click()
    await page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }).click()
    await expect.poll(async () => (await local()).state).toBe('online')
    const executorId = (await local()).installation!.executorId
    expect((await local()).installation!.persistent).toBe(true)
    await page.getByRole('button', { name: '新增資料夾…', exact: true }).click()
    await page.getByRole('textbox', { name: '資料夾別名（可選）', exact: true }).fill('收件匣')
    const dialogOwner = await windowsFileDialogOwner(app)
    await page.getByRole('button', { name: '選擇資料夾…', exact: true }).click()
    const receipt = await completeWindowsFileDialog(dialogOwner, folder, 'folder')
    expect(receipt.FilenameControl).toBe(1152)
    const rejectedBefore = await request<Facts>('state')
    const denied = await fetch(`${base}/__test/executor/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_id: owner.personId,
        arguments: {
          executor_id: executorId,
          capability: 'folder.write',
          params: {
            path: '收件匣/not-authorized.txt',
            content_base64: Buffer.from('must not write').toString('base64'),
            if_absent: true,
          },
        },
      }),
    })
    expect(denied.ok).toBe(false)
    expect((await denied.json()).problem.code).toBe('permission_denied')
    expect((await request<Facts>('state')).operations).toHaveLength(
      rejectedBefore.operations.length,
    )
    await expect(readFile(join(folder, 'not-authorized.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true }).click()
    await expect(page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true })).toBeChecked()
    const initial = await request<Facts>('state')
    const proof: Record<string, unknown> = {
      native,
      receipt,
      owner,
      executorId,
      deniedStatus: denied.status,
      phases: [],
    }
    const saveProof = () =>
      writeFile(
        test.info().outputPath('windows-executor-recovery.json'),
        JSON.stringify(proof, null, 2) + '\n',
      )
    await saveProof()
    const phaseProofs = proof.phases as unknown[]
    const invoke = (name: string) =>
      request<Result>('invoke', {
        person_id: owner.personId,
        arguments: {
          executor_id: executorId,
          capability: 'folder.write',
          params: {
            path: `收件匣/${name}`,
            content_base64: Buffer.from('original bytes').toString('base64'),
            if_absent: true,
          },
        },
      })
    const newOperation = async (before: Facts) => {
      const added = async () =>
        (await request<Facts>('state')).operations.filter(
          (item) => !before.operations.some((old) => old.op_id === item.op_id),
        )
      await expect.poll(async () => (await added()).length).toBe(1)
      return (await added())[0]!
    }
    const crashAndReopen = async (release: () => void) => {
      const launcher = app.process()
      const exited = new Promise<void>((resolve) => launcher.once('exit', () => resolve()))
      expect(process.kill(mainPid!, 'SIGKILL')).toBe(true)
      mainPid = undefined
      await exited
      await app.close()
      release()
      app = await launchShell(join(data, 'profile'))
      mainPid = await app.evaluate(() => process.pid)
      page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      expect(await connections()).toEqual(owner)
      await expect.poll(async () => (await local()).state).toBe('online')
      expect((await local()).installation!.executorId).toBe(executorId)
    }
    // A finished journal survives process death; a later human edit must not be overwritten.
    proxy.faults.rejectPostSuffixes.add('/result')
    const first = invoke('once.txt')
    const op1 = await newOperation(initial)
    await expect
      .poll(() => readFile(join(folder, 'once.txt'), 'utf8').catch(() => ''))
      .toBe('original bytes')
    await expect.poll(async () => (await local()).problem).toBe('unavailable')
    const finished = await journal(app, owner, executorId)
    expect(finished.find((item) => item.op_id === op1.op_id)?.phase).toBe('finished')
    expect(
      (await request<Facts>('state')).operations.find((item) => item.op_id === op1.op_id)?.state,
    ).toBe('acknowledged')
    await writeFile(join(folder, 'once.txt'), 'later edit must survive')
    const edited = await stat(join(folder, 'once.txt'), { bigint: true })
    phaseProofs.push({
      stage: 'finished-before-result',
      opId: op1.op_id,
      journal: finished,
      nativePid: mainPid,
    })
    await saveProof()
    await crashAndReopen(() => proxy.faults.rejectPostSuffixes.clear())
    expect(await first).toMatchObject({ op_id: op1.op_id, state: 'succeeded', level: 'confirmed' })
    expect(await readFile(join(folder, 'once.txt'), 'utf8')).toBe('later edit must survive')
    expect((await stat(join(folder, 'once.txt'), { bigint: true })).mtimeNs).toBe(edited.mtimeNs)
    await expect
      .poll(async () =>
        (await journal(app, owner, executorId)).some((item) => item.op_id === op1.op_id),
      )
      .toBe(false)
    phaseProofs.push({
      stage: 'finished-replayed-without-write',
      opId: op1.op_id,
      nativePid: mainPid,
      preservedMtimeNs: edited.mtimeNs.toString(),
    })
    await saveProof()
    // Ack committed at the server but its response is withheld before the native effect.
    proxy.faults.holdResponseSuffixes.add('/ack')
    const beforeSecond = await request<Facts>('state')
    const second = invoke('never-started.txt')
    const op2 = await newOperation(beforeSecond)
    await expect
      .poll(
        async () =>
          (await request<Facts>('state')).operations.find((item) => item.op_id === op2.op_id)
            ?.state,
      )
      .toBe('acknowledged')
    await expect.poll(() => [...proxy.held.keys()].some((path) => path.endsWith('/ack'))).toBe(true)
    const startedAccepted = await journal(app, owner, executorId)
    expect(startedAccepted.find((item) => item.op_id === op2.op_id)?.phase).toBe('started')
    await expect(readFile(join(folder, 'never-started.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    phaseProofs.push({
      stage: 'started-ack-accepted-response-held',
      opId: op2.op_id,
      journal: startedAccepted,
      nativePid: mainPid,
    })
    await saveProof()
    await crashAndReopen(() => {
      proxy.faults.holdResponseSuffixes.clear()
    })
    const unknown = await second
    expect(unknown).toMatchObject({
      op_id: op2.op_id,
      state: 'unknown',
      observation: { exists: false },
    })
    await expect(readFile(join(folder, 'never-started.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    phaseProofs.push({
      stage: 'accepted-ack-cold-unknown-without-write',
      result: unknown,
      nativePid: mainPid,
    })
    await saveProof()
    // Before acceptance, the same dispatched ID can acknowledge and execute after restart.
    proxy.faults.rejectPostSuffixes.add('/ack')
    const beforeThird = await request<Facts>('state')
    const third = invoke('before-ack.txt')
    const op3 = await newOperation(beforeThird)
    await expect.poll(async () => (await local()).problem).toBe('unavailable')
    expect(
      (await request<Facts>('state')).operations.find((item) => item.op_id === op3.op_id)?.state,
    ).toBe('dispatched')
    const startedUnaccepted = await journal(app, owner, executorId)
    expect(startedUnaccepted.find((item) => item.op_id === op3.op_id)?.phase).toBe('started')
    await expect(readFile(join(folder, 'before-ack.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    phaseProofs.push({
      stage: 'started-ack-not-accepted',
      opId: op3.op_id,
      journal: startedUnaccepted,
      nativePid: mainPid,
    })
    await saveProof()
    await crashAndReopen(() => proxy.faults.rejectPostSuffixes.clear())
    expect(await third).toMatchObject({ op_id: op3.op_id, state: 'succeeded', level: 'confirmed' })
    expect(await readFile(join(folder, 'before-ack.txt'), 'utf8')).toBe('original bytes')
    const final = await request<Facts>('state')
    expect(
      final.operations
        .filter((item) => !initial.operations.some((old) => old.op_id === item.op_id))
        .map((item) => item.op_id)
        .sort(),
    ).toEqual([op1.op_id, op2.op_id, op3.op_id].sort())
    await expect.poll(async () => (await journal(app, owner, executorId)).length).toBe(0)
    await page.keyboard.press('Control+,')
    await page.getByRole('tab', { name: '本機連接', exact: true }).click()
    await page
      .getByRole('button', { name: '移除此電腦…', exact: true })
      .locator('..')
      .getByRole('button', { name: '操作紀錄', exact: true })
      .click()
    await expect(page.getByRole('dialog').getByText('結果未確認', { exact: true })).toHaveCount(1)
    await expect(page.getByRole('dialog').getByText('已確認', { exact: true })).toHaveCount(2)
    await expect(page.getByRole('button', { name: '重做', exact: true })).toHaveCount(0)
    await page.screenshot({
      path: test.info().outputPath('windows-executor-cold-recovery.png'),
      animations: 'disabled',
    })
    phaseProofs.push({
      stage: 'unaccepted-ack-resumed-original-id',
      result: await third,
      nativePid: mainPid,
      finalStates: final.operations.filter((item) =>
        [op1.op_id, op2.op_id, op3.op_id].includes(item.op_id),
      ),
    })
    proof.complete = true
    await saveProof()
  } finally {
    if (mainPid)
      try {
        process.kill(mainPid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') cleanupErrors.push(error)
      }
    await app.close().catch((error) => cleanupErrors.push(error))
    await proxy.close()
    console.log(`Windows executor recovery evidence profile: ${data}`)
  }
  expect(cleanupErrors).toEqual([])
})
