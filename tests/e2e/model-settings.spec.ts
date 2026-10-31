import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'

test('model connections add grouped profiles with write-only keys and edit real schema fields', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-connections')
  let success = false
  const logs: string[] = []
  app.process().stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
  app.process().stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
  try {
    await app.evaluate(() => {
      const scope = globalThis as typeof globalThis & { modelApplyBody?: Promise<unknown> }
      const originalFetch = globalThis.fetch
      scope.modelApplyBody = new Promise((resolve) => {
        globalThis.fetch = (input, init) => {
          if (String(input).endsWith('/admin/v1/models/apply')) {
            const body = JSON.parse(String(init!.body))
            delete body.api_keys
            resolve(body)
          }
          return originalFetch(input, init)
        }
      })
    })
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    await expect(page.getByRole('heading', { name: '模型連接' })).toBeVisible()
    const add = page.getByRole('button', { name: '新增連接', exact: true })
    await writeFile(
      test.info().outputPath('model-connections-entry.json'),
      JSON.stringify({ add: await add.count() }),
    )
    expect(await add.count()).toBe(1)
    await add.click()
    await page.getByRole('button', { name: '自訂（OpenAI 相容）', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: '新增連接', includeHidden: true }),
      state = await rig.state()
    await sheet.getByLabel('連接名稱', { exact: true }).fill('Fixture connection')
    await sheet.getByLabel('服務位址', { exact: true }).fill(state.model_upstream_url)
    await sheet.getByLabel('金鑰', { exact: true }).fill(state.model_upstream_key)
    for (const id of ['fixture-chat-a', 'fixture-chat-b']) {
      await sheet.getByLabel('模型 ID', { exact: true }).fill(id)
      await sheet.getByRole('button', { name: '加入模型', exact: true }).click()
    }
    const advanced = sheet
      .locator('details')
      .filter({ has: page.getByText('進階', { exact: true }) })
    expect(await advanced.evaluate((element) => (element as HTMLDetailsElement).open)).toBe(false)
    await advanced.getByText('進階', { exact: true }).click()
    await sheet.getByLabel('逾時（秒）', { exact: true }).fill('20')
    await sheet.getByLabel('重試次數', { exact: true }).fill('0')
    await sheet.getByLabel('溫度', { exact: true }).fill('0.2')
    await sheet.getByLabel('預設輸出 token', { exact: true }).fill('16')
    for (const label of ['對話', '思考', '結構化'])
      await sheet.getByRole('checkbox', { name: label, exact: true }).check()
    await sheet.getByRole('button', { name: '儲存', exact: true }).click()
    const submitted = await app.evaluate(
      () => (globalThis as typeof globalThis & { modelApplyBody: Promise<unknown> }).modelApplyBody,
    )
    await writeFile(
      test.info().outputPath('model-connections-submitted.json'),
      JSON.stringify(submitted, null, 2),
    )
    await expect(
      sheet.getByRole('button', { name: '儲存', exact: true, includeHidden: true }),
    ).toHaveAttribute('aria-busy', 'false')
    await page.screenshot({ path: test.info().outputPath('model-connections-first-save.png') })
    await writeFile(
      test.info().outputPath('model-connections-first-save.json'),
      JSON.stringify(
        { sheetVisible: await sheet.isVisible(), text: await page.locator('body').innerText() },
        null,
        2,
      ),
    )
    expect(await sheet.isVisible()).toBe(false)
    const group = page.getByRole('region', { name: '自訂（OpenAI 相容）', exact: true })
    await expect(group.getByText('已儲存', { exact: true })).toBeVisible()
    await expect(group.getByText('fixture-chat-a', { exact: true })).toBeVisible()
    await expect(group.getByText('fixture-chat-b', { exact: true })).toBeVisible()
    await group.getByRole('button', { name: /^編輯 fixture-chat-a ·/ }).click()
    const edit = page.getByRole('dialog', { name: '編輯模型' })
    await expect(edit.getByLabel('金鑰', { exact: true })).toHaveValue('')
    await edit.getByText('進階', { exact: true }).click()
    await edit.getByLabel('溫度', { exact: true }).fill('0.4')
    await edit.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(edit).not.toBeVisible()
    const original = await currentConnection(page),
      bundle = await page.evaluate((id) => window.yuki.client.models.read(id), original.characterId)
    expect(
      bundle.ok &&
        bundle.value.valid &&
        bundle.value.document.profiles['fixture-connection-fixture-chat-a']?.default_temperature,
    ).toBe(0.4)
    expect(JSON.stringify(bundle)).not.toContain(state.model_upstream_key)
    expect(await page.locator('body').innerText()).not.toContain(state.model_upstream_key)
    expect(logs.join('')).not.toContain(state.model_upstream_key)
    await page.screenshot({ path: test.info().outputPath('model-settings-connections.png') })
    await writeFile(
      test.info().outputPath('model-connections.json'),
      JSON.stringify({ original, bundle, mainLogContainsKey: false }, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('model settings exposes three pages and ordinary people see the actual denial', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-settings-shell'),
    ordinary = await rig.launch('ordinary-model-settings-shell')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await expect(page.getByRole('tablist', { name: '設定分類' })).toBeVisible()
    const models = page.getByRole('tab', { name: '模型', exact: true })
    await writeFile(
      test.info().outputPath('model-settings-shell-entry.json'),
      JSON.stringify({ models: await models.count() }),
    )
    expect(await models.count()).toBe(1)
    await models.click()
    for (const name of ['連接', '用途', '用量']) {
      await page.getByRole('tab', { name, exact: true }).click()
      await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.screenshot({ path: test.info().outputPath(`model-settings-${name}.png`) })
    }
    const other = await ordinary.firstWindow()
    await pairUI(other, rig.base, (await rig.state()).nonowner_pairing_code)
    await other.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await other.getByRole('tab', { name: '模型', exact: true }).click()
    await expect(other.getByText('只有 Yuki 的管理員可以修改模型設定')).toBeVisible()
    await expect(other.getByRole('button', { name: '新增連接', exact: true })).toHaveCount(0)
    await other.screenshot({ path: test.info().outputPath('model-settings-ordinary.png') })
    await writeFile(
      test.info().outputPath('model-settings-shell.json'),
      JSON.stringify(
        {
          administrator: await currentConnection(page),
          ordinary: await currentConnection(other),
          pages: ['連接', '用途', '用量'],
        },
        null,
        2,
      ),
    )
    success = true
  } finally {
    await ordinary.close()
    await app.close()
    await rig.close(success)
  }
})

test('model administration bridge uses the paired Person original receipt and write-only key', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('model-bridge')
  let success = false
  const logs: string[] = []
  app.process().stdout?.on('data', (data: Buffer) => logs.push(data.toString()))
  app.process().stderr?.on('data', (data: Buffer) => logs.push(data.toString()))
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page)
    const bridgeExists = await page.evaluate(() => 'models' in window.yuki.client)
    await writeFile(
      test.info().outputPath('model-bridge-availability.json'),
      JSON.stringify(
        {
          original,
          bridgeExists,
        },
        null,
        2,
      ),
    )
    expect(bridgeExists).toBe(true)
    const state = await rig.state(),
      requestId = randomUUID()
    const result = await page.evaluate(
      async ({ id, requestId, endpoint, secret }) => {
        const before = await window.yuki.client.models.read(id)
        if (!before.ok || !before.value.valid) throw Error('Expected actual editable model bundle')
        const document = structuredClone(before.value.document),
          profileId = Object.keys(document.profiles)[0]!
        document.profiles[profileId] = {
          ...document.profiles[profileId],
          provider: 'openai_compatible',
          protocol: 'chat_completions',
          base_url: endpoint,
          model: 'fixture-chat-a',
          api_key_env: 'YUKI_MODEL_BRIDGE_KEY',
        }
        const input = {
          requestId,
          expectedRevision: before.value.revision,
          document,
          apiKeys: { YUKI_MODEL_BRIDGE_KEY: secret },
        }
        const first = await window.yuki.client.models.apply(id, input)
        const repeated = await window.yuki.client.models.apply(id, input)
        const after = await window.yuki.client.models.read(id)
        const stats = await window.yuki.client.models.stats(id, {
          range: 'all',
          timezone: 'Asia/Taipei',
        })
        return {
          profileId,
          before,
          first,
          repeated,
          after,
          stats,
          keyReturned: JSON.stringify({ before, first, repeated, after, stats }).includes(secret),
        }
      },
      {
        id: original.characterId,
        requestId,
        endpoint: state.model_upstream_url,
        secret: state.model_upstream_key,
      },
    )
    expect(result.first.ok && result.first.value.success).toBe(true)
    expect(result.repeated).toEqual(result.first)
    expect(
      result.after.ok && result.after.value.valid && result.after.value.saved_api_key_profiles,
    ).toContain(result.profileId)
    expect(result.keyReturned).toBe(false)
    expect(logs.join('').includes(state.model_upstream_key)).toBe(false)
    expect(await page.locator('body').innerText()).not.toContain(state.model_upstream_key)
    await writeFile(
      test.info().outputPath('model-bridge.json'),
      JSON.stringify(
        {
          original,
          requestId,
          result,
          mainLogContainsKey: false,
        },
        null,
        2,
      ),
    )
    await page.screenshot({ path: test.info().outputPath('model-bridge.png') })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('ordinary paired people cannot read the model administration bundle', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('ordinary-model-bridge')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, (await rig.state()).nonowner_pairing_code)
    const original = await currentConnection(page),
      result = await page.evaluate((id) => window.yuki.client.models.read(id), original.characterId)
    await writeFile(
      test.info().outputPath('ordinary-model-bridge.json'),
      JSON.stringify({ original, result }, null, 2),
    )
    expect(result).toMatchObject({ ok: false, code: 'capability_denied' })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
