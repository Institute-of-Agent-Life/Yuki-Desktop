import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'

test('draft model listing and probes use the real upstream without saving or counting usage', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-probes')
  let success = false
  try {
    const page = await app.firstWindow(),
      state = await rig.state()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page)
    const before = await page.evaluate(
      async (id) => ({
        bundle: await window.yuki.client.models.read(id),
        stats: await window.yuki.client.models.stats(id),
      }),
      original.characterId,
    )
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    await page.getByRole('button', { name: '新增連接', exact: true }).click()
    await page.getByRole('button', { name: '自訂（OpenAI 相容）', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '新增連接' }),
      list = sheet.getByRole('button', { name: '取得模型清單', exact: true })
    await writeFile(
      test.info().outputPath('model-probes-entry.json'),
      JSON.stringify({ discover: await list.count() }),
    )
    expect(await list.count()).toBe(1)
    await sheet.getByLabel('服務位址', { exact: true }).fill(state.model_upstream_url)
    await sheet.getByLabel('金鑰', { exact: true }).fill(state.model_upstream_key)
    await sheet.getByText('進階', { exact: true }).click()
    await sheet.getByLabel('逾時（秒）', { exact: true }).fill('20')
    await sheet.getByLabel('重試次數', { exact: true }).fill('0')
    await sheet.getByLabel('溫度', { exact: true }).fill('0.2')
    await sheet.getByLabel('預設輸出 token', { exact: true }).fill('16')
    await list.click()
    await expect(sheet.getByRole('checkbox', { name: 'fixture-chat-a', exact: true })).toBeVisible()
    await sheet.getByLabel('搜尋模型 ID', { exact: true }).fill('chat-b')
    await expect(sheet.getByRole('checkbox', { name: 'fixture-chat-a', exact: true })).toHaveCount(
      0,
    )
    await sheet.getByLabel('搜尋模型 ID', { exact: true }).fill('')
    await sheet.getByRole('checkbox', { name: 'fixture-chat-a', exact: true }).check()
    await sheet.getByRole('button', { name: '測試連接', exact: true }).click()
    await expect(sheet.getByText(/^可用 · .* 秒$/)).toBeVisible()
    await sheet.getByLabel('金鑰', { exact: true }).fill('invalid-synthetic-key')
    await sheet.getByRole('button', { name: '測試連接', exact: true }).click()
    await expect(sheet.getByText('金鑰驗證失敗', { exact: true })).toBeVisible()
    await sheet
      .getByLabel('服務位址', { exact: true })
      .fill(`${state.model_upstream_url}/unsupported`)
    await list.click()
    await expect(
      sheet.getByText('這個服務不提供模型清單，請手動輸入模型 ID', { exact: true }),
    ).toBeVisible()
    const after = await page.evaluate(
      async (id) => ({
        bundle: await window.yuki.client.models.read(id),
        stats: await window.yuki.client.models.stats(id),
      }),
      original.characterId,
    )
    expect(after).toEqual(before)
    const calls = await fetch(`${rig.base}/__test/model-upstream-calls`).then((response) =>
      response.json(),
    )
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'GET', authorized: true }),
        expect.objectContaining({ method: 'POST', model: 'fixture-chat-a', authorized: true }),
        expect.objectContaining({ method: 'POST', authorized: false }),
      ]),
    )
    await page.screenshot({ path: test.info().outputPath('model-settings-probes.png') })
    await writeFile(
      test.info().outputPath('model-probes.json'),
      JSON.stringify({ original, before, after, calls }, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
