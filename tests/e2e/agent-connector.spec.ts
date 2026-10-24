import { expect, test } from '@playwright/test'

test('connector settings prepare an independent runtime, explicitly connect the current role and manage its service', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 650 })
  await page.goto('http://127.0.0.1:4178/components.html?connector=missing')
  const connect = page.getByRole('button', { name: '連接本機 Codex', exact: true })
  await expect(connect).toBeDisabled()
  await page.getByRole('textbox', { name: '電腦名稱', exact: true }).fill('My work computer')
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接本機 Agent', exact: true }).check()
  await connect.click()
  await expect(page.getByText('目前本人', { exact: true })).toBeVisible()
  await expect(page.getByText('fixture-connector-device', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '啟動連接器', exact: true })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Codex 安裝', exact: true })).toHaveCount(0)
  await expect(page.getByText(/已找到 Codex/)).toBeVisible()
  await page.getByRole('button', { name: '選擇資料夾', exact: true }).click()
  await page.getByRole('button', { name: '使用此專案並啟動背景連接', exact: true }).click()
  await expect(page.getByText('Codex 原生連線已建立', { exact: true })).toBeVisible()
  await expect(page.getByText('執行中', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止連接器', exact: true }).click()
  await expect(page.getByText('已停止', { exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
    ),
  ).toEqual([
    {
      method: 'connect',
      input: { characterId: '00000000-0000-4000-8000-000000000001', label: 'My work computer' },
    },
    { method: 'discover' },
    { method: 'chooseProject' },
    {
      method: 'configure',
      input: {
        id: expect.any(String),
        create: true,
        candidateId: 'fixture-codex-one',
        label: '本機 Codex',
        cwd: '/fixture/project',
      },
      start: true,
    },
    { method: 'service', input: 'stop' },
  ])
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: test.info().outputPath('connector-720.png') })
})

test('advanced Connector installation and its dedicated one-time code use the current bridge inputs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 650 })
  await page.goto('http://127.0.0.1:4178/components.html?connector=unpaired')
  await page.getByText('進階：接入原有安裝', { exact: true }).click()
  await page
    .getByRole('textbox', { name: '原 Python 絕對路徑', exact: true })
    .fill('/original/python')
  await page
    .getByRole('textbox', { name: '原資料目錄', exact: true })
    .fill('/original/connector-data')
  await page.getByRole('button', { name: '讀取並選用原安裝', exact: true }).click()
  await expect(page.getByText('/original/connector-data', { exact: true })).toBeVisible()
  await page.getByText('進階：手動專用授權碼', { exact: true }).click()
  const code = page.getByRole('textbox', { name: '手動 Connector 授權碼', exact: true })
  await expect(code).toHaveAttribute('type', 'password')
  await page
    .getByRole('textbox', { name: '手動 Connector 伺服器', exact: true })
    .fill('https://manual.example')
  await code.fill('component-only-dedicated-code')
  await page.getByRole('button', { name: '使用專用碼連接', exact: true }).click()
  await expect(code).toHaveCount(0)
  expect(
    await page.evaluate(
      () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
    ),
  ).toEqual([
    {
      method: 'useInstallation',
      input: { executable: '/original/python', dataDirectory: '/original/connector-data' },
    },
    {
      method: 'pair',
      input: {
        server: 'https://manual.example',
        label: 'My computer',
        code: 'component-only-dedicated-code',
      },
    },
  ])
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('multiple Codex installations require a real choice and an existing session needs no new project folder', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=multiple')
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接本機 Agent', exact: true }).check()
  await page.getByRole('button', { name: '連接本機 Codex', exact: true }).click()
  const candidate = page.getByRole('combobox', { name: 'Codex 安裝', exact: true })
  await expect(candidate).toHaveValue('')
  await expect(
    page.getByRole('button', { name: '使用已有 Codex 會話', exact: true }),
  ).toBeDisabled()
  await candidate.selectOption('fixture-codex-two')
  await page.getByRole('button', { name: '使用已有 Codex 會話', exact: true }).click()
  expect(
    await page.evaluate(
      () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
    ),
  ).toEqual([
    {
      method: 'connect',
      input: { characterId: '00000000-0000-4000-8000-000000000001', label: 'My computer' },
    },
    { method: 'discover' },
    {
      method: 'configure',
      input: {
        id: expect.any(String),
        create: true,
        candidateId: 'fixture-codex-two',
        label: '本機 Codex',
      },
      start: true,
    },
  ])
  await expect(page.getByRole('combobox', { name: '任務 Agent', exact: true })).toHaveValue(
    'fixture-server-instance',
  )
  await expect(page.getByRole('button', { name: '讀取原生會話', exact: true })).toBeEnabled()
})

