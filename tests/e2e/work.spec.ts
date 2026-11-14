import { navigate } from '../fixtures/navigation'
import { contentSize } from '../fixtures/visual'
import { expect, test, type Page } from '@playwright/test'
import {
  currentConnection,
  currentEvents,
  pairUI,
  recordBusinessState,
  waitForAcceptedMessage,
  waitForMainEnded,
  waitForWorkState,
  yukiFixture,
} from '../fixtures/backend'
import type { Home, Work, WorkSteps, OriginalRequest } from '../../src/shared/api'
import { writeFile } from 'node:fs/promises'

test('continues the original work through an actual reply and confirms cancellation with lost command responses', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('work-device')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const name = (await currentConnection(page)).name
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await page
      .getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
      .fill('請建立原工作整合測試')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: '原工作整合測試', exact: true }) })
    await expect(card.getByText('等你回覆', { exact: true })).toBeVisible({ timeout: 20000 })
    expect(await card.innerText()).not.toMatch(/\d+ 個步驟|\d+ 個子工作/)
    await page.screenshot({ path: test.info().outputPath('work-card-waiting-question.png') })
    const original = await page.evaluate(async () => {
      const list = await window.yuki.client.connections()
      if (!list.ok || !list.value[0]) throw new Error('No paired connection')
      const home = await window.yuki.client.read<Home>(list.value[0].characterId, { kind: 'home' })
      if (!home.ok || !home.value.works[0]) throw new Error('No actual work')
      return { characterId: list.value[0].characterId, work: home.value.works[0] }
    })
    await card.getByRole('button', { name: '查看詳情', exact: true }).click()
    const detail = page.getByRole('complementary', { name: '詳情' })
    await expect(detail.getByText('需要你提供城市', { exact: true }).first()).toBeVisible()
    await detail.getByRole('button', { name: '在對話中回答', exact: true }).click()
    const reply = page.locator('[data-region="content"] [data-work-reply]')
    await reply.getByRole('textbox').fill('台北，請接續原工作')
    await fetch(`${rig.base}/__test/lose-next-work-response/inputs`, { method: 'POST' })
    await reply.getByRole('button', { name: '送出', exact: true }).click()
    await expect(card.getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    const finished = await page.evaluate(async ({ characterId, work }) => {
      const value = await window.yuki.client.read<Work>(characterId, {
        kind: 'work',
        workId: work.work_id,
      })
      if (!value.ok) throw new Error(value.code)
      return value.value
    }, original)
    expect(finished.work_id).toBe(original.work.work_id)
    expect(finished.conversation_id).toBe(original.work.conversation_id)
    expect(finished.generation).toBe(original.work.generation)
    expect(finished.budget.root_id).toBe(original.work.budget.root_id)
    expect(finished.budget.models).toBeGreaterThanOrEqual(original.work.budget.models)
    const facts = (await currentEvents(page)).items
    expect(facts.filter((item) => item.content === '台北，請接續原工作')).toHaveLength(1)
    await page.getByRole('button', { name: '取消回覆工作', exact: true }).click()
    await page.reload()
    await expect(card.getByText('已完成', { exact: true })).toBeVisible()
    const afterReload = await page.evaluate(async (id) => {
      const home = await window.yuki.client.read<Home>(id, { kind: 'home' })
      return home.ok ? home.value.works : null
    }, original.characterId)
    expect(afterReload).toEqual([])
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await page
      .getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
      .fill('再建立一項可取消的工作')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await navigate(page, '工作')
    const row = page.getByRole('button', { name: /等你回覆.*原工作整合測試/ })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.click()
    await detail.getByRole('button', { name: '取消工作', exact: true }).click()
    await page.getByRole('button', { name: '保持執行', exact: true }).click()
    await expect(detail.getByText('等你回覆', { exact: true })).toBeVisible()
    await detail.getByRole('button', { name: '取消工作', exact: true }).click()
    await fetch(`${rig.base}/__test/lose-next-work-response/cancel`, { method: 'POST' })
    await page.getByRole('button', { name: '仍然取消', exact: true }).click()
    await expect(detail.getByText('已取消', { exact: true })).toBeVisible({ timeout: 20000 })
    const cancellation = await page.evaluate(async (id) => {
      const commands = await window.yuki.client.workCommands(id)
      if (!commands.ok) throw Error(commands.code)
      return commands.value.find((item) => item.command.kind === 'cancel')!
    }, original.characterId)
    const cancellationReceipt = () =>
      page.evaluate(
        async ({ id, requestId }) => {
          const value = await window.yuki.client.read<OriginalRequest>(id, {
            kind: 'request',
            requestId,
          })
          if (!value.ok) throw Error(value.code)
          return value.value
        },
        { id: original.characterId, requestId: cancellation.requestId },
      )
    await expect.poll(async () => (await cancellationReceipt()).found).toBe(true)
    await writeFile(
      test.info().outputPath('original-cancellation-receipt.json'),
      JSON.stringify(
        { requestId: cancellation.requestId, receipt: await cancellationReceipt() },
        null,
        2,
      ),
    )
    const cancellationState = await page.evaluate(
      async ({ id, requestId }) => {
        const commands = await window.yuki.client.workCommands(id)
        if (!commands.ok) throw Error(commands.code)
        return commands.value.find((item) => item.requestId === requestId)!.state
      },
      { id: original.characterId, requestId: cancellation.requestId },
    )
    if (cancellationState !== 'result')
      await detail.getByRole('button', { name: '查詢', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const commands = await window.yuki.client.workCommands(id)
          return commands.ok
            ? commands.value.map((item) => [item.command.kind, item.state, item.problem])
            : []
        }, original.characterId),
      )
      .toEqual([
        ['input', 'result', null],
        ['cancel', 'result', null],
      ])
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('work-cancelled.png'),
    })
    success = true
  } finally {
    const page = await app.firstWindow()
    await recordBusinessState(page, 'work-state-a.json').catch(console.error)
    await app.close()
    await rig.close(success)
  }
})

