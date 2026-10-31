import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'

test('long work titles leave each factual status on one line without overflowing', async ({
  page,
}) => {
  const measurements = []
  await page.goto('http://127.0.0.1:4178/declutter.html')
  await expect(page.locator('article')).toHaveCount(5)
  const waiting = page
    .getByRole('article')
    .filter({ has: page.getByText('等你回覆', { exact: true }) })
  await expect(waiting).toContainText('請確認原工作需要的城市')
  await expect(waiting.getByRole('button', { name: '回覆', exact: true })).toBeVisible()
  await expect(waiting.getByRole('button', { name: '取消工作', exact: true })).toBeVisible()
  for (const width of [320, 360, 760, 1024]) {
    await page.setViewportSize({ width, height: 720 })
    const cards = await page.locator('article').evaluateAll((articles) =>
      articles.map((article) => {
        const title = article.querySelector('h3')!,
          pill = title.previousElementSibling!,
          text = [...pill.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!,
          range = document.createRange()
        range.selectNode(text)
        const rect = (element: Element) => {
          const { x, y, width, height, right, bottom } = element.getBoundingClientRect()
          return { x, y, width, height, right, bottom }
        }
        return {
          status: pill.textContent,
          textLines: range.getClientRects().length,
          card: rect(article),
          pill: rect(pill),
          title: rect(title),
          titleOverflow: title.scrollWidth > title.clientWidth,
        }
      }),
    )
    measurements.push({ viewport: { width, height: 720 }, cards })
    await writeFile(
      test.info().outputPath(`work-card-${width}.json`),
      JSON.stringify(cards, null, 2),
    )
    await page.screenshot({ path: test.info().outputPath(`work-card-${width}.png`) })
    for (const card of cards) {
      expect(card.textLines, card.status!).toBe(1)
      expect(card.pill.right).toBeLessThanOrEqual(card.title.x)
      expect(card.title.right).toBeLessThanOrEqual(card.card.right)
      expect(card.card.right).toBeLessThanOrEqual(width)
      expect(card.titleOverflow).toBe(true)
    }
  }
  await writeFile(
    test.info().outputPath('work-card-layout.json'),
    JSON.stringify(measurements, null, 2),
  )
})

test('file lists hide internal IDs while original distinct artifacts remain inspectable', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('declutter-files')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page),
      response = await fetch(`${rig.base}/__test/artifacts`, { method: 'POST' }),
      delivered = (await response.json()) as {
        artifact_id: string
        sha256: string
        name: string
        event_id: number
      }[]
    expect(response.status).toBe(200)
    expect(delivered[0]!.name).toBe(delivered[1]!.name)
    expect(delivered[0]!.artifact_id).not.toBe(delivered[1]!.artifact_id)
    await navigate(page, '檔案與成果')
    const rows = page.getByRole('button').filter({ hasText: 'same.md' })
    await expect(rows).toHaveCount(2)
    for (const artifact of delivered.slice(0, 2))
      expect(await rows.getByText(artifact.artifact_id, { exact: true }).count()).toBe(0)
    const preview = page.getByRole('region', { name: '成果預覽' }),
      details = preview
        .getByRole('region', { name: '成果資訊' })
        .locator('details')
        .filter({ hasText: '詳細資料' })
    await expect(
      preview.getByRole('heading', { name: 'First artifact', exact: true }),
    ).toBeVisible()
    await expect(details).toHaveJSProperty('open', false)
    await details.getByText('詳細資料', { exact: true }).click()
    await expect(details.getByText(delivered[0]!.artifact_id, { exact: true })).toBeVisible()
    expect(await details.locator('code[title]').getAttribute('title')).toBe(delivered[0]!.sha256)
    await page.screenshot({ path: test.info().outputPath('distinct-artifacts.png') })
    await page.keyboard.press('ControlOrMeta+1')
    await page
      .locator(`article[data-event-id="${delivered[0]!.event_id}"]`)
      .getByRole('button', { name: /same\.md/ })
      .click()
    const inspector = page.getByRole('complementary', { name: '詳情', exact: true }),
      sourceDetails = inspector
        .locator('details')
        .filter({ has: page.getByText('詳細資料', { exact: true }) })
    await expect(inspector.getByRole('heading', { name: 'same.md', exact: true })).toBeVisible()
    await expect(sourceDetails).toHaveJSProperty('open', false)
    await expect(sourceDetails.locator('code')).toBeHidden()
    await page.screenshot({ path: test.info().outputPath('artifact-inspector-default.png') })
    await sourceDetails.getByText('詳細資料', { exact: true }).click()
    await expect(sourceDetails.locator('code')).toContainText(delivered[0]!.artifact_id)
    await expect(sourceDetails.locator('code')).toHaveAttribute('title', delivered[0]!.sha256)
    expect(await currentConnection(page)).toEqual(original)
    await writeFile(
      test.info().outputPath('distinct-artifacts.json'),
      JSON.stringify({ original, delivered, hiddenDefaultIds: true }, null, 2),
    )
    await page.screenshot({ path: test.info().outputPath('original-artifact-inspector.png') })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('editing a model keeps its original profile parameters key and server-only headers', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true })
  const file = join(rig.root, 'models.toml')
  const app = await rig.launch('declutter-model')
  let success = false
  try {
    const page = await app.firstWindow(),
      state = await rig.state()
    await pairUI(page, rig.base, await rig.code())
    await writeFile(
      file,
      `${await readFile(file, 'utf8')}\n[profiles.main.headers]\nX-Fixture-Header = "synthetic-retained-header"\n`,
    )
    const original = await currentConnection(page),
      requestId = randomUUID(),
      seed = await page.evaluate(
        async ({ id, requestId, endpoint, key }) => {
          const before = await window.yuki.client.models.read(id)
          if (!before.ok || !before.value.valid) throw Error('Expected original model bundle')
          const document = structuredClone(before.value.document)
          document.profiles.main = {
            ...document.profiles.main,
            provider: 'openai_compatible',
            protocol: 'chat_completions',
            base_url: endpoint,
            model: 'fixture-chat-a',
            api_key_env: 'DECLUTTER_FIXTURE_KEY',
            default_temperature: 0.3,
            default_max_output_tokens: 8192,
            max_input_tokens: 32768,
            thinking_enabled: false,
            thinking_mode: 'disabled',
            search_mode: 'external',
            wire_options: {
              reasoning: 'thinking',
              native_web_search: false,
              reasoning_format: 'parsed',
              reasoning_split: false,
              replay_reasoning: true,
              send_reasoning_effort: false,
              send_temperature: false,
              send_tool_choice: true,
              thinking_budget_tokens: 3072,
              token_field: 'max_completion_tokens',
            },
          }
          document.profiles['pro-existing-16k'] = {
            ...document.profiles.main,
            default_max_output_tokens: 16384,
          }
          document.routes.utility_structured = 'pro-existing-16k'
          const applied = await window.yuki.client.models.apply(id, {
            requestId,
            expectedRevision: before.value.revision,
            document,
            apiKeys: { DECLUTTER_FIXTURE_KEY: key },
          })
          const saved = await window.yuki.client.models.read(id)
          return { applied, saved }
        },
        {
          id: original.characterId,
          requestId,
          endpoint: state.model_upstream_url,
          key: state.model_upstream_key,
        },
      )
    await writeFile(test.info().outputPath('model-seed-result.json'), JSON.stringify(seed, null, 2))
    expect(seed.applied).toMatchObject({ ok: true, value: { success: true } })
    if (!seed.saved.ok || !seed.saved.value.valid) throw Error('Expected original saved model')
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    await expect(page.getByText('pro-existing-16k', { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /^編輯 fixture-chat-a ·.*輸出 16,384 tokens/ }),
    ).toBeVisible()
    const editAction = page.getByRole('button', {
      name: /^編輯 fixture-chat-a ·.*輸出 8,192 tokens/,
    })
    expect(await editAction.count()).toBe(1)
    await editAction.click()
    const edit = page.getByRole('dialog', { name: '編輯模型' }),
      advanced = edit
        .locator('details')
        .filter({ has: page.locator('summary').filter({ hasText: /^進階$/ }) })
        .first()
    await expect(advanced).toHaveJSProperty('open', false)
    await expect(edit.getByLabel('模型 ID', { exact: true })).toHaveValue('fixture-chat-a')
    await expect(edit.getByText('main', { exact: true })).toBeHidden()
    await page.screenshot({ path: test.info().outputPath('model-editor-default.png') })
    await edit.getByLabel('模型 ID', { exact: true }).fill('fixture-chat-b')
    await edit.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(edit).not.toBeVisible()
    const after = await page.evaluate(
      (id) => window.yuki.client.models.read(id),
      original.characterId,
    )
    if (!after.ok || !after.value.valid) throw Error('Expected actual edited model')
    const priorProfile = { ...seed.saved.value.document.profiles.main, model: 'fixture-chat-b' },
      editedProfile = { ...after.value.document.profiles.main }
    priorProfile.capabilities = [...priorProfile.capabilities!].sort()
    editedProfile.capabilities = [...editedProfile.capabilities!].sort()
    expect(editedProfile).toEqual(priorProfile)
    expect(after.value.document.routes).toEqual(seed.saved.value.document.routes)
    expect(after.value.document.profiles['pro-existing-16k']).toEqual(
      seed.saved.value.document.profiles['pro-existing-16k'],
    )
    expect(after.value.saved_api_key_profiles).toContain('main')
    expect(await readFile(file, 'utf8')).toContain('X-Fixture-Header = "synthetic-retained-header"')
    expect(JSON.stringify({ seed, after })).not.toContain(state.model_upstream_key)
    expect(await page.locator('body').innerText()).not.toContain(state.model_upstream_key)
    expect(await currentConnection(page)).toEqual(original)
    const backgroundWindows = await app.evaluate(
      () =>
        (globalThis as typeof globalThis & { __yukiBackgroundWindows?: unknown })
          .__yukiBackgroundWindows,
    )
    await writeFile(
      test.info().outputPath('model-fields-retained.json'),
      JSON.stringify(
        {
          original,
          requestId,
          seed,
          after,
          headerRetained: true,
          keyReturned: false,
          backgroundWindows,
        },
        null,
        2,
      ),
    )
    await page.screenshot({ path: test.info().outputPath('model-fields-retained.png') })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
