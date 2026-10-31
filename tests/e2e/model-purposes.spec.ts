import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'

test('semantic observation uses provider metadata and preserves explicit route selection', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-semantic')
  let success = false
  try {
    const page = await app.firstWindow(),
      state = await rig.state()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page),
      read = () => page.evaluate((id) => window.yuki.client.models.read(id), original.characterId)
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    await page.getByRole('tab', { name: '用途', exact: true }).click()
    await page.getByRole('button', { name: '新增判斷連接', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '參與判斷連接', exact: true })
    await sheet.getByLabel('連接 ID', { exact: true }).fill('fixturesemantic')
    await sheet.getByLabel('Provider', { exact: true }).selectOption('custom')
    await sheet.getByLabel('服務位址', { exact: true }).fill(state.model_upstream_url)
    await sheet.getByLabel('金鑰環境變數', { exact: true }).fill('YUKI_SEMANTIC_FIXTURE')
    await sheet.getByLabel('請求模型', { exact: true }).fill('fixture-semantic')
    await sheet.getByLabel('金鑰', { exact: true }).fill(state.model_upstream_key)
    await sheet.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(sheet).not.toBeVisible()
    const saved = await read()
    expect(saved.ok && saved.value.valid && saved.value.document.semantic_observation?.route).toBe(
      '',
    )
    expect(saved.ok && saved.value.valid && saved.value.saved_semantic_keys).toContain(
      'fixturesemantic',
    )
    await page.getByLabel('判斷連接', { exact: true }).selectOption('fixturesemantic')
    await expect
      .poll(async () => {
        const bundle = await read()
        return bundle.ok && bundle.value.valid && bundle.value.document.semantic_observation?.route
      })
      .toBe('fixturesemantic')
    const after = await read()
    expect(
      after.ok &&
        after.value.valid &&
        after.value.document.semantic_observation?.connections?.fixturesemantic,
    ).toMatchObject({
      provider: 'custom',
      request_model: 'fixture-semantic',
      endpoint: state.model_upstream_url,
      api_key_env: 'YUKI_SEMANTIC_FIXTURE',
    })
    expect(JSON.stringify(after)).not.toContain(state.model_upstream_key)
    await page.screenshot({ path: test.info().outputPath('model-settings-semantic.png') })
    await writeFile(
      test.info().outputPath('model-semantic.json'),
      JSON.stringify({ original, saved, after }, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('model purposes save original routes embedding confirmation and auxiliary enable facts', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-purposes')
  let success = false
  const logs: string[] = []
  app.process().stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
  app.process().stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
  try {
    const page = await app.firstWindow(),
      state = await rig.state()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page)
    const seed = await page.evaluate(
      async ({ id, endpoint, key }) => {
        const before = await window.yuki.client.models.read(id)
        if (!before.ok || !before.value.valid) throw Error('Expected actual model document')
        const document = structuredClone(before.value.document),
          profile = document.profiles[Object.keys(document.profiles)[0]!]!
        document.profiles['fixture-image'] = {
          ...profile,
          provider: 'openai_compatible',
          protocol: 'chat_completions',
          base_url: endpoint,
          model: 'fixture-chat-a',
          api_key_env: 'YUKI_PURPOSE_KEY',
          capabilities: ['tools', 'structured_output', 'image_input'],
        }
        document.profiles['fixture-responses'] = {
          ...document.profiles['fixture-image'],
          protocol: 'responses',
          model: 'fixture-chat-b',
        }
        return window.yuki.client.models.apply(id, {
          requestId: crypto.randomUUID(),
          expectedRevision: before.value.revision,
          document,
          apiKeys: { YUKI_PURPOSE_KEY: key },
        })
      },
      {
        id: original.characterId,
        endpoint: state.model_upstream_url,
        key: state.model_upstream_key,
      },
    )
    expect(seed.ok && seed.value.success).toBe(true)
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    await page.getByRole('tab', { name: '用途', exact: true }).click()
    await expect(page.getByRole('heading', { name: '模型用途', exact: true })).toBeVisible()
    const route = page.getByLabel('記憶擷取', { exact: true })
    await writeFile(
      test.info().outputPath('model-purposes-entry.json'),
      JSON.stringify({ memoryExtraction: await route.count() }),
    )
    expect(await route.count()).toBe(1)
    const searchMode = page.getByRole('combobox', { name: '搜尋模式', exact: true })
    await writeFile(
      test.info().outputPath('model-search-mode-entry.json'),
      JSON.stringify({ mode: await searchMode.count() }),
    )
    expect(await searchMode.count()).toBe(1)
    await searchMode.selectOption('both')
    await expect
      .poll(async () => {
        const result = await page.evaluate(
          (id) => window.yuki.client.models.read(id),
          original.characterId,
        )
        return result.ok && result.value.valid && result.value.document.search?.mode
      })
      .toBe('both')
    await route.selectOption('fixture-image')
    const read = () =>
      page.evaluate((id) => window.yuki.client.models.read(id), original.characterId)
    await expect
      .poll(async () => {
        const result = await read()
        return result.ok && result.value.valid && result.value.document.routes.memory_extraction
      })
      .toBe('fixture-image')
    await page.getByRole('combobox', { name: '記憶向量', exact: true }).selectOption('none')
    await expect
      .poll(async () => {
        const result = await read()
        return result.ok && result.value.valid && result.value.document.embedding?.enabled
      })
      .toBe(false)
    const disabledEmbedding = await read()
    await page.getByRole('button', { name: '設定記憶向量', exact: true }).click()
    const embedding = page.getByRole('dialog', { name: '記憶向量', exact: true })
    await embedding
      .getByLabel('向量服務預設', { exact: true })
      .selectOption({ label: '自訂（OpenAI 相容）' })
    await embedding.getByLabel('服務位址', { exact: true }).fill(state.model_upstream_url)
    await embedding.getByLabel('金鑰', { exact: true }).fill(state.model_upstream_key)
    await embedding.getByLabel('模型 ID', { exact: true }).fill('fixture-embedding')
    await embedding.getByLabel('維度', { exact: true }).fill('3')
    await embedding.getByRole('button', { name: '儲存', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: '更換記憶向量', exact: true })
    await expect(
      confirm.getByText(
        '更換後會建立新的向量索引並重新計算所有記憶的向量，期間語義搜尋會暫時只用關鍵字。舊索引保留，不會刪除。',
        { exact: true },
      ),
    ).toBeVisible()
    await confirm.getByRole('button', { name: '確認更換', exact: true }).click()
    await expect(confirm).not.toBeVisible()
    const vector = await read()
    expect(vector.ok && vector.value.valid && vector.value.document.embedding).toMatchObject({
      enabled: true,
      provider: 'openai_compatible',
      base_url: state.model_upstream_url,
      model: 'fixture-embedding',
      dimensions: 3,
    })
    const vision = page.getByLabel('圖片理解', { exact: true })
    await expect(vision.locator('option[value="fixture-responses"]')).toHaveCount(0)
    await vision.selectOption('fixture-image')
    await expect
      .poll(async () => {
        const result = await read()
        return result.ok && result.value.valid && result.value.document.vision?.enabled
      })
      .toBe(true)
    await page.getByLabel('語音轉文字', { exact: true }).selectOption('fixture-image')
    await expect
      .poll(async () => {
        const result = await read()
        return result.ok && result.value.valid && result.value.document.asr?.enabled
      })
      .toBe(true)
    await vision.selectOption('none')
    await expect
      .poll(async () => {
        const result = await read()
        return result.ok && result.value.valid && result.value.document.vision?.enabled
      })
      .toBe(false)
    await page.getByLabel('語音轉文字', { exact: true }).selectOption('none')
    await expect
      .poll(async () => {
        const result = await read()
        return result.ok && result.value.valid && result.value.document.asr?.enabled
      })
      .toBe(false)
    await page.getByRole('radio', { name: 'Tavily', exact: true }).click()
    await page.getByLabel('Tavily 金鑰', { exact: true }).fill(state.model_upstream_key)
    await page.getByRole('button', { name: '儲存 Tavily 金鑰', exact: true }).click()
    await expect(page.getByLabel('Tavily 金鑰', { exact: true })).toHaveValue('')
    const searchBoth = await read()
    expect(searchBoth.ok && searchBoth.value.valid && searchBoth.value.document.search?.mode).toBe(
      'both',
    )
    await searchMode.selectOption('tavily')
    await expect
      .poll(async () => {
        const result = await read()
        return result.ok && result.value.valid && result.value.document.search?.mode
      })
      .toBe('tavily')
    await page.getByLabel('Tavily 金鑰', { exact: true }).fill('fixture-tavily-replacement')
    await page.getByRole('button', { name: '儲存 Tavily 金鑰', exact: true }).click()
    await expect(page.getByLabel('Tavily 金鑰', { exact: true })).toHaveValue('')
    const searchTavily = await read()
    expect(
      searchTavily.ok && searchTavily.value.valid && searchTavily.value.document.search?.mode,
    ).toBe('tavily')
    await searchMode.selectOption('disabled')
    await expect
      .poll(async () => {
        const result = await read()
        return result.ok && result.value.valid && result.value.document.search?.mode
      })
      .toBe('disabled')
    await page.getByLabel('Tavily 金鑰', { exact: true }).fill('fixture-tavily-disabled')
    await page.getByRole('button', { name: '儲存 Tavily 金鑰', exact: true }).click()
    await expect(page.getByLabel('Tavily 金鑰', { exact: true })).toHaveValue('')
    const after = await read()
    expect(after.ok && after.value.valid && after.value.saved_connection_keys).toContain('search')
    expect(after.ok && after.value.valid && after.value.document.search?.mode).toBe('disabled')
    expect(after.ok && after.value.valid && after.value.document.vision?.model).toBe(
      'fixture-chat-a',
    )
    expect(after.ok && after.value.valid && after.value.document.asr?.model).toBe('fixture-chat-a')
    expect(await currentConnection(page)).toEqual(original)
    expect(JSON.stringify(after)).not.toContain(state.model_upstream_key)
    expect(await page.locator('body').innerText()).not.toContain(state.model_upstream_key)
    expect(logs.join('')).not.toContain(state.model_upstream_key)
    await page.screenshot({ path: test.info().outputPath('model-settings-purposes.png') })
    await writeFile(
      test.info().outputPath('model-purposes.json'),
      JSON.stringify(
        {
          original,
          seed,
          disabledEmbedding,
          vector,
          searchBoth,
          searchTavily,
          after,
          mainLogContainsKey: false,
        },
        null,
        2,
      ),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