test('a saved native instance survives a failed background start and continues under its real ID', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=service-failure')
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接本機 Agent', exact: true }).check()
  await page.getByRole('button', { name: '連接本機 Codex', exact: true }).click()
  await page.getByRole('button', { name: '選擇資料夾', exact: true }).click()
  await page.getByRole('button', { name: '使用此專案並啟動背景連接', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '啟動背景連接：' })).toBeVisible()
  await page.getByRole('button', { name: '保存並重新連接', exact: true }).click()
  await expect(page.getByText('Codex 原生連線已建立', { exact: true })).toBeVisible()
  const calls = await page.evaluate(
    () =>
      (window as Window & { __connectorCalls?: { method: string; input?: { id?: string } }[] })
        .__connectorCalls,
  )
  const ids = calls?.filter((call) => call.method === 'configure').map((call) => call.input?.id)
  expect(ids).toHaveLength(2)
  expect(ids?.[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(ids?.[1]).toBe(ids?.[0])
})

for (const [mode, message] of [
  ['protocol-connector', '請更新 Yuki Desktop 與隨附連接器'],
  ['protocol-server', '請更新 Yuki 伺服器以支援協議 3'],
  ['protocol-unknown', '尚未提供；可更新 Yuki 後重新讀取。'],
] as const) {
  test(`connector protocol diagnostics identify the update target without blocking existing settings (${mode})`, async ({
    page,
  }) => {
    await page.goto(`http://127.0.0.1:4178/components.html?connector=${mode}`)
    await expect(page.getByText(message, { exact: false }).first()).toBeVisible()
    await page.getByRole('button', { name: '修改原設定', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存並重新連接', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: '停止連接器', exact: true })).toBeEnabled()
    expect(
      await page.evaluate(
        () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
      ),
    ).toEqual([])
  })
}

test('native readiness remains distinct from a running service and an online server', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=native-unavailable')
  await expect(page.getByText('執行中', { exact: true })).toBeVisible()
  await expect(page.getByText('已連線', { exact: true })).toBeVisible()
  await expect(page.getByText(/Codex 尚未就緒：請先在原生 Codex 完成登入/)).toBeVisible()
  await page.getByRole('button', { name: '檢查原生就緒', exact: true }).click()
  await expect(
    page.getByText('請先在原生 Codex 完成登入，再重新檢查。', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '開啟原生程式位置', exact: true })).toBeEnabled()
})

test('a previously authorized namespace continues discovery without another consent gate', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=paired')
  await expect(
    page.getByRole('checkbox', { name: '我允許這個 Yuki 連接本機 Agent', exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '連接本機 Codex', exact: true }).click()
  await expect(page.getByText(/已找到 Codex/)).toBeVisible()
})

test('an opened original receipt receives a late permission and terminal result while retaining both loaded event pages', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=operation-detail')
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __connectorOperationReads?: unknown[] }).__connectorOperationReads,
    ),
  ).toEqual([])
  await page.getByRole('button', { name: '查看原回執', exact: true }).click()
  await expect(page.getByText('第一頁原進度', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '讀取後續進度', exact: true }).click()
  await expect(page.getByText('第二頁原進度', { exact: true })).toBeVisible()
  await page.evaluate(() =>
    (window as Window & { __connectorAdvance?: (phase: string, emit?: boolean) => void })
      .__connectorAdvance!('permission'),
  )
  await expect(page.getByText('原任務的遲到權限要求', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'accept', exact: true })).toBeVisible()
  await expect(page.getByText('第一頁原進度', { exact: true })).toHaveCount(1)
  await expect(page.getByText('第二頁原進度', { exact: true })).toHaveCount(1)
  await page.evaluate(() =>
    (window as Window & { __connectorAdvance?: (phase: string, emit?: boolean) => void })
      .__connectorAdvance!('terminal', false),
  )
  await page.getByRole('button', { name: '重新讀取原操作', exact: true }).click()
  await expect(page.getByText('原任務的真終態結果', { exact: true })).toBeVisible()
  await expect(page.getByText('第一頁原進度', { exact: true })).toHaveCount(1)
  await expect(page.getByText('第二頁原進度', { exact: true })).toHaveCount(1)
  const reads = await page.evaluate(
    () =>
      (window as Window & { __connectorOperationReads?: { id: string; cursor: number }[] })
        .__connectorOperationReads,
  )
  expect(reads?.every((read) => read.id === 'original-operation')).toBe(true)
  expect(reads?.some((read) => read.cursor === 200)).toBe(true)
})
