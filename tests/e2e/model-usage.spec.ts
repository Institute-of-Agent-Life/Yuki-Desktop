/** D-6 failures: missing tables; invented zero usage; wrong latency units;
 * lost cache/success/failure facts; another Yuki's cached rows; ordinary access.
 * Invocation facts use the real repository, and all reads use the actual bridge.
 */
import { expect, test, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type { ModelStatsView } from '../../src/shared/models'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { sidebar } from '../fixtures/navigation'

async function seed(root: string, mode: 'first' | 'second') {
  const backend = process.env.YUKI_BACKEND_TEST_ROOT!,
    python = process.env.YUKI_BACKEND_TEST_PYTHON!
  const { stdout } = await promisify(execFile)(
    python,
    [join(process.cwd(), 'tests/fixtures/model-usage-seed.py'), '--root', root, '--mode', mode],
    {
      cwd: backend,
      env: { ...process.env, PYTHONPATH: [join(backend, 'src'), backend].join(delimiter) },
    },
  )
  return JSON.parse(stdout)
}

async function usage(page: Page) {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
  )
  await page.getByRole('tab', { name: '模型', exact: true }).click()
  await page.getByRole('tab', { name: '用量', exact: true }).click()
}

async function stats(page: Page, characterId: string): Promise<ModelStatsView> {
  const response = await page.evaluate((id) => window.yuki.client.models.stats(id), characterId)
  expect(response.ok).toBe(true)
  if (!response.ok) throw Error(response.code)
  return response.value
}

test('model usage renders real invocation aggregates and keeps each Yuki separate', async () => {
  test.setTimeout(120000)
  const first = await yukiFixture({ modelConfiguration: true }),
    second = await yukiFixture({ modelConfiguration: true }),
    app = await first.launch('model-usage')
  let success = false
  try {
    const facts = {
      first: await seed(first.root, 'first'),
      second: await seed(second.root, 'second'),
    }
    const page = await app.firstWindow()
    await pairUI(page, first.base, await first.code())
    const original = await currentConnection(page),
      initial = await stats(page, original.characterId)
    expect(initial.by_profile['usage-known']).toMatchObject({
      invocations: 2,
      successes: 1,
      failures: 1,
      average_latency_seconds: 2.5,
      prompt_tokens: 1200,
      completion_tokens: 37,
      cached_prompt_tokens: 400,
      cache_creation_input_tokens: 31,
      unknown_usage: 1,
    })
    expect(initial.by_profile['usage-zero']).toMatchObject({
      invocations: 1,
      prompt_tokens: 0,
      completion_tokens: 0,
      unknown_usage: 0,
    })
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const reducedMotion = page.getByRole('switch', { name: '減少動態', exact: true })
    if ((await reducedMotion.getAttribute('aria-checked')) !== 'true') await reducedMotion.click()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
    await usage(page)
    await page.screenshot({ path: test.info().outputPath('model-usage-initial.png') })
    await writeFile(
      test.info().outputPath('model-usage-initial.json'),
      JSON.stringify(
        {
          original,
          facts,
          stats: initial,
          tables: await page.getByRole('table').count(),
        },
        null,
        2,
      ),
    )
    const tasks = page.getByRole('table', { name: '按用途', exact: true }),
      profiles = page.getByRole('table', { name: '按模型', exact: true })
    await expect(tasks).toBeVisible()
    await expect(profiles).toBeVisible()
    await expect(
      tasks
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: '記憶擷取', exact: true }) })
        .getByRole('cell'),
    ).toHaveText(['2', '1／1', '2.5 秒', '1,200', '37', '400', '31', '1'])
    await expect(tasks.getByRole('rowheader', { name: 'web_search', exact: true })).toBeVisible()
    const known = profiles
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: 'usage-known', exact: true }) })
    await expect(known.getByRole('cell')).toHaveText([
      '2',
      '1／1',
      '2.5 秒',
      '1,200',
      '37',
      '400',
      '31',
      '1',
    ])
    await expect(
      profiles
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader', { name: 'usage-zero', exact: true }) })
        .getByRole('cell'),
    ).toHaveText(['1', '1／0', '0 秒', '0', '0', '0', '0', '0'])
    const captures = []
    for (const width of [1280, 960, 720]) {
      await page.setViewportSize({ width, height: 850 })
      await page.screenshot({ path: test.info().outputPath(`model-usage-${width}.png`) })
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        tables: Array.from(document.querySelectorAll('table')).map((table) => ({
          name: table.caption!.textContent,
          width: table.scrollWidth,
          containerWidth: table.parentElement!.clientWidth,
        })),
      }))
      expect(geometry.documentWidth).toBe(geometry.width)
      captures.push(geometry)
    }
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await (await sidebar(page)).getByRole('button', { name: '切換 Yuki', exact: true }).click()
    await page.getByRole('menuitem', { name: '連接另一個 Yuki', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    const connections = await page.evaluate(async () => {
        const result = await window.yuki.client.connections()
        if (!result.ok) throw Error(result.code)
        return result.value
      }),
      other = connections.find(
        (connection) => connection.baseUrl.replace(/\/+$/, '') === second.base,
      )!
    const otherStats = await stats(page, other.characterId)
    expect(otherStats.by_profile['other-yuki']).toMatchObject({
      invocations: 1,
      prompt_tokens: 8,
      completion_tokens: 2,
    })
    await usage(page)
    await expect(profiles.getByRole('rowheader', { name: 'other-yuki', exact: true })).toBeVisible()
    await expect(profiles.getByRole('rowheader', { name: 'usage-known', exact: true })).toHaveCount(
      0,
    )
    await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
    await page
      .getByRole('menuitemradio')
      .and(page.getByTitle(original.baseUrl, { exact: true }))
      .click()
    await page.getByRole('tab', { name: '用量', exact: true }).click()
    await expect(known).toBeVisible()
    await expect(profiles.getByRole('rowheader', { name: 'other-yuki', exact: true })).toHaveCount(
      0,
    )
    expect(await stats(page, original.characterId)).toEqual(initial)
    await writeFile(
      test.info().outputPath('model-usage.json'),
      JSON.stringify(
        {
          original,
          other,
          facts,
          stats: initial,
          otherStats,
          captures,
          visible: await page.locator('body').innerText(),
        },
        null,
        2,
      ),
    )
    success = true
  } finally {
    await app.close()
    await first.close(success)
    await second.close(success)
  }
})

