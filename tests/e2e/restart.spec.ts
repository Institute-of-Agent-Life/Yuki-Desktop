import { expect, test } from '@playwright/test'
import { currentConnection, currentEvents, pairUI, yukiFixture } from '../fixtures/backend'
import type { Profile } from '../../src/shared/api'

test('the open desktop reconnects after a real backend process restart and keeps original events and receipts', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('restart-device')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page)
    const owner = () =>
      page.evaluate(async (id) => {
        const profile = await window.yuki.client.read<Profile>(id, { kind: 'character' })
        if (!profile.ok) throw Error(profile.code)
        return profile.value.viewer.is_owner
      }, original.characterId)
    expect(await owner()).toBe(true)
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await composer.fill('伺服器重啟前的原訊息')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true }).last()).toBeVisible()
    const before = (await currentEvents(page)).items
    await composer.fill('伺服器重啟時保留的草稿')
    await rig.restart()
    await expect(
      page.locator('[data-region="toolbar"]').getByText('已連線', { exact: true }),
    ).toBeVisible()
    await expect(composer).toHaveValue('伺服器重啟時保留的草稿')
    await expect(page.getByText('伺服器重啟前的原訊息', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(async () => {
        const events = (await currentEvents(page)).items
        return events.filter((item) => item.text === '伺服器重啟時保留的草稿').length
      })
      .toBe(1)
    const after = (await currentEvents(page)).items
    for (const original of before)
      expect(after.filter((item) => item.id === original.id)).toEqual([original])
    expect(after.filter((item) => item.text === '伺服器重啟前的原訊息')).toHaveLength(1)
    expect(await currentConnection(page)).toEqual(original)
    expect(await owner()).toBe(true)
    // A fixture restart must not silently re-grant a revoked real owner.
    expect((await fetch(`${rig.base}/__test/revoke-owner`, { method: 'POST' })).status).toBe(200)
    expect(await owner()).toBe(false)
    await rig.restart()
    expect(await owner()).toBe(false)
    expect(await currentConnection(page)).toEqual(original)
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
