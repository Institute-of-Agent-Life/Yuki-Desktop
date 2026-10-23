import { expect, test } from '@playwright/test'
import { currentConnection, currentEvents, pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import type { Work } from '../../src/shared/api'

test('real Work input and cancellation retain original identities and recover their lost responses', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/work')
  const app = await rig.launch('work-device')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code(), undefined, 15000)
    const connection = await currentConnection(page)
    const seed = await fetch(`${rig.base}/__test/work`, { method: 'POST' })
    expect(seed.status).toBe(200)
    const { work_id } = (await seed.json()) as { work_id: string }
    const read = () =>
      page.evaluate(
        async ({ id, workId }) => {
          const result = await window.yuki.client.read<Work>(id, { kind: 'work', workId })
          if (!result.ok) throw Error(result.code)
          return result.value
        },
        { id: connection.characterId, workId: work_id },
      )
    const original = await read()
    expect(original.state).toBe('waiting_user')
    expect(original.waiting_question?.event_id).toEqual(expect.any(Number))
    await page.getByRole('button', { name: '工作', exact: true }).click()
    await page.getByRole('button').filter({ hasText: 'Desktop reference work' }).click()
    const detail = page.getByRole('complementary', { name: '檢視器', exact: true })
    await expect(
      detail.getByText('Which details should I use?', { exact: true }).first(),
    ).toBeVisible()
    const answer = 'Original user input attached to original Work'
    await detail
      .getByRole('textbox', { name: '補充給：Desktop reference work', exact: true })
      .fill(answer)
    proxy.faults.loseNextSuffix = '/inputs'
    await detail.getByRole('button', { name: '傳送給這項工作', exact: true }).click()
    await expect.poll(() => proxy.lostStatuses).toEqual([200])
    proxy.faults.holdReceipts = false
    const receipts = () =>
      page.evaluate(async (id) => {
        const result = await window.yuki.client.workCommands(id)
        if (!result.ok) throw Error(result.code)
        return result.value
      }, connection.characterId)
    const input = (await receipts()).find((item) => item.command.kind === 'input')!
    await expect
      .poll(() =>
        page.evaluate(
          async ({ id, requestId }) => {
            const result = await window.yuki.client.verifyWorkCommand(id, requestId)
            return result.ok ? result.value.state : result.code
          },
          { id: connection.characterId, requestId: input.requestId },
        ),
      )
      .toBe('result')
    const after = await read()
    expect(after).toMatchObject({
      work_id,
      conversation_id: original.conversation_id,
      generation: original.generation,
    })
    expect(after.budget.root_id).toBe(original.budget.root_id)
    expect(after.budget.models).toBeGreaterThanOrEqual(original.budget.models)
    expect(
      (await currentEvents(page)).items.filter((event) => event.text.includes(answer)),
    ).toHaveLength(1)
    expect(
      proxy.calls.filter(
        (call) =>
          call.method === 'POST' &&
          call.path.endsWith('/inputs') &&
          call.requestId === input.requestId,
      ),
    ).toHaveLength(1)
    await expect.poll(async () => (await read()).state, { timeout: 20000 }).toBe('completed')
    // Seed another actual waiting Work so cancellation tests an active original execution.
    const nextSeed = await fetch(`${rig.base}/__test/work`, { method: 'POST' })
    expect(nextSeed.status).toBe(200)
    const next = (await nextSeed.json()) as { work_id: string }
    await page.evaluate(async (id) => {
      await window.yuki.client.reconnect()
      await window.yuki.client.read(id, { kind: 'home' })
    }, connection.characterId)
    await page.getByRole('button', { name: '對話', exact: true }).click()
    await page.getByRole('button', { name: '工作', exact: true }).click()
    await page
      .getByRole('button')
      .filter({ hasText: /等你回覆.*Desktop reference work/ })
      .click()
    await detail.getByRole('button', { name: '取消工作', exact: true }).click()
    await page.getByRole('button', { name: '保持執行', exact: true }).click()
    await detail.getByRole('button', { name: '取消工作', exact: true }).click()
    proxy.faults.loseNextSuffix = '/cancel'
    await page.getByRole('button', { name: '仍然取消', exact: true }).click()
    await expect.poll(() => proxy.lostStatuses).toEqual([200, 200])
    proxy.faults.holdReceipts = false
    const cancellation = (await receipts()).find((item) => item.command.kind === 'cancel')!
    await expect
      .poll(() =>
        page.evaluate(
          async ({ id, requestId }) => {
            const result = await window.yuki.client.verifyWorkCommand(id, requestId)
            return result.ok ? result.value.state : result.code
          },
          { id: connection.characterId, requestId: cancellation.requestId },
        ),
      )
      .toBe('result')
    const final = await page.evaluate(
      async ({ id, workId }) => {
        const result = await window.yuki.client.read<Work>(id, { kind: 'work', workId })
        return result.ok ? result.value : null
      },
      { id: connection.characterId, workId: next.work_id },
    )
    expect(final).toMatchObject({ work_id: next.work_id, state: 'cancelled' })
    expect(
      proxy.calls.filter(
        (call) =>
          call.method === 'POST' &&
          call.path.endsWith('/cancel') &&
          call.requestId === cancellation.requestId,
      ),
    ).toHaveLength(1)
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})
