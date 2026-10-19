import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
async function selected(page: Page) {
  return page.evaluate(async () => {
    const r = await window.yuki.client.connections()
    if (!r.ok) throw Error(r.code)
    return r.value[0]!
  })
}
async function security(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('tab', { name: '裝置與安全', exact: true }).click()
  await expect(page.getByRole('button', { name: '登出…', exact: true })).toBeVisible()
}
async function prepare(page: Page) {
  await page.getByRole('button', { name: '登出…', exact: true }).click()
  await page.getByRole('button', { name: '撤銷憑據並繼續', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '處理本機內容', exact: true })).toBeVisible()
}
async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

test('logout drains a real delayed read; kept original pending content survives a cold choice and another Person cannot read or delete it', async () => {
  test.setTimeout(180000)
  const rig = await yukiFixture({ character: true }),
    proxy = await forwardProxy(rig.base, '/logout')
  let app = await rig.launch('logout-owners'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code(), 'Original owner device')
    const original = await selected(page),
      originalFile = join(
        rig.root,
        'logout-owners',
        'connections',
        original.characterId,
        'outbox',
        original.personId,
        original.bindingId + '.sqlite3',
      )
    proxy.faults.loseNextSuffix = '/messages'
    const sent = '原本人的已接納待確認訊息',
      draft = '原本人仍未送出的私人草稿'
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill(sent)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect.poll(() => proxy.faults.holdReceipts).toBe(true)
    const requestId = proxy.calls.find(
      (c) => c.method === 'POST' && c.path.endsWith('/messages'),
    )!.requestId!
    proxy.faults.holdRequestIds.add(requestId)
    proxy.faults.holdReceipts = false
    await expect(page.getByText('真實帳本回覆', { exact: true })).toBeVisible()
    const seeded = await fetch(`${rig.base}/__test/character-data`, { method: 'POST' })
    expect(seeded.status).toBe(200)
    await page.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await expect(page.getByRole('button', { name: '已核對的記錄 52', exact: false })).toBeVisible()
    await page.keyboard.press('Meta+1')
    const source = join(rig.root, 'private-local-attachment.txt'),
      bytes = Buffer.from('原附件快照內容')
    await writeFile(source, bytes)
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, source)
    await page.getByRole('button', { name: '附加檔案', exact: true }).click()
    await expect(page.getByLabel('待送出附件')).toContainText('可送出')
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill(draft)
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const r = await window.yuki.client.draft(id)
          return r.ok && r.value
        }, original.characterId),
      )
      .toBe(draft)
    await security(page)
    await fetch(`${rig.base}/__test/pause-next-me`, { method: 'POST' })
    await page.getByRole('button', { name: '重新讀取裝置', exact: true }).click()
    await expect
      .poll(
        async () =>
          ((await (await fetch(`${rig.base}/__test/me-blocked`)).json()) as { blocked: boolean })
            .blocked,
      )
      .toBe(true)
    await page.getByRole('button', { name: '登出…', exact: true }).click()
    await page.getByRole('button', { name: '撤銷憑據並繼續', exact: true }).click()
    await expect(
      page.getByText('正在收尾進行中的操作並確認裝置憑據…', { exact: true }),
    ).toBeVisible()
    expect(proxy.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
    await fetch(`${rig.base}/__test/resume-me`, { method: 'POST' })
    let choice = page.getByRole('dialog', { name: '處理本機內容', exact: true })
    await expect(choice).toBeVisible()
    await expect(choice.getByText('1 份草稿', { exact: true })).toBeVisible()
    await expect(choice.getByText('1 項待確認請求', { exact: true })).toBeVisible()
    await expect(choice.getByText('1 個待送附件', { exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      win.setMinimumSize(960, 492)
      win.setContentSize(960, 492)
    })
    await page.screenshot({ path: test.info().outputPath('darwin-2x-logout-choice-960x492.png') })
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900),
    )
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    app = await rig.launch('logout-owners')
    page = await app.firstWindow()
    choice = page.getByRole('dialog', { name: '處理本機內容', exact: true })
    await expect(choice).toBeVisible()
    await page.keyboard.press('Escape')
    const earlyCode = await rig.code(),
      earlyLink = `yuki://pair?${new URLSearchParams({ server: proxy.base, code: earlyCode })}`
    await app.evaluate(
      ({ app }, link) => app.emit('open-url', { preventDefault() {} }, link),
      earlyLink,
    )
    await expect(page.getByLabel('伺服器位址')).toBeVisible()
    await page.getByRole('button', { name: '繼續', exact: true }).click()
    await page.getByRole('button', { name: '配對', exact: true }).click()
    await expect(
      page.getByRole('button', { name: '處理登出中的本機資料', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '處理登出中的本機資料', exact: true }).click()
    await expect(choice).toBeVisible()
    await choice.getByRole('button', { name: '保留並登出', exact: true }).click()
    await expect(page.getByLabel('伺服器位址')).toBeVisible()
    expect(await exists(originalFile)).toBe(true)
    const otherCode = (
      (await (await fetch(`${rig.base}/__test/other-person-code`, { method: 'POST' })).json()) as {
        code: string
      }
    ).code
    await pairUI(page, proxy.base, otherCode, 'Different owner device')
    const other = await selected(page)
    expect(other.personId).not.toBe(original.personId)
    expect(other.bindingId).not.toBe(original.bindingId)
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toHaveValue('')
    await expect(page.getByText(sent, { exact: true })).toHaveCount(0)
    await expect(page.getByLabel('待送出附件')).toHaveCount(0)
    const otherItems = await page.evaluate(async (id) => {
      const r = await window.yuki.client.outbox(id)
      if (!r.ok) throw Error(r.code)
      return r.value
    }, other.characterId)
    expect(otherItems.some((i) => i.requestId === requestId)).toBe(false)
    const memoryPath = '/client/v1/memory/facts?about=me&limit=50'
    proxy.faults.holdResponses.add(memoryPath)
    await page.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await expect.poll(() => proxy.held.has(memoryPath)).toBe(true)
    await expect(page.getByRole('button', { name: /^已核對的記錄 / })).toHaveCount(0)
    proxy.releaseResponses(memoryPath)
    await security(page)
    await prepare(page)
    await page
      .getByRole('dialog', { name: '處理本機內容', exact: true })
      .getByRole('button', { name: '刪除本機資料…', exact: true })
      .click()
    await expect(page.getByRole('dialog', { name: '刪除本機資料？', exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('darwin-2x-logout-delete-confirm.png') })
    await page.keyboard.press('Enter')
    expect(await exists(originalFile)).toBe(true)
    if (!(await page.getByRole('dialog', { name: '刪除本機資料？', exact: true }).isVisible()))
      await page.getByRole('button', { name: '刪除本機資料…', exact: true }).click()
    await page.getByRole('button', { name: '刪除並登出', exact: true }).click()
    await expect(page.getByLabel('伺服器位址')).toBeVisible()
    expect(
      await exists(
        join(
          rig.root,
          'logout-owners',
          'connections',
          other.characterId,
          'outbox',
          other.personId,
          other.bindingId + '.sqlite3',
        ),
      ),
    ).toBe(false)
    expect(await exists(originalFile)).toBe(true)
    expect(await readFile(source)).toEqual(bytes)
    proxy.faults.holdRequestIds.clear()
    await pairUI(page, proxy.base, await rig.code(), 'Original owner again')
    const resumed = await selected(page)
    expect(resumed.personId).toBe(original.personId)
    expect(resumed.bindingId).toBe(original.bindingId)
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toHaveValue(draft)
    await expect(page.getByLabel('待送出附件')).toContainText('private-local-attachment.txt')
    await expect
      .poll(() =>
        page.evaluate(
          async ({ id, requestId }) => {
            const r = await window.yuki.client.outbox(id)
            return r.ok && r.value.find((i) => i.requestId === requestId)?.state
          },
          { id: original.characterId, requestId },
        ),
      )
      .toBe('result')
    const events = (await (await fetch(`${rig.base}/__test/events`)).json()) as { text: string }[]
    expect(events.filter((e) => e.text === sent)).toHaveLength(1)
    expect(
      proxy.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/messages')),
    ).toHaveLength(1)
    await page.screenshot({
      path: test.info().outputPath('darwin-2x-logout-original-owner-restored.png'),
    })
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('offline logout retains credentials; a committed self-revocation with a lost response resumes from actual invalidity', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/logout-loss'),
    app = await rig.launch('logout-response')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code(), 'Self revoke response')
    const original = await selected(page)
    await security(page)
    proxy.faults.offline = true
    await page.getByRole('button', { name: '登出…', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '登出這個角色？', exact: true })
    await confirm.getByRole('button', { name: '撤銷憑據並繼續', exact: true }).click()
    await expect(confirm.getByRole('button', { name: '撤銷憑據並繼續', exact: true })).toBeEnabled()
    expect(await selected(page)).toMatchObject({ deviceId: original.deviceId, needsPairing: false })
    await expect(page.getByRole('dialog', { name: '處理本機內容', exact: true })).not.toBeVisible()
    proxy.faults.offline = false
    proxy.faults.loseNextSuffix = `/devices/${original.deviceId}`
    await confirm.getByRole('button', { name: '撤銷憑據並繼續', exact: true }).click()
    const choice = page.getByRole('dialog', { name: '處理本機內容', exact: true })
    await expect(choice).toBeVisible()
    await expect(choice.getByText('1 項待確認請求', { exact: true })).toBeVisible()
    expect(proxy.lostStatuses).toEqual([200])
    await choice.getByRole('button', { name: '保留並登出', exact: true }).click()
    await expect(page.getByLabel('伺服器位址')).toBeVisible()
    proxy.faults.holdReceipts = false
    await pairUI(page, proxy.base, await rig.code(), 'Repaired self revoke')
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const r = await window.yuki.client.characterCommands(id)
          if (!r.ok) throw Error(r.code)
          return r.value
            .filter((i) => i.command.kind === 'device-revoke')
            .map((i) => ({ state: i.state, problem: i.problem }))
        }, original.characterId),
      )
      .toEqual([{ state: 'result', problem: null }])
    expect(proxy.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('logging out the actual human controller releases its original Manager lease before local cleanup', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ computer: true }),
    app = await rig.launch('logout-controller'),
    observer = await rig.launch('logout-observer')
  let success = false
  try {
    const page = await app.firstWindow(),
      other = await observer.firstWindow()
    await pairUI(page, rig.base, await rig.code(), 'Human controller')
    await pairUI(other, rig.base, await rig.code(), 'Lease observer')
    const original = await selected(page)
    await page.keyboard.press('Meta+3')
    const initial = (await (await fetch(`${rig.base}/__test/computer`)).json()) as {
      control: { holder: string; lease_id: string | null }
    }
    expect(initial.control.holder).toBe('none')
    await page.getByRole('button', { name: '接手', exact: true }).click()
    await expect(page.getByRole('button', { name: '交回給 Yuki', exact: true })).toBeEnabled()
    const before = (await (await fetch(`${rig.base}/__test/computer`)).json()) as {
      control: { holder: string; device_id: string; lease_id: string }
    }
    expect(before.control.device_id).toBe(original.deviceId)
    await security(page)
    await prepare(page)
    await expect
      .poll(
        async () =>
          (
            (await (await fetch(`${rig.base}/__test/computer`)).json()) as {
              control: { holder: string }
            }
          ).control.holder,
      )
      .toBe(initial.control.holder)
    expect(
      await other.evaluate(async (id) => {
        const r = await window.yuki.client.read<import('../../src/shared/api').Computer>(id, {
          kind: 'computer',
        })
        if (!r.ok) throw Error(r.code)
        return r.value.control
      }, original.characterId),
    ).toMatchObject({ holder: initial.control.holder })
    await page
      .getByRole('dialog', { name: '處理本機內容', exact: true })
      .getByRole('button', { name: '保留並登出', exact: true })
      .click()
    await expect(page.getByLabel('伺服器位址')).toBeVisible()
    success = true
  } finally {
    await app.close().catch(() => {})
    await observer.close().catch(() => {})
    await rig.close(success)
  }
})
