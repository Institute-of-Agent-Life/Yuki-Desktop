/** P3 failures: wrong day/range; raw-profile grouping; lost retired calls;
 * cache ratios from different samples; unknown rendered as zero; stale scope data;
 * revoked identity and a second Yuki sharing cached results. Real Bot HTTP/SQLite.
 */
import { expect, test, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type { ModelStatsQuery, ModelStatsView } from '../../src/shared/models'
import { currentConnection, pairUI } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { soulBackend } from '../fixtures/soul-backend'
import { captureViewport, contentSize } from '../fixtures/visual'

const timezone = 'Asia/Taipei'
const fixtureContext = {
  reference: 'soulBackend: desktop=False; existing authority fixture enabled',
  reason:
    'The general Desktop fixture publishes an artifact through a real Main turn before ready, adding two unknown-usage calls. This scenario starts without that unrelated bootstrap; no invocation rows are deleted or changed.',
}

async function usageBackend() {
  const previous = process.env.YUKI_AUTHORITY_FIXTURE
  process.env.YUKI_AUTHORITY_FIXTURE = '1'
  try {
    const rig = await soulBackend()
    return {
      ...rig,
      state: async () =>
        JSON.parse(await readFile(join(rig.root, 'server.json'), 'utf8')) as {
          nonowner_pairing_code: string
          owner_person_id: string
        },
    }
  } finally {
    if (previous === undefined) delete process.env.YUKI_AUTHORITY_FIXTURE
    else process.env.YUKI_AUTHORITY_FIXTURE = previous
  }
}
interface SeedFacts {
  method: string
  midnight: string
  timezone: string
  records: {
    id: number
    task: string
    provider: string
    model: string
    profile_id: string
    created_at: string
    total_tokens: number | null
  }[]
}

function localMidnight() {
  const now = new Date()
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  const date = [Number(values.year), Number(values.month) - 1, Number(values.day)] as const
  const renderedUtc = Date.UTC(
    ...date,
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  const offset = renderedUtc - Math.floor(now.getTime() / 1000) * 1000
  return new Date(Date.UTC(...date) - offset).toISOString()
}

async function seed(
  root: string,
  mode: 'first' | 'second' | 'unknown' | 'empty',
  midnight = localMidnight(),
): Promise<SeedFacts> {
  const backend = process.env.YUKI_BACKEND_TEST_ROOT!,
    python = process.env.YUKI_BACKEND_TEST_PYTHON!
  const { stdout } = await promisify(execFile)(
    python,
    [
      join(process.cwd(), 'tests/fixtures/model-usage-seed.py'),
      '--root',
      root,
      '--mode',
      mode,
      '--midnight',
      midnight,
      '--timezone',
      timezone,
    ],
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
const region = (page: Page) => page.getByRole('region', { name: '模型用量', exact: true })
const total = (page: Page) =>
  region(page).getByRole('status', { name: '已回報 Token', exact: true })
async function stats(
  page: Page,
  characterId: string,
  query: ModelStatsQuery,
): Promise<ModelStatsView> {
  const response = await page.evaluate(
    ({ id, query }) => window.yuki.client.models.stats(id, query),
    { id: characterId, query },
  )
  expect(response.ok).toBe(true)
  if (!response.ok) throw Error(response.code)
  return response.value
}
async function save(name: string, value: Record<string, unknown>) {
  await writeFile(
    test.info().outputPath(`${name}.json`),
    JSON.stringify({ fixtureContext, ...value }, null, 2) + '\n',
  )
}

test('model usage keeps original sources, ranges, same-sample cache and each Yuki separate', async () => {
  test.setTimeout(120000)
  const first = await usageBackend(),
    second = await usageBackend(),
    app = await first.launch('model-usage')
  let success = false
  try {
    const midnight = localMidnight(),
      facts = {
        first: await seed(first.root, 'first', midnight),
        second: await seed(second.root, 'second', midnight),
      }
    const page = await app.firstWindow()
    await pairUI(page, first.base, await first.code())
    const original = await currentConnection(page),
      end = new Date().toISOString()
    const query: ModelStatsQuery = { range: 'today', timezone, end }
    const initial = await stats(page, original.characterId, query)
    expect(initial.summary).toMatchObject({
      invocations: 6,
      successes: 5,
      failures: 1,
      prompt_tokens: 1900,
      completion_tokens: 190,
      total_tokens: 2090,
      cached_prompt_tokens: 830,
      cache_creation_input_tokens: 31,
      average_latency_seconds: 14 / 6,
      unknown_usage: 1,
      coverage: { prompt_tokens: 5, cached_prompt_tokens: 5, total_tokens: 5 },
      cache_read: {
        reported_calls: 4,
        prompt_tokens: 1700,
        cached_prompt_tokens: 800,
        ratio: 800 / 1700,
      },
    })
    expect(Date.parse(initial.range.start!)).toBe(Date.parse(midnight))
    const live = initial.groups.find(
      (item) => item.model === 'gemini-live' && item.provider === 'fixture-vendor',
    )!
    expect(live.stats).toMatchObject({
      invocations: 3,
      total_tokens: 1320,
      failures: 1,
      unknown_usage: 1,
    })
    expect(live.sources.map((item) => item.profile_id).sort()).toEqual([
      'connection_current',
      'connection_current.legacy-agent',
      'removed-profile',
    ])
    expect(
      initial.groups.find((item) => item.model === 'gemini-previous')!.sources[0]!.profile_id,
    ).toBe('connection_current')
    expect(initial.groups.find((item) => item.provider === 'other-vendor')!.model).toBe(
      'gemini-live',
    )
    const bundle = await page.evaluate(
      (id) => window.yuki.client.models.read(id),
      original.characterId,
    )
    expect(bundle.ok).toBe(true)
    if (!bundle.ok) throw Error(bundle.code)
    expect(bundle.value.tasks).not.toContain('planner')
    await usage(page)
    await expect(total(page)).toHaveText('2.09 K')
    await expect(region(page).getByText(/47\.1%/)).toBeVisible()
    await expect(region(page).getByTitle('830', { exact: true })).toHaveText('830')
    const explanation = region(page).getByText('統計說明', { exact: true }).locator('..')
    await explanation.locator('summary').click()
    await expect(explanation).toContainText('800／1,700 Token（4 次呼叫）')
    await explanation.locator('summary').click()
    await expect(region(page).getByRole('table')).toHaveCount(0)
    for (const id of ['connection_current', 'connection_current.legacy-agent', 'removed-profile'])
      await expect(
        region(page).getByText(id, { exact: true }).filter({ visible: true }),
      ).toHaveCount(0)
    const liveSummary = region(page)
      .locator('summary')
      .filter({ hasText: 'gemini-live' })
      .filter({ hasText: 'fixture-vendor' })
    await liveSummary.click()
    const liveGroup = liveSummary.locator('..')
    await expect(liveGroup).toHaveJSProperty('open', true)
    for (const [label, value] of [
      ['輸入 Token', '1,200'],
      ['輸出 Token', '120'],
      ['快取讀取', '530'],
      ['快取建立', '31'],
      ['呼叫次數', '3'],
      ['呼叫失敗', '1'],
      ['未完整回報用量', '1'],
      ['平均請求延遲', '2.333 秒'],
    ]) {
      await expect(
        liveGroup.getByText(label!, { exact: true }).locator('..').locator('dd'),
      ).toHaveText(value!)
    }
    await liveGroup.locator('summary').filter({ hasText: '來源資料' }).click()
    for (const id of live.sources.map((source) => source.profile_id))
      await expect(liveGroup.getByText(id, { exact: true })).toBeVisible()
    await liveGroup.locator('summary').filter({ hasText: '來源資料' }).click()
    await liveSummary.click()
    await expect(liveGroup).toHaveJSProperty('open', false)
    await expect(
      region(page)
        .locator('summary')
        .filter({ hasText: 'zero-model' })
        .getByTitle('0', { exact: true }),
    ).toHaveText('0')
    const captures = []
    // Narrow sizes measure the Usage column, alongside the existing Desktop navigation.
    for (const size of [
      { viewport: 568, column: 320 },
      { viewport: 608, column: 360 },
      { viewport: 760, column: null },
      { viewport: 1024, column: null },
    ]) {
      let width = size.viewport
      await contentSize(app, page, width, 850, { emulate: true })
      if (size.column !== null) {
        // Account for the real Desktop navigation, padding and platform scrollbar.
        width += size.column - (await region(page).evaluate((node) => node.clientWidth))
        await contentSize(app, page, width, 850, { emulate: true })
      }
      await expect(total(page)).toHaveText('2.09 K')
      await captureViewport(app, page, test.info().outputPath(`model-usage-${width}.png`))
      const geometry = await region(page).evaluate((node) => {
        const panel = node.closest('[role="tabpanel"]')!,
          rect = node.getBoundingClientRect()
        return {
          width: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          regionWidth: node.clientWidth,
          regionScrollWidth: node.scrollWidth,
          left: rect.left,
          right: rect.right,
          pixelLeft: Math.round(rect.left * devicePixelRatio),
          pixelRight: Math.round(rect.right * devicePixelRatio),
          panelWidth: panel.clientWidth,
          panelScrollWidth: panel.scrollWidth,
          values: [...node.querySelectorAll('output, select, summary > div:last-of-type')].map(
            (element) => {
              const bounds = element.getBoundingClientRect()
              return {
                text: element.textContent,
                left: bounds.left,
                right: bounds.right,
                pixelLeft: Math.round(bounds.left * devicePixelRatio),
                pixelRight: Math.round(bounds.right * devicePixelRatio),
              }
            },
          ),
          text: (node as HTMLElement).innerText,
        }
      })
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width)
      expect(geometry.regionScrollWidth).toBeLessThanOrEqual(geometry.regionWidth)
      expect(geometry.panelScrollWidth).toBeLessThanOrEqual(geometry.panelWidth)
      expect(geometry.left).toBeGreaterThanOrEqual(0)
      expect(geometry.right).toBeLessThanOrEqual(geometry.width)
      for (const value of geometry.values) {
        expect(value.pixelLeft).toBeGreaterThanOrEqual(geometry.pixelLeft)
        expect(value.pixelRight).toBeLessThanOrEqual(geometry.pixelRight)
      }
      if (size.column !== null) expect(geometry.regionWidth).toBe(size.column)
      captures.push(geometry)
    }
    expect(captures[0]!.regionWidth).toBe(320)
    expect(captures[1]!.regionWidth).toBe(360)
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'light'
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await contentSize(app, page, captures[1]!.width, 850, { emulate: true })
    await captureViewport(app, page, test.info().outputPath('model-usage-light-column-360.png'))
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'dark'
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await contentSize(app, page, 1440, 900)
    await region(page)
      .getByRole('combobox', { name: '篩選用途', exact: true })
      .selectOption('chat_agent')
    await expect(total(page)).toHaveText('1.87 K')
    await expect(region(page).getByText('篩選結果', { exact: true })).toBeVisible()
    const filteredTask = await stats(page, original.characterId, { ...query, task: 'chat_agent' })
    expect(filteredTask.summary.total_tokens).toBe(1870)
    expect(filteredTask.options).toEqual(initial.options)
    await region(page).getByRole('button', { name: '用途', exact: true }).click()
    await expect(total(page)).toHaveText('2.09 K')
    const modelFilter = region(page).getByRole('combobox', { name: '篩選模型', exact: true })
    await modelFilter.selectOption(JSON.stringify(['fixture-vendor', 'gemini-live']))
    await expect(total(page)).toHaveText('1.32 K')
    const filteredModel = await stats(page, original.characterId, {
      ...query,
      group_by: 'task',
      provider: 'fixture-vendor',
      model: 'gemini-live',
    })
    expect(filteredModel.summary).toMatchObject({ total_tokens: 1320, invocations: 3 })
    expect(filteredModel.options).toEqual(initial.options)
    await region(page).getByRole('button', { name: '近 7 天', exact: true }).click()
    await expect(total(page)).toHaveText('2.19 K')
    await region(page).getByRole('button', { name: '近 24 小時', exact: true }).click()
    const lastDay = await stats(page, original.characterId, { ...query, range: '24h' })
    const expectedDay = facts.first.records.filter(
      (record) =>
        Date.parse(record.created_at) >= Date.parse(lastDay.range.start!) &&
        Date.parse(record.created_at) < Date.parse(lastDay.range.end),
    )
    expect(lastDay.summary.total_tokens).toBe(
      expectedDay.reduce((sum, record) => sum + (record.total_tokens ?? 0), 0),
    )
    await expect(total(page)).toHaveAttribute(
      'title',
      new Intl.NumberFormat('zh-Hant-TW').format(lastDay.summary.total_tokens),
    )
    await region(page).getByRole('button', { name: '全部留存', exact: true }).click()
    await expect(total(page)).toHaveText('7.19 K')
    const all = await stats(page, original.characterId, {
      ...query,
      range: 'all',
      group_by: 'task',
    })
    expect(all.summary).toMatchObject({ invocations: 8, total_tokens: 7190, unknown_usage: 1 })
    const history = region(page)
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: '歷史用途' }) })
    await expect(history).toHaveJSProperty('open', false)
    await expect(
      region(page).getByText('planner', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
    await expect(
      region(page).getByText('聯網搜尋', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    await history.locator('summary').first().click()
    await expect(
      history.getByText('planner', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    expect(all.groups.find((item) => item.task === 'planner')!.sources[0]!.profile_id).toBe('flash')
    await save('model-usage-first', {
      original,
      facts,
      initial,
      filteredTask,
      filteredModel,
      lastDay,
      all,
      captures,
      bundleRevision: bundle.value.revision,
      tasks: bundle.value.tasks,
    })
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page
      .getByRole('navigation', { name: '主要導覽', exact: true })
      .getByRole('button', { name: '切換 Yuki', exact: true })
      .click()
    await page.getByRole('menuitem', { name: '連接另一個 Yuki', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    const connections = await page.evaluate(async () => {
      const result = await window.yuki.client.connections()
      if (!result.ok) throw Error(result.code)
      return result.value
    })
    const other = connections.find(
      (connection) => connection.baseUrl.replace(/\/+$/, '') === second.base,
    )!
    const otherStats = await stats(page, other.characterId, query)
    expect(otherStats.summary).toMatchObject({
      invocations: 1,
      total_tokens: 10,
      prompt_tokens: 8,
      completion_tokens: 2,
    })
    await usage(page)
    await expect(total(page)).toHaveText('10')
    await expect(
      region(page).getByText('other-yuki-model', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
    await expect(
      region(page).getByText('gemini-live', { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
    await page
      .getByRole('menuitemradio')
      .and(page.getByTitle(original.baseUrl, { exact: true }))
      .click()
    await page.getByRole('tab', { name: '用量', exact: true }).click()
    await region(page).getByRole('button', { name: '今日', exact: true }).click()
    await expect(total(page)).toHaveText('2.09 K')
    expect(await stats(page, original.characterId, query)).toEqual(initial)
    expect(
      await page.evaluate((id) => window.yuki.client.models.read(id), original.characterId),
    ).toEqual(bundle)
    const upstreamCalls = await fetch(first.base + '/__test/model-upstream-calls')
    expect(await upstreamCalls.json()).toEqual([])
    await save('model-usage-isolation', {
      original,
      other,
      otherStats,
      selected: await stats(page, original.characterId, query),
    })
    success = true
  } finally {
    await app.close()
    await first.close(success)
    await second.close(success)
  }
})

test('ordinary people receive real model usage denial without loaded totals', async () => {
  test.setTimeout(120000)
  const rig = await usageBackend(),
    app = await rig.launch('ordinary-model-usage')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, (await rig.state()).nonowner_pairing_code)
    const original = await currentConnection(page)
    const response = await page.evaluate(
      ({ id, timezone }) => window.yuki.client.models.stats(id, { range: 'today', timezone }),
      { id: original.characterId, timezone },
    )
    expect(response).toMatchObject({ ok: false, code: 'capability_denied' })
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    await expect(page.getByText('只有 Yuki 的管理員可以修改模型設定')).toBeVisible()
    await expect(total(page)).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('model-usage-ordinary.png') })
    await save('model-usage-ordinary', { original, response })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('revoking the current administrator hides loaded model usage and configuration', async () => {
  test.setTimeout(120000)
  const rig = await usageBackend(),
    app = await rig.launch('revoked-model-usage')
  let success = false
  try {
    await seed(rig.root, 'first')
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page)
    await usage(page)
    await expect(total(page)).toHaveText('2.09 K')
    const response = await fetch(`${rig.base}/__test/superuser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: (await rig.state()).owner_person_id, enabled: false }),
    })
    expect(response.status).toBe(200)
    await expect(page.getByText('只有 Yuki 的管理員可以修改模型設定')).toBeVisible()
    await expect(total(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '新增連接', exact: true })).toHaveCount(0)
    const denied = await page.evaluate(
      ({ id, timezone }) => window.yuki.client.models.stats(id, { range: 'today', timezone }),
      { id: original.characterId, timezone },
    )
    expect(denied).toMatchObject({ ok: false, code: 'capability_denied' })
    expect(await currentConnection(page)).toEqual(original)
    await page.screenshot({ path: test.info().outputPath('model-usage-revoked.png') })
    await save('model-usage-revoked', {
      original,
      denied,
      visible: await page.locator('body').innerText(),
    })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('unknown-only usage stays unknown and empty usage is a real zero', async () => {
  test.setTimeout(120000)
  for (const mode of ['unknown', 'empty'] as const) {
    const rig = await usageBackend(),
      app = await rig.launch(`usage-${mode}`)
    let success = false
    try {
      const facts = await seed(rig.root, mode),
        page = await app.firstWindow()
      await pairUI(page, rig.base, await rig.code())
      const connection = await currentConnection(page),
        report = await stats(page, connection.characterId, { range: 'today', timezone })
      expect(report.summary.invocations).toBe(mode === 'unknown' ? 1 : 0)
      expect(report.summary.coverage.total_tokens).toBe(0)
      expect(report.summary.cache_read.ratio).toBeNull()
      await usage(page)
      await expect(total(page)).toHaveText(mode === 'unknown' ? '未知' : '0')
      if (mode === 'unknown')
        await expect(region(page).getByText(/有 1 次呼叫未完整回報用量/)).toBeVisible()
      else
        await expect(
          region(page).getByText('這段時間與篩選條件下尚無模型呼叫。', { exact: true }),
        ).toBeVisible()
      await page.screenshot({ path: test.info().outputPath(`model-usage-${mode}.png`) })
      await save(`model-usage-${mode}`, { connection, facts, report })
      success = true
    } finally {
      await app.close()
      await rig.close(success)
    }
  }
})

test('a failed usage read hides old numbers instead of presenting zero or a stale range', async () => {
  test.setTimeout(120000)
  const rig = await usageBackend(),
    proxy = await forwardProxy(rig.base, '/usage'),
    app = await rig.launch('usage-read-failure')
  let success = false
  try {
    await seed(rig.root, 'first')
    const page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code())
    const connection = await currentConnection(page)
    await usage(page)
    await expect(total(page)).toHaveText('2.09 K')
    proxy.faults.offline = true
    await region(page).getByRole('button', { name: '全部留存', exact: true }).click()
    await expect(
      region(page).getByText('伺服器暫時無法接收，尚未寫入。', { exact: true }),
    ).toBeVisible()
    await expect(total(page)).toHaveCount(0)
    await expect(region(page).getByText('7.19 K', { exact: true })).toHaveCount(0)
    const denied = await page.evaluate(
      ({ id, timezone }) => window.yuki.client.models.stats(id, { range: 'all', timezone }),
      { id: connection.characterId, timezone },
    )
    expect(denied).toMatchObject({ ok: false, code: 'unavailable' })
    await page.screenshot({ path: test.info().outputPath('model-usage-read-failure.png') })
    await save('model-usage-read-failure', {
      connection,
      denied,
      proxy: proxy.calls,
      visible: await region(page).innerText(),
    })
    success = true
  } finally {
    proxy.faults.offline = false
    await app.close()
    await proxy.close()
    await rig.close(success)
  }
})
