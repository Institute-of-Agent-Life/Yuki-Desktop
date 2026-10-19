import { expect, test } from '@playwright/test'
import type { AutomationPage, Connection, MemoryPage } from '../../src/shared/api'
import { pairUI, yukiFixture } from '../fixtures/backend'

test('real Electron edits original memory and arrangements, handles two-device conflicts and lost responses', async () => {
  test.setTimeout(150000)
  const rig = await yukiFixture({ character: true })
  let a = await rig.launch('character-a')
  const b = await rig.launch('character-b')
  let success = false
  try {
    let pa = await a.firstWindow()
    const pb = await b.firstWindow()
    const errors: string[] = []
    pa.on('pageerror', (error) => errors.push(error.message))
    pb.on('pageerror', (error) => errors.push(error.message))
    await pairUI(pa, rig.base, await rig.code())
    await pa.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('這是記憶的原始依據。')
    await pa.getByRole('button', { name: '送出', exact: true }).click()
    await expect(pa.getByText('真實帳本回覆', { exact: true })).toBeVisible()
    const seed = await fetch(`${rig.base}/__test/character-data`, { method: 'POST' })
    const seeded = await seed.json()
    expect(seed.status, JSON.stringify(seeded)).toBe(200)
    const connection = (await pa.evaluate(async () => {
      const result = await window.yuki.client.connections()
      if (!result.ok) throw Error(result.code)
      return result.value[0]
    })) as Connection
    await pa.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await expect(pa.getByRole('button', { name: '已核對的記錄 52', exact: false })).toBeVisible()
    await expect(pa.getByRole('button', { name: /^已核對的記錄 / })).toHaveCount(50)
    await pa.screenshot({
      path: test.info().outputPath('about-memory.png'),
      animations: 'disabled',
    })
    await pa.getByRole('button', { name: '載入更多記憶' }).click()
    await expect(pa.getByRole('button', { name: /^已核對的記錄 / })).toHaveCount(52)
    await pa.getByRole('button', { name: '已核對的記錄 52', exact: false }).click()
    await pa.getByRole('button', { name: '這是記憶的原始依據。', exact: true }).click()
    await expect(pa.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toBeVisible()
    await expect(pa.locator(`article[data-event-id="${seeded.source_event_id}"]`)).toContainText(
      '這是記憶的原始依據。',
    )
    await pa.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await pairUI(pb, rig.base, await rig.code())
    await pb.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    for (const page of [pa, pb]) {
      await page.getByRole('button', { name: '已核對的記錄 52', exact: false }).click()
      await page.getByRole('button', { name: '更正', exact: true }).click()
    }
    await pa.getByRole('textbox', { name: '更正後的記憶' }).fill('A 保留的修正草稿')
    await pb.getByRole('textbox', { name: '更正後的記憶' }).fill('另一台已核對的修正')
    await pb.getByRole('button', { name: '送出更正' }).click()
    await expect(pb.getByRole('dialog')).not.toBeVisible()
    await pa.getByRole('button', { name: '送出更正' }).click()
    await expect(pa.getByRole('dialog')).toContainText('這則記憶已變更')
    await expect(pa.getByRole('textbox', { name: '更正後的記憶' })).toHaveValue('A 保留的修正草稿')
    await pa.getByRole('button', { name: '重新讀取記憶', exact: true }).click()
    await expect(pa.getByRole('button', { name: /^另一台已核對的修正/ })).toBeVisible()
    await pa.getByRole('button', { name: '更正', exact: true }).click()
    await pa.getByRole('textbox', { name: '更正後的記憶' }).fill('回應遺失後保留同一次修正')
    await fetch(`${rig.base}/__test/lose-next-memory-response`, { method: 'POST' })
    await pa.getByRole('button', { name: '送出更正' }).click()
    await pa.getByRole('button', { name: '取消', exact: true }).click()
    await expect
      .poll(() =>
        pa.evaluate(async (id) => {
          const result = await window.yuki.client.characterCommands(id)
          return result.ok
            ? result.value.find(
                (item) =>
                  item.command.kind === 'memory' &&
                  item.command.text === '回應遺失後保留同一次修正',
              )?.state
            : null
        }, connection.characterId),
      )
      .toBe('submitted')
    await a.close()
    await fetch(`${rig.base}/__test/release-original-queries`, { method: 'POST' })
    a = await rig.launch('character-a')
    pa = await a.firstWindow()
    pa.on('pageerror', (error) => errors.push(error.message))
    await pa.getByRole('button', { name: '關於 Yuki', exact: true }).click()
    await expect(pa.getByRole('button', { name: /^回應遺失後保留同一次修正/ })).toBeVisible()
    await expect
      .poll(() =>
        pa.evaluate(async (id) => {
          const result = await window.yuki.client.characterCommands(id)
          return result.ok
            ? result.value
                .filter((item) => item.command.kind === 'memory' && item.problem === null)
                .map((item) => item.state)
            : []
        }, connection.characterId),
      )
      .toEqual(['result'])
    const recovered = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.read<MemoryPage>(id, { kind: 'memory', about: 'me' })
      return result.ok
        ? result.value.items.filter((fact) => fact.text === '回應遺失後保留同一次修正')
        : []
    }, connection.characterId)
    expect(recovered).toHaveLength(1)
    await pa.getByRole('button', { name: /^回應遺失後保留同一次修正/ }).click()
    await pa.getByRole('button', { name: '請她忘記這件事' }).click()
    await pa.getByRole('button', { name: '確認忘記' }).click()
    await expect(pa.getByRole('dialog')).not.toBeVisible()
    await expect(pa.getByRole('button', { name: /^回應遺失後保留同一次修正/ })).toHaveCount(0)
    await pa.getByRole('tab', { name: '她自己', exact: true }).click()
    await pa.getByRole('button', { name: /^我會先核對依據/ }).click()
    await expect(pa.getByRole('button', { name: '更正', exact: true })).toHaveCount(0)
    await pa.getByRole('tab', { name: '安排', exact: true }).click()
    await pa.getByRole('button', { name: '暫停', exact: true }).click()
    await expect(pa.getByRole('button', { name: '恢復', exact: true })).toBeVisible()
    await pa.getByRole('button', { name: '恢復', exact: true }).click()
    await expect(pa.getByRole('button', { name: '暫停', exact: true })).toBeVisible()
    await pa.getByRole('button', { name: '刪除安排', exact: true }).click()
    await pb.getByRole('tab', { name: '安排', exact: true }).click()
    await pb.getByRole('button', { name: '暫停', exact: true }).click()
    await expect(pb.getByRole('button', { name: '恢復', exact: true })).toBeVisible()
    await pa.getByRole('dialog').getByRole('button', { name: '刪除安排', exact: true }).click()
    await expect(pa.getByRole('dialog')).not.toBeVisible()
    await expect(pa.getByRole('button', { name: '恢復', exact: true })).toBeVisible()
    await expect(
      pa.getByText('資料已在另一台裝置更新，請重新讀取。', { exact: true }),
    ).toBeVisible()
    await pa.getByRole('button', { name: '刪除安排', exact: true }).click()
    await pa.getByRole('dialog').getByRole('button', { name: '刪除安排', exact: true }).click()
    await expect(pa.getByRole('dialog')).not.toBeVisible()
    await expect(pa.getByText('已取消', { exact: true })).toBeVisible()
    const arrangements = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.read<AutomationPage>(id, {
        kind: 'automations',
        scope: 'mine',
      })
      return result.ok ? result.value.items : []
    }, connection.characterId)
    expect(arrangements).toHaveLength(1)
    expect(arrangements[0]?.state).toBe('cancelled')
    await pa.getByRole('tab', { name: '能力', exact: true }).click()
    await expect(pa.getByText('目前沒有已啟用的擴充。')).toBeVisible()
    await expect(pa.getByText('目前沒有環境工具清單。')).toBeVisible()
    await pa.getByRole('button', { name: '編輯角色資料' }).click()
    await pa.getByRole('textbox', { name: '名稱', exact: true }).fill('新名稱')
    await pb.getByRole('button', { name: '編輯角色資料' }).click()
    await pb.getByRole('textbox', { name: '名稱', exact: true }).fill('另一裝置的名稱')
    await pb.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(pb.getByRole('heading', { name: '另一裝置的名稱', exact: true })).toBeVisible()
    await pa.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(pa.getByRole('textbox', { name: '名稱', exact: true })).toHaveValue('新名稱')
    await expect(
      pa.getByText('角色資料已更新。你的輸入仍保留，儲存仍使用編輯前的版本。'),
    ).toBeVisible()
    await pa.getByRole('button', { name: '放棄並重新讀取' }).click()
    await pa.getByRole('button', { name: '編輯角色資料' }).click()
    await pa.getByRole('textbox', { name: '名稱', exact: true }).fill('新名稱')
    await pa.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(pa.getByRole('heading', { name: '新名稱', exact: true })).toBeVisible()
    const after = await pa.evaluate(async () => {
      const result = await window.yuki.client.connections()
      return result.ok ? result.value[0] : null
    })
    expect(after?.characterId).toBe(connection.characterId)
    expect(after?.personId).toBe(connection.personId)
    await pa.screenshot({
      path: test.info().outputPath('about-capabilities.png'),
      animations: 'disabled',
    })
    await fetch(`${rig.base}/__test/revoke-character-owner`, { method: 'POST' })
    await expect(pa.getByRole('button', { name: '編輯角色資料' })).toHaveCount(0)
    await pa.getByRole('tab', { name: '安排', exact: true }).click()
    await expect(pa.getByRole('tab', { name: '她的安排', exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
    success = true
  } finally {
    await a.close()
    await b.close()
    await rig.close(success)
  }
})
