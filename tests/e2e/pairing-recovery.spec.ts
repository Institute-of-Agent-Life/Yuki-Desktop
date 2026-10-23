import { expect, test, type Page } from '@playwright/test'
import { currentConnection, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import type { Me } from '../../src/shared/api'

async function pendingPairings(page: Page) {
  return page.evaluate(async () => {
    const result = await window.yuki.client.pendingPairings()
    if (!result.ok) throw Error(result.code)
    return result.value
  })
}

test('a received pairing token survives failed first me and a cold restart as the same original device', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/pairing-recovery'),
    ownerPersonId = (await rig.state()).owner_person_id
  let app = await rig.launch('pending-original-device'),
    success = false
  try {
    let page = await app.firstWindow()
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    await page
      .getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
      .filter({ visible: true })
      .fill(`yuki://pair?${new URLSearchParams({ server: proxy.base, code: await rig.code() })}`)
    await page.getByRole('button', { name: '繼續', exact: true }).click()
    await expect(page.getByText(`伺服器：${proxy.base}`, { exact: true })).toBeVisible()
    // Pair returns its real token to Main; only the subsequent real /me response is lost.
    proxy.faults.loseNextReadSuffix = '/me'
    await page.getByRole('button', { name: '確認並連接', exact: true }).click()
    await expect(page.getByRole('button', { name: '繼續連接 初始角色', exact: true })).toBeVisible({
      timeout: 30000,
    })
    expect(proxy.lostStatuses).toEqual([200])
    const pending = await pendingPairings(page)
    expect(pending).toHaveLength(1)
    const original = pending[0]!
    expect(original.persistentCredentials).toBe(true)
    expect(original.baseUrl).toBe(proxy.base)
    const pairs = () =>
      proxy.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/pair'))
    expect(pairs()).toHaveLength(1)
    expect(await page.evaluate(() => window.yuki.client.connections())).toEqual({
      ok: true,
      value: [],
    })
    const stopped = app.waitForEvent('close')
    await app.evaluate(() => process.exit(17)).catch(() => {})
    await stopped
    app = await rig.launch('pending-original-device')
    page = await app.firstWindow()
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    const resume = page.getByRole('button', { name: '繼續連接 初始角色', exact: true })
    await expect(resume).toBeVisible({ timeout: 15000 })
    expect(await pendingPairings(page)).toEqual(pending)
    await resume.click()
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await expect(composer).toBeVisible({ timeout: 15000 })
    const connection = await currentConnection(page)
    expect(connection).toMatchObject({
      characterId: original.characterId,
      deviceId: original.deviceId,
      personId: ownerPersonId,
      persistentCredentials: true,
      baseUrl: proxy.base,
    })
    expect(await pendingPairings(page)).toEqual([])
    const person = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Me>(id, { kind: 'me' })
      if (!result.ok) throw Error(result.code)
      return result.value.request_person_id
    }, connection.characterId)
    expect(person).toBe(ownerPersonId)
    await composer.fill('已恢復原裝置，沒有再次兌換配對碼')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true }).last()).toBeVisible()
    expect(pairs()).toHaveLength(1)
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})
