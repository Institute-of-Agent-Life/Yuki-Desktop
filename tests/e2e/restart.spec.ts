import { expect, test } from '@playwright/test'
import { currentEvents, pairUI, yukiFixture } from '../fixtures/backend'

test('the open desktop reconnects after a real backend process restart and keeps original events and receipts', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('restart-device')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await composer.fill('伺服器重啟前的原訊息')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true }).last()).toBeVisible()
    const before = (await currentEvents(page)).items
    await composer.fill('伺服器重啟時保留的草稿')
    await rig.restart()
    await expect(page.getByText('已連線', { exact: true })).toBeVisible()
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
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
