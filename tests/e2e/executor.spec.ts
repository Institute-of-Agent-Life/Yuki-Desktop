import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import type { Connection } from '../../src/shared/api'
import type { ExecutorView } from '../../src/shared/executor'

async function settings(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('tab', { name: '本機連接', exact: true }).click()
}
async function connection(page: Page) {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok) throw Error(result.code)
    return result.value[0]!
  })
}
async function local(page: Page, owner: Connection) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.executorState(id)
    if (!result.ok) throw Error(result.code)
    return result.value
  }, owner.characterId)
}
async function listed(page: Page, owner: Connection) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.read<ExecutorView[]>(id, { kind: 'executors' })
    if (!result.ok) throw Error(result.code)
    return result.value
  }, owner.characterId)
}
async function choose(app: ElectronApplication, page: Page, path: string) {
  // Keep the product button, IPC, private native mapping and real filesystem;
  // substitute only the native chooser result for repeatable automation.
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, path)
  await page.getByRole('button', { name: '新增資料夾…', exact: true }).click()
  await page.getByRole('textbox', { name: '資料夾別名（可選）' }).fill('收件匣')
  await page.getByRole('button', { name: '選擇資料夾…', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
}
function driver(base: string) {
  return async <T>(path: string, body?: unknown): Promise<T> => {
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
    expect(response.ok).toBe(true)
    return response.json() as Promise<T>
  }
}

test('S10 real buttons grant exact folders, pause, write an original Main artifact and revoke this computer', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ executor: true }),
    app = await rig.launch('executor-ui'),
    request = driver(rig.base),
    folder = join(rig.root, 'private-native-folder')
  let success = false
  try {
    await mkdir(folder)
    await writeFile(join(folder, 'hello.txt'), '真實本機內容')
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const owner = await connection(page)
    await settings(page)
    await page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }).click()
    await expect.poll(async () => (await local(page, owner)).state).toBe('online')
    expect((await local(page, owner)).installation?.persistent).toBe(true)
    await choose(app, page, folder)
    await expect(page.getByRole('switch', { name: '讀取檔案：收件匣', exact: true })).toBeChecked()
    await expect(
      page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true }),
    ).not.toBeChecked()
    const executor = (await local(page, owner)).installation!.executorId
    expect(JSON.stringify(await local(page, owner))).not.toContain(folder)
    expect(JSON.stringify(await listed(page, owner))).not.toContain(folder)
    const read = await request<{ state: string; result: { content_base64: string } }>('invoke', {
      person_id: owner.personId,
      arguments: {
        executor_id: executor,
        capability: 'folder.read',
        params: { mode: 'read', path: '收件匣/hello.txt' },
      },
    })
    expect(read.state).toBe('succeeded')
    expect(Buffer.from(read.result.content_base64, 'base64').toString()).toBe('真實本機內容')
    await page.getByRole('switch', { name: '暫停本機連接', exact: true }).click()
    await expect.poll(async () => (await listed(page, owner))[0]?.paused).toBe(true)
    const before = await request<{ operations: unknown[] }>('state')
    const pausedResponse = await fetch(`${rig.base}/__test/executor/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_id: owner.personId,
        arguments: {
          executor_id: executor,
          capability: 'folder.read',
          params: { mode: 'read', path: '收件匣/hello.txt' },
        },
      }),
    })
    expect(pausedResponse.status).toBe(409)
    expect((await pausedResponse.json()).problem.code).toBe('executor_paused')
    expect((await request<{ operations: unknown[] }>('state')).operations).toHaveLength(
      before.operations.length,
    )
    await page.getByRole('switch', { name: '暫停本機連接', exact: true }).click()
    await expect.poll(async () => (await listed(page, owner))[0]?.paused).toBe(false)
    await page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true }).click()
    await expect(page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true })).toBeChecked()
    const artifact = await request<{ artifact_id: string; version: string }>('artifact', {})
    await request('script', [
      {
        name: 'local_device',
        arguments: {
          action: 'invoke',
          executor_id: executor,
          capability: 'folder.write',
          params: { path: '收件匣/report.txt', ...artifact, if_absent: true },
        },
      },
      { name: 'send_message', arguments: { text: '原成果已寫入本機收件匣' } },
    ])
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('請寫入原成果')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('原成果已寫入本機收件匣', { exact: true })).toBeVisible({
      timeout: 30000,
    })
    expect((await readFile(join(folder, 'report.txt'))).length).toBeGreaterThan(0)
    expect((await request<{ work_count: number }>('state')).work_count).toBe(0)
    await settings(page)
    await page.getByRole('button', { name: '操作紀錄', exact: true }).click()
    await expect(page.getByRole('dialog').getByText('已確認', { exact: true })).toHaveCount(2)
    await page.screenshot({ path: test.info().outputPath('executor-history-confirmed.png') })
    await page.getByRole('button', { name: '完成', exact: true }).click()
    await page.screenshot({ path: test.info().outputPath('executor-s10-grants.png') })
    await page.getByRole('button', { name: '移除此電腦…', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '移除', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }),
    ).toBeVisible()
    expect(await listed(page, owner)).toEqual([])
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('actual Electron SIGKILL recovers a finished result without rewriting and reports cold acknowledged uncertainty', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ executor: true }),
    proxy = await forwardProxy(rig.base, '/executor-crash'),
    request = driver(rig.base),
    folder = join(rig.root, 'crash-target')
  let app = await rig.launch('executor-crash'),
    success = false
  try {
    await mkdir(folder)
    let page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code())
    const owner = await connection(page)
    await settings(page)
    await page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }).click()
    await expect.poll(async () => (await local(page, owner)).state).toBe('online')
    await choose(app, page, folder)
    await page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true }).click()
    await expect(page.getByRole('switch', { name: '寫入檔案：收件匣', exact: true })).toBeChecked()
    const executor = (await local(page, owner)).installation!.executorId
    proxy.faults.rejectPostSuffixes.add('/result')
    const invoke = (name: string) =>
      request<{ state: string; observation?: { matches_intended: boolean } }>('invoke', {
        person_id: owner.personId,
        arguments: {
          executor_id: executor,
          capability: 'folder.write',
          params: {
            path: `收件匣/${name}`,
            content_base64: Buffer.from('original bytes').toString('base64'),
            if_absent: true,
          },
        },
      })
    const first = invoke('once.txt')
    await expect
      .poll(async () => {
        try {
          return await readFile(join(folder, 'once.txt'), 'utf8')
        } catch {
          return ''
        }
      })
      .toBe('original bytes')
    await expect.poll(async () => (await local(page, owner)).problem).toBe('unavailable')
    await writeFile(join(folder, 'once.txt'), 'later edit must survive')
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    proxy.faults.rejectPostSuffixes.clear()
    app = await rig.launch('executor-crash')
    page = await app.firstWindow()
    expect((await first).state).toBe('succeeded')
    expect(await readFile(join(folder, 'once.txt'), 'utf8')).toBe('later edit must survive')
    await expect.poll(async () => (await local(page, owner)).state).toBe('online')
    proxy.faults.holdResponseSuffixes.add('/ack')
    const second = invoke('never-started.txt')
    await expect
      .poll(
        async () =>
          (await request<{ operations: { state: string }[] }>('state')).operations.filter(
            (operation) => operation.state === 'acknowledged',
          ).length,
      )
      .toBe(1)
    await expect(readFile(join(folder, 'never-started.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    proxy.faults.holdResponseSuffixes.clear()
    app = await rig.launch('executor-crash')
    page = await app.firstWindow()
    expect((await second).state).toBe('unknown')
    await expect(readFile(join(folder, 'never-started.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await settings(page)
    await page.getByRole('button', { name: '操作紀錄', exact: true }).click()
    await expect(page.getByRole('dialog').getByText('結果未確認', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '重做', exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('executor-cold-unknown.png') })
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('lost create and revoke replies recover across actual cold starts, then a native notification stays submitted', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ executor: true }),
    proxy = await forwardProxy(rig.base, '/desktop'),
    request = driver(rig.base)
  let observer: ElectronApplication | undefined
  let app = await rig.launch('executor-setup-loss'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code())
    const owner = await connection(page)
    await settings(page)
    proxy.faults.loseNextSuffix = '/executors'
    await page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }).click()
    await expect.poll(() => proxy.lostStatuses.length).toBe(1)
    expect(proxy.lostStatuses).toEqual([200])
    await expect(page.getByText('未完成設定的電腦', { exact: true })).toBeVisible()
    const orphan = (await listed(page, owner))[0]!
    expect(orphan.claimed).toBe(false)
    const firstCreate = proxy.calls.find(
      (call) => call.method === 'POST' && call.path.endsWith('/executors'),
    )!
    expect(firstCreate.requestId).toBeTruthy()
    await page.screenshot({ path: test.info().outputPath('executor-unclaimed.png') })
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    proxy.faults.holdReceipts = false
    proxy.faults.loseNextSuffix = `/executors/${orphan.executor_id}`
    app = await rig.launch('executor-setup-loss')
    page = await app.firstWindow()
    await expect.poll(() => proxy.lostStatuses.length).toBe(2)
    const deletion = proxy.calls.find(
      (call) => call.method === 'DELETE' && call.path.endsWith(orphan.executor_id),
    )!
    expect(deletion.requestId).toBeTruthy()
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    proxy.faults.holdReceipts = false
    app = await rig.launch('executor-setup-loss')
    page = await app.firstWindow()
    await expect
      .poll(async () => (await local(page, owner)).state, { timeout: 15000 })
      .toBe('online')
    const rows = await listed(page, owner)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.executor_id).not.toBe(orphan.executor_id)
    expect(
      proxy.calls.filter(
        (call) => call.method === 'DELETE' && call.path.endsWith(orphan.executor_id),
      ),
    ).toHaveLength(1)
    expect(
      proxy.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/executors')),
    ).toHaveLength(2)
    expect(
      proxy.calls.some((call) => call.path.endsWith(`/requests/${firstCreate.requestId}`)),
    ).toBe(true)
    expect(proxy.calls.some((call) => call.path.endsWith(`/requests/${deletion.requestId}`))).toBe(
      true,
    )
    await settings(page)
    await page.getByRole('switch', { name: '允許顯示通知', exact: true }).click()
    await expect(page.getByRole('switch', { name: '允許顯示通知', exact: true })).toBeChecked()
    const submitted = await request<{ state: string; level: string }>('invoke', {
      person_id: owner.personId,
      arguments: {
        executor_id: rows[0]!.executor_id,
        capability: 'notify',
        params: { title: 'Yuki 本機驗證', body: '這筆回執僅表示已交給系統。' },
      },
    })
    expect(submitted).toMatchObject({ state: 'succeeded', level: 'submitted' })
    await page.getByRole('button', { name: '操作紀錄', exact: true }).click()
    await expect(page.getByRole('dialog').getByText('已交給系統', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog').getByText('已確認', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('executor-native-submitted.png') })
    await page.getByRole('button', { name: '完成', exact: true }).click()
    observer = await rig.launch('executor-other-device')
    const otherPage = await observer.firstWindow()
    await pairUI(otherPage, proxy.base, await rig.code())
    await settings(otherPage)
    await expect(
      otherPage.getByRole('heading', { name: '本人的其他電腦', exact: true }),
    ).toBeVisible()
    await otherPage.getByRole('button', { name: '移除…', exact: true }).click()
    await otherPage.getByRole('dialog').getByRole('button', { name: '移除', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '清除此電腦的失效設定', exact: true }),
    ).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: '清除此電腦的失效設定', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }),
    ).toBeVisible()
    expect(await listed(page, owner)).toEqual([])
    success = true
  } finally {
    await observer?.close().catch(() => {})
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('S10 and folder command use the real settings flow in four themes and small workspaces', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ executor: true }),
    app = await rig.launch('executor-visual'),
    folder = join(rig.root, 'visual-folder')
  let success = false
  try {
    await mkdir(folder)
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await page.keyboard.press('Meta+k')
    await page
      .getByRole('combobox', { name: '搜尋已載入的對話、工作與檔案' })
      .fill('授權本機資料夾')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { name: '本機連接', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '允許 Yuki 使用這台電腦', exact: true }).click()
    // The command opens the same confirmation sheet once this computer is enabled.
    await expect(page.getByRole('dialog', { name: '新增資料夾授權', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await choose(app, page, folder)
    await expect(page.getByRole('switch', { name: '讀取檔案：收件匣', exact: true })).toBeChecked()
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900),
      )
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('tab', { name: mode === 'dark' ? '深色' : '淺色', exact: true }).click()
      for (const [name, value] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = page.getByRole('switch', { name, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(value)) await toggle.click()
      }
      await page.getByRole('tab', { name: '本機連接', exact: true }).click()
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
        await page.getByRole('heading', { name: '本機連接', exact: true }).scrollIntoViewIfNeeded()
        await page.screenshot({
          path: test.info().outputPath(`darwin-2x-${mode}-executor-${width}x${height}.png`),
          animations: 'disabled',
        })
        await page.getByRole('button', { name: '新增資料夾…', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: '新增資料夾授權', exact: true })
        await expect(dialog.getByRole('textbox')).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused()
        await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeInViewport()
        await page.keyboard.press('Tab')
        await expect(dialog.getByRole('button', { name: '選擇資料夾…', exact: true })).toBeFocused()
        await expect(
          dialog.getByRole('button', { name: '選擇資料夾…', exact: true }),
        ).toBeInViewport()
        await page.screenshot({
          path: test.info().outputPath(`darwin-2x-${mode}-executor-sheet-${width}x${height}.png`),
          animations: 'disabled',
        })
        await page.keyboard.press('Escape')
        await expect(page.getByRole('button', { name: '新增資料夾…', exact: true })).toBeFocused()
      }
    }
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})
