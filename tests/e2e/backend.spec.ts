import { expect, test } from '@playwright/test'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import type { EventsPage } from '../../src/shared/api'

test('current backend accepts pairing and messages, then cold-recovers the original lost receipt without another POST', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/desktop')
  let app = await rig.launch('original-device'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code(), 'Isolated original device', 15000)
    const paired = await currentConnection(page)
    expect(paired.persistentCredentials).toBe(true)
    expect(paired.deviceId).toBeTruthy()
    let composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await composer.fill('original current-contract message')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    try {
      await expect(
        page.locator('article').getByText('original current-contract message', { exact: true }),
      ).toBeVisible()
    } catch (error) {
      const evidence = await page.evaluate(async (original) => {
        const connections = await window.yuki.client.connections()
        const outbox = await window.yuki.client.outbox(original.characterId)
        const events = await window.yuki.client.read<EventsPage>(original.characterId, {
          kind: 'events',
          conversationId: original.conversationId,
        })
        return {
          connections: connections.ok
            ? connections.value.map((item) => ({
                characterId: item.characterId,
                personId: item.personId,
                deviceId: item.deviceId,
                bindingId: item.bindingId,
                conversationId: item.conversationId,
                persistentCredentials: item.persistentCredentials,
                needsPairing: item.needsPairing,
              }))
            : { code: connections.code },
          outbox: outbox.ok
            ? outbox.value.map((item) => ({
                requestId: item.requestId,
                payloadHash: item.payloadHash,
                state: item.state,
                eventId: item.eventId,
                matchesOriginalText: item.body.text === 'original current-contract message',
              }))
            : { code: outbox.code },
          events: events.ok
            ? events.value.items.map((item) => ({
                eventId: item.event_id,
                conversationId: item.conversation_id,
                direction: item.direction,
                matchesOriginalText: item.text === 'original current-contract message',
              }))
            : { code: events.code },
        }
      }, paired)
      await test.info().attach('first-message-state.json', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      })
      throw error
    }
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible({
      timeout: 20000,
    })
    proxy.faults.loseNextSuffix = '/messages'
    await composer.fill('original lost response')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect.poll(() => proxy.lostStatuses).toEqual([200])
    await expect(composer).toHaveValue('')
    await composer.fill('draft surviving cold recovery')
    const original = await page.evaluate(async () => {
      const connections = await window.yuki.client.connections()
      if (!connections.ok) throw Error(connections.code)
      const id = connections.value[0]!.characterId
      const outbox = await window.yuki.client.outbox(id)
      if (!outbox.ok) throw Error(outbox.code)
      const request = outbox.value.find((item) => item.body.text === 'original lost response')!
      return { id, requestId: request.requestId, payloadHash: request.payloadHash }
    })
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const result = await window.yuki.client.draft(id)
          return result.ok ? result.value : ''
        }, original.id),
      )
      .toBe('draft surviving cold recovery')
    const stopped = app.waitForEvent('close')
    await app.evaluate(() => process.exit(17)).catch(() => {})
    await stopped
    proxy.faults.holdReceipts = false
    app = await rig.launch('original-device')
    page = await app.firstWindow()
    composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await expect(composer).toBeVisible({ timeout: 15000 })
    expect(await currentConnection(page)).toEqual(paired)
    await expect(composer).toHaveValue('draft surviving cold recovery')
    await expect
      .poll(() =>
        page.evaluate(async ({ id, requestId }) => {
          const verified = await window.yuki.client.verify(id, requestId)
          return verified.ok ? verified.value : null
        }, original),
      )
      .toMatchObject({
        requestId: original.requestId,
        payloadHash: original.payloadHash,
        eventId: expect.any(Number),
      })
    await expect(
      page.locator('article').getByText('original lost response', { exact: true }),
    ).toHaveCount(1)
    expect(
      proxy.calls.filter(
        (call) =>
          call.method === 'POST' &&
          call.path.endsWith('/messages') &&
          call.requestId === original.requestId,
      ),
    ).toHaveLength(1)
    expect(
      proxy.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/pair')),
    ).toHaveLength(1)
    success = true
  } finally {
    proxy.faults.holdReceipts = false
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})
