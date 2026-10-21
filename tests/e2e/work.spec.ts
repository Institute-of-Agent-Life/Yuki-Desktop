import { expect, test } from '@playwright/test'
import { pairUI, yukiFixture } from '../fixtures/backend'
import type { Home, Work } from '../../src/shared/api'

test('continues the original work through an actual reply and confirms cancellation with lost command responses', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('work-device')
  let second: Awaited<ReturnType<typeof rig.launch>> | undefined
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('請建立原工作整合測試')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: '原工作整合測試', exact: true }) })
    await expect(card.getByText('等你回覆', { exact: true })).toBeVisible({ timeout: 20000 })
    const original = await page.evaluate(async () => {
      const list = await window.yuki.client.connections()
      if (!list.ok || !list.value[0]) throw new Error('No paired connection')
      const home = await window.yuki.client.read<Home>(list.value[0].characterId, { kind: 'home' })
      if (!home.ok || !home.value.works[0]) throw new Error('No actual work')
      return { characterId: list.value[0].characterId, work: home.value.works[0] }
    })
    await card.getByRole('button', { name: '查看詳情', exact: true }).click()
    const detail = page.getByRole('complementary', { name: '檢視器' })
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
    const facts = (await (await fetch(`${rig.base}/__test/events`)).json()) as { text: string }[]
    expect(facts.filter((item) => item.text === '台北，請接續原工作')).toHaveLength(1)
    await page.getByRole('button', { name: '取消回覆工作', exact: true }).click()
    await page.reload()
    await expect(card.getByText('已完成', { exact: true })).toBeVisible()
    const afterReload = await page.evaluate(async (id) => {
      const home = await window.yuki.client.read<Home>(id, { kind: 'home' })
      return home.ok ? home.value.works : null
    }, original.characterId)
    expect(afterReload).toEqual([])
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('再建立一項可取消的工作')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await page.getByRole('button', { name: '工作', exact: true }).click()
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
    await page.getByRole('button', { name: '對話', exact: true }).click()
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await page.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('兩台裝置同時處理的工作')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await page.getByRole('button', { name: '工作', exact: true }).click()
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.click()
    await detail.getByRole('button', { name: '取消工作', exact: true }).click()
    second = await rig.launch('another-work-device')
    const other = await second.firstWindow()
    await pairUI(other, rig.base, await rig.code())
    await other.getByRole('button', { name: '工作', exact: true }).click()
    await other.getByRole('button', { name: /等你回覆.*原工作整合測試/ }).click()
    const otherDetail = other.getByRole('complementary', { name: '檢視器' })
    await otherDetail.getByRole('textbox').fill('另一台裝置回答：台北')
    await otherDetail.getByRole('button', { name: '傳送給這項工作', exact: true }).click()
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
        }, original.characterId),
      )
      .toBe('version_conflict')
    success = true
  } finally {
    await second?.close()
    await app.close()
    await rig.close(success)
  }
})
