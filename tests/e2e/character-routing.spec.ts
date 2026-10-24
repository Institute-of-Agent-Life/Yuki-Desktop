import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import type { Connection, EventsPage, OriginalRequest } from '../../src/shared/api'

async function connectionAt(page: Page, base: string) {
  return page.evaluate(async (base) => {
    const list = await window.yuki.client.connections()
    if (!list.ok) throw Error(list.code)
    return list.value.find((item) => item.baseUrl === base)!
  }, base)
}

async function requestFacts(page: Page, connection: Connection, requestId: string) {
  return page.evaluate(
    async ({ id, requestId }) => {
      const result = await window.yuki.client.read<OriginalRequest>(id, {
        kind: 'request',
        requestId,
      })
      if (!result.ok) throw Error(result.code)
      const receipt = result.value
      return {
        found: receipt.found,
        operationKind: receipt.operation_kind,
        eventId: receipt.event_id,
        conversationId: receipt.conversation_id,
        target: receipt.target,
        turnState: receipt.turn?.state,
        resultEventIds: receipt.result_event_ids,
        problemCode: receipt.problem_code,
      }
    },
    { id: connection.characterId, requestId },
  )
}

interface MessageFacts {
  connection: Connection
  text: string
  requests?: { requestId: string; eventId: number | null; state: string; problem: string | null }[]
  receipt?: Awaited<ReturnType<typeof requestFacts>>
  canonical?: {
    eventId: number
    conversationId: string
    direction: string
    ownText: boolean
    otherText: boolean
    referenceReply: boolean
  }[]
}

async function send(page: Page, fact: MessageFacts) {
  const { connection, text } = fact
  await page.keyboard.press('ControlOrMeta+N')
  const input = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
  await expect(input).toBeFocused()
  await input.fill(text)
  await input.press('Enter')
  await expect
    .poll(async () => {
      fact.requests = await page.evaluate(
        async ({ id, text }) => {
          const result = await window.yuki.client.outbox(id)
          if (!result.ok) throw Error(result.code)
          return result.value
            .filter((item) => item.body.text === text)
            .map(({ requestId, eventId, state, problem }) => ({
              requestId,
              eventId,
              state,
              problem,
            }))
        },
        { id: connection.characterId, text },
      )
      return fact.requests
    })
    .toMatchObject([
      {
        requestId: expect.any(String),
        eventId: expect.any(Number),
        state: expect.stringMatching(/^(accepted|result)$/),
        problem: null,
      },
    ])
  const original = fact.requests![0]!
  await expect
    .poll(async () => {
      fact.receipt = await requestFacts(page, connection, original.requestId)
      return fact.receipt
    })
    .toMatchObject({
      found: true,
      operationKind: 'message',
      eventId: original.eventId,
      conversationId: connection.conversationId,
      target: connection.conversationId,
      turnState: 'ended',
      resultEventIds: expect.arrayContaining([expect.any(Number)]),
      problemCode: null,
    })
  const message = page.locator(`article[data-event-id="${original.eventId}"]`)
  await expect(message).toHaveCount(1)
  await expect(message.getByText(text, { exact: true })).toBeVisible()
  expect(await connectionAt(page, connection.baseUrl)).toEqual(connection)
  return original.eventId!
}
test('two equally named real roles send to their own original Main and recover separate histories', async () => {
  test.setTimeout(90000)
  const first = await yukiFixture(),
    second = await yukiFixture()
  let app = await first.launch('role-message-routing'),
    success = false
  const facts: MessageFacts[] = []
  try {
    let page = await app.firstWindow()
    await pairUI(page, first.base, await first.code())
    const firstFact = {
      connection: await connectionAt(page, first.base),
      text: '第一個角色的原始訊息',
    }
    facts.push(firstFact)
    const firstEventId = await send(page, firstFact)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '伺服器與角色', exact: true }).click()
    await page.getByRole('button', { name: '加入另一個角色', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    await expect(
      page.getByText('第一個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
    const secondFact = {
      connection: await connectionAt(page, second.base),
      text: '第二個角色的原始訊息',
    }
    facts.push(secondFact)
    const secondEventId = await send(page, secondFact)
    await page.keyboard.press('ControlOrMeta+Shift+[')
    await expect(
      page.getByText('第一個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    await expect(
      page.getByText('第二個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
    for (const [fact, eventId, other] of [
      [facts[0]!, firstEventId, secondFact.text],
      [facts[1]!, secondEventId, firstFact.text],
    ] as const) {
      const events = await page.evaluate(
        async (connection) => {
          const result = await window.yuki.client.read<EventsPage>(connection.characterId, {
            kind: 'events',
            conversationId: connection.conversationId,
          })
          if (!result.ok) throw Error(result.code)
          return result.value.items
        },
        fact.connection,
      )
      fact.canonical = events.map((event) => ({
        eventId: event.event_id,
        conversationId: event.conversation_id,
        direction: event.direction,
        ownText: event.text === fact.text,
        otherText: event.text === other,
        referenceReply: event.text === 'Desktop reference reply',
      }))
      expect(
        events.filter((event) => event.event_id === eventId && event.text === fact.text),
      ).toHaveLength(1)
      expect(events.some((event) => event.text === other)).toBe(false)
      const replies = events.filter((event) =>
        fact.receipt!.resultEventIds!.includes(event.event_id),
      )
      expect(replies).toHaveLength(1)
      expect(replies[0]).toMatchObject({
        conversation_id: fact.connection.conversationId,
        direction: 'outbound',
        text: 'Desktop reference reply',
      })
      expect(replies[0]!.event_id).toBeGreaterThan(eventId)
      expect(await connectionAt(page, fact.connection.baseUrl)).toEqual(fact.connection)
    }
    await app.close()
    app = await first.launch('role-message-routing')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible({
      timeout: 15000,
    })
    await expect(
      page.getByText('第一個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+]')
    await expect(
      page.getByText('第二個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    await expect(
      page.getByText('第一個角色的原始訊息', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
    success = true
  } finally {
    const evidencePath = test.info().outputPath('role-message-routing-facts.json')
    await writeFile(evidencePath, JSON.stringify(facts, null, 2))
    await test.info().attach('role-message-routing-facts.json', {
      path: evidencePath,
      contentType: 'application/json',
    })
    await app.close()
    await first.close(success)
    await second.close(success)
  }
})
