import { expect, test, type Page } from '@playwright/test'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import type { Connection, Me, Home, ProactiveRoute } from '../../src/shared/api'
async function settings(page: Page) {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '伺服器與角色', exact: true }).click()
  await expect(page.getByText('已連線', { exact: true })).toBeVisible()
}
async function connection(page: Page) {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok) throw Error(result.code)
    return result.value[0]!
  })
}
async function route(page: Page, value: Connection) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.read<ProactiveRoute>(id, { kind: 'proactive-route' })
    if (!result.ok) throw Error(result.code)
    return result.value
  }, value.characterId)
}

test('new server address proves real identity before bearer and resumes the original lost message receipt', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    other = await yukiFixture(),
    old = await forwardProxy(rig.base, '/original'),
    moved = await forwardProxy(rig.base, '/relocated'),
    wrong = await forwardProxy(other.base, '/another-role')
  let app = await rig.launch('server-address'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, old.base, await rig.code())
    const original = await connection(page)
    await settings(page)
    await page.getByRole('button', { name: '更改…', exact: true }).click()
    await page.getByRole('textbox', { name: '新伺服器位址' }).fill(wrong.base)
    await page.getByRole('button', { name: '確認並連線', exact: true }).click()
    await expect(
      page.getByText('這個位址已是另一個角色，請確認原角色的新位址。', { exact: true }),
    ).toBeVisible()
    expect((await connection(page)).baseUrl).toBe(old.base)
    expect(wrong.calls).toEqual([
      { path: '/client/v1/meta', method: 'GET', bearer: false, requestId: undefined },
    ])
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    old.faults.loseNextSuffix = '/messages'
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('換網址前已接納的原訊息')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(
        () =>
          old.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/messages'))
            .length,
      )
      .toBe(1)
    const requestId = old.calls.find(
      (call) => call.method === 'POST' && call.path.endsWith('/messages'),
    )!.requestId!
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const result = await window.yuki.client.outbox(id)
          return result.ok && result.value[0]?.problem
        }, original.characterId),
      )
      .toBe('unknown')
    old.faults.offline = true
    await settingsWithoutWaiting(page)
    await page.getByRole('button', { name: '更改…', exact: true }).click()
    await page.getByRole('textbox', { name: '新伺服器位址' }).fill(moved.base)
    await page.getByRole('button', { name: '確認並連線', exact: true }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    expect(await connection(page)).toMatchObject({ ...original, baseUrl: moved.base })
    expect(moved.calls[0]).toMatchObject({ path: '/client/v1/meta', bearer: false })
    const proof = moved.calls.find((call) => call.path === '/client/v1/me')
    expect(proof?.bearer).toBe(true)
    await expect
      .poll(() =>
        page.evaluate(
          async ({ id, requestId }) => {
            const result = await window.yuki.client.outbox(id)
            return result.ok && result.value.find((item) => item.requestId === requestId)?.state
          },
          { id: original.characterId, requestId },
        ),
      )
      .toBe('result')
    expect(moved.calls.some((call) => call.path === `/client/v1/requests/${requestId}`)).toBe(true)
    expect(
      moved.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/messages')),
    ).toHaveLength(0)
    const events = (await (await fetch(`${rig.base}/__test/events`)).json()) as { text: string }[]
    expect(events.filter((event) => event.text === '換網址前已接納的原訊息')).toHaveLength(1)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByText('真實帳本回覆', { exact: true })).toBeVisible()
    await app.close()
    app = await rig.launch('server-address')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toBeVisible()
    expect((await connection(page)).baseUrl).toBe(moved.base)
    success = true
  } finally {
    await app.close().catch(() => {})
    await Promise.all([old.close(), moved.close(), wrong.close()])
    await rig.close(success)
    await other.close(success)
  }
})
async function settingsWithoutWaiting(page: Page) {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '伺服器與角色', exact: true }).click()
}

