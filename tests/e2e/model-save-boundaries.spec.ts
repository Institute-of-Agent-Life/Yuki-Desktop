import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'

async function editor(page: Page) {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
  )
  await page.getByRole('tab', { name: '模型', exact: true }).click()
  await page.getByRole('button', { name: /^編輯 fake-model ·/ }).click()
  const sheet = page.getByRole('dialog', { name: '編輯模型', exact: true })
  await sheet.getByText('進階', { exact: true }).click()
  return sheet
}

test('model conflict reload keeps the unsaved write-only key and edits original fields', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-cas')
  let success = false
  try {
    const page = await app.firstWindow(),
      state = await rig.state()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page),
      sheet = await editor(page)
    await sheet.getByLabel('金鑰', { exact: true }).fill(state.model_upstream_key)
    await sheet.getByLabel('溫度', { exact: true }).fill('0.4')
    const concurrent = await page.evaluate(async (id) => {
      const bundle = await window.yuki.client.models.read(id)
      if (!bundle.ok || !bundle.value.valid) throw Error('Expected model bundle')
      const document = structuredClone(bundle.value.document)
      document.profiles.main!.default_temperature = 0.6
      return window.yuki.client.models.apply(id, {
        requestId: crypto.randomUUID(),
        expectedRevision: bundle.value.revision,
        document,
      })
    }, original.characterId)
    expect(concurrent.ok && concurrent.value.success).toBe(true)
    await sheet.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(sheet.getByText('設定已在其他地方變更', { exact: false })).toBeVisible()
    await sheet.getByRole('button', { name: '重新載入', exact: true }).click()
    await expect(sheet.getByText('設定已在其他地方變更', { exact: false })).not.toBeVisible()
    await expect(sheet.getByLabel('金鑰', { exact: true })).toHaveValue(state.model_upstream_key)
    await sheet.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(sheet).not.toBeVisible()
    const after = await page.evaluate(
      (id) => window.yuki.client.models.read(id),
      original.characterId,
    )
    expect(
      after.ok && after.value.valid && after.value.document.profiles.main!.default_temperature,
    ).toBe(0.4)
    expect(after.ok && after.value.valid && after.value.saved_api_key_profiles).toContain('main')
    expect(JSON.stringify(after)).not.toContain(state.model_upstream_key)
    await page.screenshot({ path: test.info().outputPath('model-settings-conflict.png') })
    await writeFile(
      test.info().outputPath('model-conflict.json'),
      JSON.stringify({ original, concurrent, after, keyRetainedUntilSuccess: true }, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('lost model apply response is confirmed with the same original UUID and receipt', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-lost-response')
  let success = false
  try {
    await app.evaluate(() => {
      const scope = globalThis as typeof globalThis & { modelRequests: string[] }
      scope.modelRequests = []
      const originalFetch = globalThis.fetch
      let discard = true
      globalThis.fetch = async (input, init) => {
        const response = await originalFetch(input, init)
        if (String(input).endsWith('/admin/v1/models/apply')) {
          scope.modelRequests.push(JSON.parse(String(init!.body)).request_id)
          if (discard) {
            discard = false
            await response.arrayBuffer()
            throw new TypeError('fixture discards the completed HTTP reply')
          }
        }
        return response
      }
    })
    const page = await app.firstWindow(),
      state = await rig.state()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page),
      sheet = await editor(page)
    await sheet.getByLabel('金鑰', { exact: true }).fill(state.model_upstream_key)
    await sheet.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(sheet.getByRole('button', { name: '重新確認', exact: true })).toBeVisible()
    await expect(sheet.getByText('模型設定等待確認', { exact: false })).toBeVisible()
    const stored = await page.evaluate(
      (id) => window.yuki.client.models.read(id),
      original.characterId,
    )
    expect(stored.ok && stored.value.valid && stored.value.saved_api_key_profiles).toContain('main')
    await sheet.getByRole('button', { name: '重新確認', exact: true }).click()
    await expect(sheet).not.toBeVisible()
    const requests = await app.evaluate(
      () => (globalThis as typeof globalThis & { modelRequests: string[] }).modelRequests,
    )
    expect(requests).toHaveLength(2)
    expect(requests[1]).toBe(requests[0])
    const after = await page.evaluate(
      (id) => window.yuki.client.models.read(id),
      original.characterId,
    )
    expect(after).toEqual(stored)
    expect(await currentConnection(page)).toEqual(original)
    await writeFile(
      test.info().outputPath('model-pending.json'),
      JSON.stringify({ original, requests, stored, after }, null, 2),
    )
    await page.screenshot({ path: test.info().outputPath('model-settings-pending.png') })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('explicit thinking edit removes the old mode without changing other profile sources', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-legacy-thinking')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page)
    const seed = await page.evaluate(async (id) => {
      const bundle = await window.yuki.client.models.read(id)
      if (!bundle.ok || !bundle.value.valid) throw Error('Expected model bundle')
      const document = structuredClone(bundle.value.document)
      document.profiles.main!.thinking_enabled = false
      document.profiles.main!.thinking_mode = 'disabled'
      return window.yuki.client.models.apply(id, {
        requestId: crypto.randomUUID(),
        expectedRevision: bundle.value.revision,
        document,
      })
    }, original.characterId)
    expect(seed.ok && seed.value.success).toBe(true)
    const sheet = await editor(page)
    await sheet.getByLabel('啟用思考', { exact: true }).selectOption('true')
    await sheet.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(sheet).not.toBeVisible()
    const after = await page.evaluate(
      (id) => window.yuki.client.models.read(id),
      original.characterId,
    )
    expect(
      after.ok && after.value.valid && after.value.document.profiles.main!.thinking_enabled,
    ).toBe(true)
    expect(after.ok && after.value.valid && after.value.document.profiles.main).not.toHaveProperty(
      'thinking_mode',
    )
    await writeFile(
      test.info().outputPath('model-thinking-source.json'),
      JSON.stringify({ original, seed, after }, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
