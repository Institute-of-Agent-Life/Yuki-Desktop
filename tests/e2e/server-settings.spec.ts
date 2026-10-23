import { expect, test, type Page } from '@playwright/test'
import { currentEvents, pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
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
    await page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ }).fill('換網址前已接納的原訊息')
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
    const events = (await currentEvents(page)).items
    expect(events.filter((event) => event.text === '換網址前已接納的原訊息')).toHaveLength(1)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true }).last()).toBeVisible()
    await app.close()
    app = await rig.launch('server-address')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
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