test('two actual devices keep proactive route CAS and recover the original lost response after a cold App restart', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/route')
  let a = await rig.launch('route-a'),
    success = false
  const b = await rig.launch('route-b')
  try {
    let pa = await a.firstWindow()
    const pb = await b.firstWindow()
    await pairUI(pa, proxy.base, await rig.code())
    await pairUI(pb, rig.base, await rig.code())
    const entry = (await (
      await fetch(`${rig.base}/__test/qq-entry`, { method: 'POST' })
    ).json()) as { conversation_id: string }
    const original = await connection(pa)
    const me = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.read<Me>(id, { kind: 'me' })
      if (!result.ok) throw Error(result.code)
      return result.value
    }, original.characterId)
    const home = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.read<Home>(id, { kind: 'home' })
      if (!result.ok) throw Error(result.code)
      return result.value
    }, original.characterId)
    const qq = me.bindings.find(
      (item) =>
        item.binding_id ===
        home.entries.find((item) => item.conversation_id === entry.conversation_id)?.binding_id,
    )!
    await settings(pa)
    await settings(pb)
    await pa.getByRole('combobox', { name: '主動訊息接收入口' }).selectOption(qq.binding_id)
    const before = await route(pa, original)
    await pb.getByRole('combobox', { name: '主動訊息接收入口' }).selectOption(original.bindingId)
    await pb.getByRole('button', { name: '儲存目的地', exact: true }).click()
    await expect(pb.getByText('主動訊息目的地已更新。', { exact: true })).toBeVisible()
    await pa.getByRole('button', { name: '儲存目的地', exact: true }).click()
    await expect(
      pa.getByText('資料已在另一台裝置更新，請重新讀取。', { exact: true }),
    ).toBeVisible()
    await expect(pa.getByRole('combobox', { name: '主動訊息接收入口' })).toHaveValue(qq.binding_id)
    const conflicted = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.characterCommands(id)
      if (!result.ok) throw Error(result.code)
      return result.value.filter((item) => item.command.kind === 'proactive-route')
    }, original.characterId)
    expect(conflicted[0]?.command).toMatchObject({ expectedRevision: before.revision })
    await pa.getByRole('button', { name: '重新讀取目的地', exact: true }).click()
    await pa.getByRole('combobox', { name: '主動訊息接收入口' }).selectOption(qq.binding_id)
    proxy.faults.loseNextSuffix = '/me/proactive-route'
    await pa.getByRole('button', { name: '儲存目的地', exact: true }).click()
    await expect(pa.getByText('主動路由變更：結果尚未確認。', { exact: true })).toBeVisible()
    const accepted = await route(pb, original)
    expect(proxy.lostStatuses).toEqual([200])
    expect(accepted.binding_id).toBe(qq.binding_id)
    const writes = proxy.calls.filter(
      (call) => call.method === 'PUT' && call.path.endsWith('/me/proactive-route'),
    )
    expect(writes).toHaveLength(2)
    const requestId = writes[1]!.requestId!
    a.process().kill('SIGKILL')
    await a.close().catch(() => {})
    proxy.faults.holdReceipts = false
    a = await rig.launch('route-a')
    pa = await a.firstWindow()
    await expect(pa.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toBeVisible()
    await settings(pa)
    await expect
      .poll(() =>
        pa.evaluate(
          async ({ id, requestId }) => {
            const result = await window.yuki.client.characterCommands(id)
            const item = result.ok && result.value.find((item) => item.requestId === requestId)
            return item && { state: item.state, problem: item.problem }
          },
          { id: original.characterId, requestId },
        ),
      )
      .toEqual({ state: 'result', problem: null })
    expect(await route(pa, original)).toEqual(accepted)
    expect(
      proxy.calls.filter(
        (call) => call.method === 'PUT' && call.path.endsWith('/me/proactive-route'),
      ),
    ).toHaveLength(2)
    const withoutDestination = me.bindings.find(item => item.platform === 'qq' && item.binding_id !== qq.binding_id)!
    await pa.getByRole('combobox', { name: '主動訊息接收入口' }).selectOption(withoutDestination.binding_id)
    await pa.getByRole('button', { name: '儲存目的地', exact: true }).click()
    await expect(pa.getByText('這個入口目前沒有可用的接收連線。請選擇其他入口。', { exact: true })).toBeVisible()
    expect(await route(pa, original)).toEqual(accepted)
    await pa.getByRole('button', { name: '重新讀取目的地', exact: true }).click()
    await pa.screenshot({ path: test.info().outputPath('darwin-2x-server-settings.png') })
    await pa.getByRole('button', { name: '開啟角色資料', exact: true }).click()
    await expect(pa.getByRole('heading', { name: 'Yuki', exact: true })).toBeVisible()
    success = true
  } finally {
    await a.close().catch(() => {})
    await b.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})
