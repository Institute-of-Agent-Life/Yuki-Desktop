import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'

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
        const stats = await window.yuki.client.models.stats(id)
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