test('rejects the original stale cancellation after another device completes the same work', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('work-device')
  let second: Awaited<ReturnType<typeof rig.launch>> | undefined
  let success = false
  let third: { characterId: string; requestId: string; eventId: number; workId: string } | undefined
  const recordThirdWork = async (page: Page, device: string) => {
    if (!third) return
    const facts = await page.evaluate(async (identity) => {
      const id = identity.characterId
      const commands = await window.yuki.client.workCommands(id)
      const related = commands.ok
        ? commands.value.filter((item) => item.command.workId === identity.workId)
        : []
      const requestIds = new Set([identity.requestId, ...related.map((item) => item.requestId)])
      const [work, steps, requests] = await Promise.all([
        window.yuki.client.read<Work>(id, { kind: 'work', workId: identity.workId }),
        window.yuki.client.read<WorkSteps>(id, { kind: 'steps', workId: identity.workId }),
        Promise.all(
          [...requestIds].map(async (requestId) => ({
            requestId,
            result: await window.yuki.client.read<OriginalRequest>(id, {
              kind: 'request',
              requestId,
            }),
          })),
        ),
      ])
      return { identity, commands, related, work, steps, requests }
    }, third)
    await writeFile(
      test.info().outputPath(`third-work-state-${device}.json`),
      JSON.stringify(facts, null, 2),
    )
  }
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const name = connection.name
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await page
      .getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
      .fill('兩台裝置同時處理的工作')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await navigate(page, '工作')
    const thirdMessage = await waitForAcceptedMessage(
      page,
      connection.characterId,
      '兩台裝置同時處理的工作',
    )
    const thirdReceipt = await waitForMainEnded(
      page,
      connection.characterId,
      thirdMessage.requestId,
    )
    expect(thirdReceipt.event_id).toBe(thirdMessage.eventId)
    if (!thirdReceipt.event_id || !thirdReceipt.work)
      throw Error('Original third Work association is missing')
    third = {
      characterId: connection.characterId,
      requestId: thirdMessage.requestId,
      eventId: thirdReceipt.event_id,
      workId: thirdReceipt.work.work_id,
    }
    await writeFile(
      test.info().outputPath('third-work-identity.json'),
      JSON.stringify(third, null, 2),
    )
    const row = page.getByRole('button', { name: /等你回覆.*原工作整合測試/ })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.click()
    const detail = page.getByRole('complementary', { name: '詳情' })
    await detail.getByRole('button', { name: '取消工作', exact: true }).click()
    second = await rig.launch('another-work-device')
    const other = await second.firstWindow()
    await pairUI(other, rig.base, await rig.code())
    await contentSize(second, other, 1440, 900)
    await expect(other.getByRole('navigation', { name: '主要導覽', exact: true })).toBeVisible()
    await navigate(other, '工作')
    await other.getByRole('button', { name: /等你回覆.*原工作整合測試/ }).click()
    const otherDetail = other.getByRole('complementary', { name: '詳情' })
    await otherDetail.getByRole('textbox').fill('另一台裝置回答：台北')
    await otherDetail.getByRole('button', { name: '傳送給這項工作', exact: true }).click()
    const thirdInput = await other.evaluate(async ({ characterId, workId }) => {
      const commands = await window.yuki.client.workCommands(characterId)
      return {
        commands,
        input: commands.ok
          ? (commands.value.find(
              (item) =>
                item.command.workId === workId &&
                item.command.kind === 'input' &&
                item.command.text === '另一台裝置回答：台北',
            ) ?? null)
          : null,
      }
    }, third)
    await writeFile(
      test.info().outputPath('third-work-input.json'),
      JSON.stringify({ identity: third, ...thirdInput }, null, 2),
    )
    await waitForWorkState(page, third.characterId, third.workId, 'completed')
    await expect(otherDetail.getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    // The original confirmation keeps the revision observed before the other device's reply.
    await page.getByRole('button', { name: '仍然取消', exact: true }).click()
    await expect(
      detail.getByText('工作狀態已改變，請確認最新狀態後再取消。', { exact: true }),
    ).toBeVisible()
    await expect(detail.getByText('已完成', { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const commands = await window.yuki.client.workCommands(id)
          return commands.ok ? commands.value.at(-1)?.problem : 'unreadable'
        }, connection.characterId),
      )
      .toBe('version_conflict')
    success = true
  } finally {
    for (const [device, instance] of [
      ['a', app],
      ['b', second],
    ] as const) {
      if (!instance) continue
      const page = await instance.firstWindow()
      await recordBusinessState(page, `work-state-${device}.json`).catch(console.error)
      await recordThirdWork(page, device).catch(console.error)
    }
    await second?.close()
    await app.close()
    await rig.close(success)
  }
})