test('ordinary people receive the real model usage denial without a table', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('ordinary-model-usage')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, (await rig.state()).nonowner_pairing_code)
    const original = await currentConnection(page),
      response = await page.evaluate(
        (id) => window.yuki.client.models.stats(id),
        original.characterId,
      )
    expect(response).toMatchObject({ ok: false, code: 'capability_denied' })
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    await expect(page.getByText('只有 Yuki 的管理員可以修改模型設定')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('model-usage-ordinary.png') })
    await writeFile(
      test.info().outputPath('model-usage-ordinary.json'),
      JSON.stringify({ original, response }, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('revoking the current administrator hides loaded model usage and configuration', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ modelConfiguration: true }),
    app = await rig.launch('revoked-model-usage')
  let success = false
  try {
    await seed(rig.root, 'first')
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page)
    await usage(page)
    await expect(
      page
        .getByRole('table', { name: '按模型', exact: true })
        .getByRole('rowheader', { name: 'usage-known', exact: true }),
    ).toBeVisible()
    const response = await fetch(`${rig.base}/__test/superuser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: (await rig.state()).owner_person_id, enabled: false }),
    })
    expect(response.status).toBe(200)
    await expect(page.getByText('只有 Yuki 的管理員可以修改模型設定')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '新增連接', exact: true })).toHaveCount(0)
    const denied = await page.evaluate(
      (id) => window.yuki.client.models.stats(id),
      original.characterId,
    )
    expect(denied).toMatchObject({ ok: false, code: 'capability_denied' })
    expect(await currentConnection(page)).toEqual(original)
    await page.screenshot({ path: test.info().outputPath('model-usage-revoked.png') })
    await writeFile(
      test.info().outputPath('model-usage-revoked.json'),
      JSON.stringify(
        { original, denied, visible: await page.locator('body').innerText() },
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
