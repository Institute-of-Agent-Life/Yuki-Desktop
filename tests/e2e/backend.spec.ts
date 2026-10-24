import { expect, test } from '@playwright/test'
import type { Profile } from '../../src/shared/api'
import {
  recordBusinessState,
  currentConnection,
  ledgerEvents,
  pairUI,
  waitForMainEnded,
  yukiFixture,
} from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { crashElectron } from '../fixtures/electron-process'

test('actual Yuki container: pairing, real ledger reply, lost response, cold recovery and draft', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    base = rig.base,
    proxy = await forwardProxy(base, '/backend-test'),
    launch = () => rig.launch('backend-device')
  let app = await launch(),
    completed = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, proxy.base, `綁定碼：${await rig.code()}（10 分鐘內有效）`)
    const connection = await currentConnection(page)
    const profile = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
      if (!result.ok) throw Error(result.code)
      return result.value
    }, connection.characterId)
    const composerName = `和 ${profile.display_name} 說點什麼`
    let composer = page.getByRole('textbox', { name: composerName, exact: true })
    const me = '/client/v1/me'
    proxy.faults.holdResponseSuffixes.add(me)
    await composer.fill('第一則原始訊息')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect.poll(() => [...proxy.held.keys()].some((path) => path.endsWith(me))).toBe(true)
    await composer.fill('等待送出期間的新草稿')
    proxy.faults.holdResponseSuffixes.delete(me)
    for (const path of proxy.held.keys()) if (path.endsWith(me)) proxy.releaseResponses(path)
    await expect(page.getByRole('button', { name: '送出', exact: true })).toBeEnabled()
    await expect(composer).toHaveValue('等待送出期間的新草稿')
    const sent = await page.evaluate(async (id) => {
      const result = await window.yuki.client.outbox(id)
      if (!result.ok) throw Error(result.code)
      const item = result.value.find((item) => item.body.text === '第一則原始訊息')
      if (!item?.eventId) throw Error('Original accepted request is missing')
      return { requestId: item.requestId, eventId: item.eventId }
    }, connection.characterId)
    const original = await waitForMainEnded(page, connection.characterId, sent.requestId)
    expect(original.event_id).toBe(sent.eventId)
    expect(original.result_event_ids).toHaveLength(1)
    await expect(
      page
        .locator(`article[data-event-id="${original.result_event_ids![0]}"]`)
        .getByText('Desktop reference reply', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('article')
      .filter({ has: page.getByText('第一則原始訊息', { exact: true }) })
      .getByRole('button', { name: '引用回覆' })
      .click()
    await expect(
      page.locator('[data-region="composer"]').getByText('引用：第一則原始訊息', { exact: true }),
    ).toBeVisible()
    await composer.fill('繼續原引用')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('繼續原引用', { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        const events = await ledgerEvents(base)
        return events.some((item) => item.content.endsWith('\n繼續原引用'))
      })
      .toBe(true)
    const facts = await ledgerEvents(base)
    const source = facts.find((item) => item.event_id === sent.eventId)!
    const quoted = facts.find((item) => item.content.endsWith('\n繼續原引用'))!
    expect(quoted.content).toContain(` event=${source.event_id}]]`)
    expect(source.content).toBe('第一則原始訊息')
    expect(quoted.author_person_id).toBe(connection.personId)
    expect(quoted.conversation_id).toBe(connection.conversationId)
    const deletion = await fetch(`${base}/__test/events/${source.event_id}?lose_hint=true`, {
      method: 'DELETE',
    })
    expect(deletion.status).toBe(200)
    expect(await deletion.json()).toMatchObject({ deleted: source.event_id, lost_hint: true })
    await expect(page.getByText('第一則原始訊息', { exact: true })).toHaveCount(0)
    await expect(page.getByText('引用的訊息無法讀取', { exact: true })).toBeVisible()
    await expect(page.getByText('引用：Desktop reference reply', { exact: true })).toHaveCount(0)
    proxy.faults.loseNextSuffix = '/messages'
    await composer.fill('原回應遺失的訊息')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    await expect.poll(() => proxy.lostStatuses.length).toBe(1)
    expect(proxy.lostStatuses[0]).toBe(200)
    await composer.fill('尚未送出的草稿')
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const connections = await window.yuki.client.connections()
          if (!connections.ok || !connections.value[0]) return ''
          const draft = await window.yuki.client.draft(connections.value[0].characterId)
          return draft.ok ? draft.value : ''
        }),
      )
      .toBe('尚未送出的草稿')
    const unknown = await page.evaluate(async (id) => {
      const result = await window.yuki.client.outbox(id)
      if (!result.ok) throw Error(result.code)
      const item = result.value.find((item) => item.body.text === '原回應遺失的訊息')
      if (!item) throw Error('Original pending request is missing')
      return { requestId: item.requestId, state: item.state }
    }, connection.characterId)
    expect(unknown.state).toBe('submitted')
    await crashElectron(app)
    await app.close().catch(() => {})
    proxy.faults.holdReceipts = false
    app = await launch()
    page = await app.firstWindow()
    composer = page.getByRole('textbox', { name: composerName, exact: true })
    await expect(composer).toHaveValue('尚未送出的草稿')
    await expect(page.getByText('原回應遺失的訊息', { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          async ({ id, requestId }) => {
            const result = await window.yuki.client.outbox(id)
            return result.ok ? result.value.find((item) => item.requestId === requestId)?.state : ''
          },
          { id: connection.characterId, requestId: unknown.requestId },
        ),
      )
      .toBe('result')
    const recovered = (await ledgerEvents(base)).filter(
      (item) => item.content === '原回應遺失的訊息',
    )
    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.author_person_id).toBe(connection.personId)
    expect(recovered[0]!.conversation_id).toBe(connection.conversationId)
    expect(
      proxy.calls.filter(
        (call) =>
          call.method === 'POST' &&
          call.path.endsWith('/messages') &&
          call.requestId === unknown.requestId,
      ),
    ).toHaveLength(1)
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('real-backend-conversation.png'),
    })
    completed = true
  } finally {
    if (!completed)
      await recordBusinessState(await app.firstWindow(), 'business-state.json').catch(console.error)
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(completed)
  }
})
