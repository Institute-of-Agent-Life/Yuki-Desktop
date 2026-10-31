import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'

test('same-name model connections retain separate original profiles and saved credentials', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-duplicate-connections')
  let success = false
  const logs: string[] = []
  app.process().stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
  app.process().stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
  try {
    const page = await app.firstWindow(),
      state = await rig.state(),
      secondKey = 'different-synthetic-duplicate-key'
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page),
      before = await page.evaluate((id) => window.yuki.client.models.read(id), original.characterId)
    if (!before.ok || !before.value.valid) throw Error('Expected the actual editable bundle')
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    const savedIds: string[] = []
    let previousIds = Object.keys(before.value.document.profiles)
    for (const key of [state.model_upstream_key, secondKey]) {
      await page.getByRole('button', { name: '新增連接', exact: true }).click()
      await page.getByRole('button', { name: '自訂（OpenAI 相容）', exact: true }).click()
      const sheet = page.getByRole('dialog', { name: '新增連接' })
      await sheet.getByLabel('連接名稱', { exact: true }).fill('Repeated fixture connection')
      await sheet.getByLabel('服務位址', { exact: true }).fill(state.model_upstream_url)
      await sheet.getByLabel('金鑰', { exact: true }).fill(key)
      await sheet.getByLabel('模型 ID', { exact: true }).fill('fixture-chat-a')
      await sheet.getByRole('button', { name: '加入模型', exact: true }).click()
      await sheet.getByText('進階', { exact: true }).click()
      await sheet.getByLabel('逾時（秒）', { exact: true }).fill('20')
      await sheet.getByLabel('重試次數', { exact: true }).fill('0')
      await sheet.getByLabel('溫度', { exact: true }).fill('0.2')
      await sheet.getByLabel('預設輸出 token', { exact: true }).fill('16')
      await sheet.getByRole('button', { name: '儲存', exact: true }).click()
      await expect(sheet).not.toBeVisible()
      const saved = await page.evaluate(
        (id) => window.yuki.client.models.read(id),
        original.characterId,
      )
      if (!saved.ok || !saved.value.valid) throw Error('Expected the saved actual bundle')
      const added = Object.keys(saved.value.document.profiles).filter(
        (id) => !previousIds.includes(id),
      )
      expect(added).toHaveLength(1)
      savedIds.push(added[0]!)
      previousIds = Object.keys(saved.value.document.profiles)
    }
    expect(savedIds[1]).toBe(`${savedIds[0]}-2`)
    const result = await page.evaluate(
      async ({ id, profiles }) => {
        const bundle = await window.yuki.client.models.read(id)
        const first = await window.yuki.client.models.test(id, { profile_id: profiles[0]! })
        const second = await window.yuki.client.models.test(id, { profile_id: profiles[1]! })
        return { bundle, first, second }
      },
      { id: original.characterId, profiles: savedIds },
    )
    if (!result.bundle.ok || !result.bundle.value.valid)
      throw Error('Expected actual persisted profiles')
    const first = result.bundle.value.document.profiles[savedIds[0]!]!,
      second = result.bundle.value.document.profiles[savedIds[1]!]!
    expect(first.model).toBe('fixture-chat-a')
    expect(second.model).toBe('fixture-chat-a')
    expect(first.api_key_env).not.toBe(second.api_key_env)
    expect(result.first).toMatchObject({ ok: true, value: { ok: true } })
    expect(result.second).toMatchObject({
      ok: true,
      value: { ok: false, error_category: 'authentication' },
    })
    const calls = await fetch(`${rig.base}/__test/model-upstream-calls`).then((response) =>
      response.json(),
    )
    expect(calls).toEqual([
      expect.objectContaining({ method: 'POST', model: 'fixture-chat-a', authorized: true }),
      expect.objectContaining({ method: 'POST', model: 'fixture-chat-a', authorized: false }),
    ])
    for (const key of [state.model_upstream_key, secondKey]) {
      expect(JSON.stringify(result)).not.toContain(key)
      expect(await page.locator('body').innerText()).not.toContain(key)
      expect(logs.join('')).not.toContain(key)
    }
    expect(await currentConnection(page)).toEqual(original)
    await writeFile(
      test.info().outputPath('separate-saved-credentials.json'),
      JSON.stringify(
        { original, savedIds, result, calls, keysReturned: false, mainLogContainsKey: false },
        null,
        2,
      ),
    )
    await page.screenshot({ path: test.info().outputPath('separate-saved-credentials.png') })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('editing resolved public environment fields retires only their original indirections', async () => {
  test.setTimeout(120000)
  const publicEnvironment = {
    LLM_BASE_URL: 'https://env-fixture.invalid/v1',
    LLM_REASONING_EFFORT: 'low',
  }
  const previous = Object.fromEntries(
    Object.keys(publicEnvironment).map((key) => [key, process.env[key]]),
  )
  const rig = await (async () => {
      Object.assign(process.env, publicEnvironment)
      try {
        return await yukiFixture({ modelConfiguration: true })
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }
    })(),
    app = await rig.launch('model-edited-environment')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page),
      seeded = await page.evaluate(
        async ({ id, requestId }) => {
          const before = await window.yuki.client.models.read(id)
          if (!before.ok || !before.value.valid)
            throw Error('Expected actual editable model bundle')
          const document = structuredClone(before.value.document)
          document.profiles.main = {
            ...document.profiles.main,
            base_url: 'https://literal-fixture.invalid/v1',
            model: 'literal-fixture-model',
            reasoning_effort: 'high',
            base_url_env: 'LLM_BASE_URL',
            model_env: 'LLM_MODEL',
            reasoning_effort_env: 'LLM_REASONING_EFFORT',
            thinking_mode: 'disabled',
            thinking_enabled: false,
          }
          const applied = await window.yuki.client.models.apply(id, {
            requestId,
            expectedRevision: before.value.revision,
            document,
          })
          const saved = await window.yuki.client.models.read(id)
          return { applied, saved }
        },
        { id: original.characterId, requestId: randomUUID() },
      )
    expect(seeded.applied).toMatchObject({ ok: true, value: { success: true } })
    if (!seeded.saved.ok || !seeded.saved.value.valid) throw Error('Expected persisted seed bundle')
    expect(seeded.saved.value.resolved_profiles?.main).toMatchObject({
      base_url: publicEnvironment.LLM_BASE_URL,
      model: 'fake-model',
      reasoning_effort: publicEnvironment.LLM_REASONING_EFFORT,
    })
    const effective = seeded.saved.value.resolved_profiles!.main!
    for (const key of ['base_url', 'model', 'reasoning_effort'] as const)
      expect(effective[key]).not.toBe(seeded.saved.value.document.profiles.main![key])
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    await page.getByRole('button', { name: /^編輯 fake-model ·/ }).click()
    const edit = page.getByRole('dialog', { name: '編輯模型' })
    await edit.getByText('進階', { exact: true }).click()
    await expect(edit.getByLabel('服務位址', { exact: true })).toHaveValue(
      String(effective.base_url),
    )
    await expect(edit.getByLabel('模型 ID', { exact: true })).toHaveValue(String(effective.model))
    await expect(edit.getByLabel('思考程度', { exact: true })).toHaveValue(
      String(effective.reasoning_effort),
    )
    await edit.getByLabel('服務位址', { exact: true }).fill('https://edited-fixture.invalid/v1')
    await edit.getByLabel('模型 ID', { exact: true }).fill('fixture-edited-model')
    await edit.getByLabel('思考程度', { exact: true }).selectOption('medium')
    await edit.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(edit).not.toBeVisible()
    const saved = await page.evaluate(
      (id) => window.yuki.client.models.read(id),
      original.characterId,
    )
    if (!saved.ok || !saved.value.valid) throw Error('Expected actual edited model bundle')
    const main = saved.value.document.profiles.main!
    for (const key of ['base_url_env', 'model_env', 'reasoning_effort_env'])
      expect(main).not.toHaveProperty(key)
    expect(main).toMatchObject({
      base_url: 'https://edited-fixture.invalid/v1',
      model: 'fixture-edited-model',
      reasoning_effort: 'medium',
      thinking_mode: 'disabled',
      thinking_enabled: false,
    })
    expect(saved.value.resolved_profiles?.main).toMatchObject({
      base_url: 'https://edited-fixture.invalid/v1',
      model: 'fixture-edited-model',
      reasoning_effort: 'medium',
    })
    const unchanged = { ...seeded.saved.value.document.profiles.main },
      after = { ...main }
    for (const key of [
      'base_url',
      'model',
      'reasoning_effort',
      'base_url_env',
      'model_env',
      'reasoning_effort_env',
    ] as const) {
      delete unchanged[key]
      delete after[key]
    }
    after.capabilities = [...after.capabilities!].sort()
    unchanged.capabilities = [...unchanged.capabilities!].sort()
    expect(after).toEqual(unchanged)
    expect(await currentConnection(page)).toEqual(original)
    await writeFile(
      test.info().outputPath('edited-environment-sources.json'),
      JSON.stringify({ original, seeded, saved, otherFieldsUnchanged: true }, null, 2),
    )
    await page.screenshot({ path: test.info().outputPath('edited-environment-sources.png') })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
