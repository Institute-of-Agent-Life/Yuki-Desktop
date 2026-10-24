import { expect, test } from '@playwright/test'
import type { OriginalRequest, Profile } from '../../src/shared/api'
import { currentConnection, ledgerEvents, pairUI, yukiFixture } from '../fixtures/backend'

test('the open desktop reconnects after a real backend process crash and keeps original events and receipts', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('restart-device')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const profile = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
      if (!result.ok) throw Error(result.code)
      return result.value
    }, connection.characterId)
    const composer = page.getByRole('textbox', {
      name: `和 ${profile.display_name} 說點什麼`,
      exact: true,
    })
    await composer.fill('伺服器重啟前的原訊息')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    const sent = await page.evaluate(async (id) => {
      const result = await window.yuki.client.outbox(id)
      if (!result.ok) throw Error(result.code)
      const item = result.value.find((item) => item.body.text === '伺服器重啟前的原訊息')
      if (!item?.eventId) throw Error('Original accepted request is missing')
      return { requestId: item.requestId, eventId: item.eventId }
    }, connection.characterId)
    const receipt = () =>
      page.evaluate(
        async ({ id, requestId }) => {
          const result = await window.yuki.client.read<OriginalRequest>(id, {
            kind: 'request',
            requestId,
          })
          if (!result.ok) throw Error(result.code)
          return result.value
        },
        { id: connection.characterId, requestId: sent.requestId },
      )
    await expect.poll(async () => (await receipt()).turn?.state).toBe('ended')
    const original = await receipt()
    expect(original.event_id).toBe(sent.eventId)
    expect(original.result_event_ids).toHaveLength(1)
    await expect(
      page
        .locator(`article[data-event-id="${original.result_event_ids![0]}"]`)
        .getByText('Desktop reference reply', { exact: true }),
    ).toBeVisible()
    const before = await ledgerEvents(rig.base)
    await composer.fill('伺服器重啟時保留的草稿')
    await rig.crash()
    await expect(
      page.locator('[data-region="sidebar"]').getByText('已連線', { exact: true }),
    ).toBeVisible()
    await expect(composer).toHaveValue('伺服器重啟時保留的草稿')
    await expect(page.getByText('伺服器重啟前的原訊息', { exact: true })).toBeVisible()
    expect((await receipt()).event_id).toBe(sent.eventId)
    expect((await receipt()).result_event_ids).toEqual(original.result_event_ids)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(async () => {
        const events = await ledgerEvents(rig.base)
        return events.filter((item) => item.content === '伺服器重啟時保留的草稿').length
      })
      .toBe(1)
    const after = await ledgerEvents(rig.base)
    for (const original of before)
      expect(after.filter((item) => item.event_id === original.event_id)).toEqual([original])
    expect(after.filter((item) => item.content === '伺服器重啟前的原訊息')).toHaveLength(1)
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
