import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

async function installationDetails(page: Page) {
  for (const label of ['疑難排解', '進階：安裝與原有連接']) {
    const summary = page.getByText(label, { exact: true })
    if (!(await summary.locator('..').evaluate((node) => (node as HTMLDetailsElement).open)))
      await summary.click()
  }
}

async function localActivities(page: Page) {
  await page.getByRole('button', { name: '顯示本機活動', exact: true }).click()
  await expect(page.getByRole('tablist', { name: '這台電腦的活動', exact: true })).toBeVisible()
}

test('long original Agent names, paths and grouped controls wrap within wide and narrow content areas', async ({
  page,
}) => {
  for (const width of [1440, 960, 480]) {
    await page.setViewportSize({ width, height: 700 })
    await page.goto('http://127.0.0.1:4178/components.html?connector=long-layout')
    await installationDetails(page)
    await expect(page.getByRole('button', { name: '編輯', exact: true })).toBeVisible()
    expect(
      await page.locator('main').evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1)
    const rows = await page.locator('[class*="rowValue"]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const controls = node.getBoundingClientRect()
        const label = node.previousElementSibling! as HTMLElement
        const title = label.getBoundingClientRect()
        const row = node.parentElement!.getBoundingClientRect()
        return {
          left: Math.min(controls.x, title.x) - row.x,
          right: Math.max(controls.right, title.right) - row.right,
          clippedTitle: label.scrollWidth - label.clientWidth,
          overlap:
            controls.x < title.right && controls.y < title.bottom && title.y < controls.bottom,
        }
      }),
    )
    for (const row of rows) {
      expect(row.left).toBeGreaterThanOrEqual(-1)
      expect(row.right).toBeLessThanOrEqual(1)
      expect(row.overlap).toBe(false)
      expect(row.clippedTitle).toBeLessThanOrEqual(1)
    }
    await page.getByRole('button', { name: '編輯', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: /^編輯 / })
    await expect(sheet).toBeInViewport()
    await expect(sheet.getByRole('combobox', { name: '原生工具類型', exact: true })).toBeDisabled()
    await expect(sheet.locator('footer').getByRole('button')).toHaveText(['取消', '儲存'])
    await page.screenshot({ path: test.info().outputPath(`native-agent-wrap-${width}.png`) })
    await writeFile(
      test.info().outputPath(`native-agent-wrap-${width}.json`),
      JSON.stringify(
        {
          rows,
          sheet: await sheet.boundingBox(),
          requestedWidth: width,
        },
        null,
        2,
      ),
    )
  }
})

test('connector settings prepare an independent runtime, explicitly connect the current role and manage its service', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 650 })
  await page.goto('http://127.0.0.1:4178/components.html?connector=missing')
  const connect = page.getByRole('button', { name: '連接這台電腦', exact: true })
  await expect(connect).toBeDisabled()
  await page.getByRole('textbox', { name: '電腦名稱', exact: true }).fill('My work computer')
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接這台電腦', exact: true }).check()
  await connect.click()
  await installationDetails(page)
  await expect(page.getByText('目前本人', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Codex 安裝', exact: true })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: '允許完整訪問本機' })).not.toBeChecked()
  await expect(page.getByRole('combobox', { name: '任務 Agent' })).toHaveCount(0)
  const service = page.getByRole('switch', { name: '背景連接', exact: true })
  await expect(service).toBeChecked()
  await service.click()
  await expect(service).not.toBeChecked()
  await expect(page.getByText('背景連接已停止', { exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
    ),
  ).toEqual([
    {
      method: 'connect',
      input: { characterId: '00000000-0000-4000-8000-000000000001', label: 'My work computer' },
    },
    { method: 'service', input: 'install' },
    { method: 'service', input: 'start' },
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
  await installationDetails(page)
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

test('an existing independent installation is selected without pairing, upgrading or restarting its service', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=existing')
  await expect(page.getByRole('button', { name: '連接這台電腦', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '使用已有連接', exact: true }).click()
  await expect(page.getByText('Original Codex', { exact: false })).toBeVisible()
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).toBeChecked()
  await installationDetails(page)
  await expect(page.getByText('original-connector-device', { exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as unknown as Window & { __connectorCalls: unknown[] }).__connectorCalls,
    ),
  ).toEqual([
    {
      method: 'useInstallation',
      input: { executable: '/original/python', dataDirectory: '/original/data' },
    },
  ])
})

test('an original connection no longer admitted by Yuki offers an explicit new connection without reusing its authorization', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=existing')
  await expect(page.getByRole('button', { name: '使用已有連接', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const read = window.yuki.connector.state
    window.yuki.connector.state = async (id) => {
      const result = await read(id)
      if (!result.ok || result.value.available || !result.value.existing) return result
      return {
        ok: true,
        value: {
          ...result.value,
          existing: {
            ...result.value.existing,
            state: {
              ...result.value.existing.state,
              admission: {
                matched: false,
                connected: false,
                problem: 'connector_other_person',
              },
            },
          },
        },
      }
    }
    ;(window as Window & { __connectorAdvance?: (phase: string) => void }).__connectorAdvance!(
      'not-admitted',
    )
  })
  await page.getByRole('button', { name: '建立新連接', exact: true }).click()
  await expect(page.getByRole('button', { name: '連接這台電腦', exact: true })).toBeDisabled()
  await expect(
    page.getByRole('checkbox', { name: '我允許這個 Yuki 連接這台電腦', exact: true }),
  ).not.toBeChecked()
  expect(
    await page.evaluate(
      () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
    ),
  ).toEqual([{ method: 'install', input: true }])
})

test('Claude uses the same connection flow and new or existing sessions do not require a chosen project', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=missing')
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接這台電腦', exact: true }).check()
  await page.getByRole('button', { name: '連接這台電腦', exact: true }).click()
  await page.getByRole('button', { name: '新增 Agent', exact: true }).click()
  await page.getByRole('combobox', { name: '原生工具類型', exact: true }).selectOption('claude')
  await page.getByRole('button', { name: '尋找已安裝的 Claude', exact: true }).click()
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByText('Claude 程式已找到；登入與任務依原生結果確認')).toBeVisible()
  await expect(page.getByText('Claude 原生連線已建立')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '新增本機 Agent', exact: true })).toBeHidden()
  await localActivities(page)
  await page.getByRole('textbox', { name: '原生任務要求', exact: true }).fill('請檢查目前狀態')
  await page.getByRole('button', { name: '交給 Yuki 執行', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '原生任務要求', exact: true })).toHaveValue('')
  await page.getByText('工作位置（可選）', { exact: true }).click()
  await page.getByRole('textbox', { name: '本次任務工作位置', exact: true }).fill('/chosen/project')
  await page.getByRole('textbox', { name: '原生任務要求', exact: true }).fill('在指定位置檢查')
  await page.getByRole('button', { name: '交給 Yuki 執行', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '原生任務要求', exact: true })).toHaveValue('')
  await page.getByRole('button', { name: '讀取原生會話', exact: true }).click()
  await page
    .getByRole('combobox', { name: '原生會話', exact: true })
    .selectOption('original-session')
  await page.getByRole('textbox', { name: '原生任務要求', exact: true }).fill('繼續原任務')
  await page.getByRole('button', { name: '交給 Yuki 執行', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '原生任務要求', exact: true })).toHaveValue('')
  const calls = await page.evaluate(
    () =>
      (window as unknown as Window & { __connectorCalls: { method: string; input?: unknown }[] })
        .__connectorCalls,
  )
  expect(calls.find((call) => call.method === 'discover')?.input).toBe('claude')
  expect(calls.some((call) => call.method === 'diagnose')).toBe(false)
  expect(calls.find((call) => call.method === 'configure')?.input).toEqual({
    id: expect.any(String),
    create: true,
    candidateId: 'fixture-claude-one',
    driver: 'claude',
    label: '本機 Claude',
  })
  expect(calls.filter((call) => call.method === 'submit').map((call) => call.input)).toEqual([
    {
      text: '請檢查目前狀態',
      agentTarget: {
        device_id: 'fixture-connector-device',
        instance_id: 'fixture-server-instance',
        intent: 'prompt',
      },
    },
    {
      text: '在指定位置檢查',
      agentTarget: {
        device_id: 'fixture-connector-device',
        instance_id: 'fixture-server-instance',
        intent: 'prompt',
        cwd: '/chosen/project',
      },
    },
    {
      text: '繼續原任務',
      agentTarget: {
        device_id: 'fixture-connector-device',
        instance_id: 'fixture-server-instance',
        intent: 'prompt',
        session_id: 'original-session',
      },
    },
  ])
  await page.getByRole('button', { name: '顯示連接設定', exact: true }).click()
  await page.getByRole('button', { name: '編輯', exact: true }).click()
  await page.getByRole('button', { name: '檢查就緒', exact: true }).click()
  await expect(
    page.getByText('Claude 登入檢查完成；尚未執行模型任務。', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('原生握手與帳戶檢查完成；尚未執行模型任務。', { exact: true }),
  ).toHaveCount(0)
})

// Component fixtures verify configuration/UI semantics, not a real native ACP handshake.
test('a generic ACP program is configured through the existing connection with exact ordered arguments', async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 760 })
  await page.goto('http://127.0.0.1:4178/components.html?connector=missing')
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接這台電腦', exact: true }).check()
  await page.getByRole('button', { name: '連接這台電腦', exact: true }).click()
  await page.getByRole('button', { name: '新增 Agent', exact: true }).click()
  await page.getByRole('combobox', { name: '原生工具類型', exact: true }).selectOption('acp')
  await expect(page.getByRole('button', { name: '尋找已安裝的 ACP', exact: true })).toHaveCount(0)
  await expect(page.getByText('進階：手動選擇原生程式', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '選擇原生執行檔', exact: true }).click()
  await page.getByRole('button', { name: '新增啟動參數', exact: true }).click()
  await page.getByRole('textbox', { name: 'ACP 啟動參數 1', exact: true }).fill('--stdio')
  await page.getByRole('button', { name: '新增啟動參數', exact: true }).click()
  await page.getByRole('textbox', { name: 'ACP 啟動參數 2', exact: true }).fill('含空格的值')
  await page.getByRole('button', { name: '新增啟動參數', exact: true }).click()
  expect(
    await page.locator('main').evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1)
  await page.screenshot({ path: test.info().outputPath('acp-arguments-480.png') })
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByText('ACP 原生連線已建立')).toBeVisible()
  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __connectorCalls?: { method: string; input?: unknown; start?: boolean }[]
        }
      ).__connectorCalls!,
  )
  expect(calls.filter((call) => call.method === 'configure')).toEqual([
    {
      method: 'configure',
      input: {
        id: expect.any(String),
        create: true,
        command: 'C:\\Program Files\\ACP Agent\\agent.exe',
        driver: 'acp',
        label: '本機 ACP',
        args: ['--stdio', '含空格的值', ''],
      },
      start: true,
    },
  ])
  expect(
    calls.some((call) => ['discover', 'chooseProject', 'diagnose'].includes(call.method)),
  ).toBe(false)
  await writeFile(test.info().outputPath('acp-arguments.json'), JSON.stringify({ calls }, null, 2))
})

test('editing an original ACP keeps omitted arguments and only changes arguments on explicit edits', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=acp-existing')
  await page.getByRole('switch', { name: '背景連接', exact: true }).click()
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: '編輯', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '原生工具類型', exact: true })).toHaveValue('acp')
  await expect(page.getByRole('textbox', { name: 'ACP 啟動參數 1', exact: true })).toHaveValue(
    '--stdio',
  )
  await expect(page.getByRole('textbox', { name: 'ACP 啟動參數 2', exact: true })).toHaveValue(
    '原參數 有空格',
  )
  await page.getByRole('textbox', { name: 'Agent 顯示名稱', exact: true }).fill('Same ACP renamed')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /^編輯 / })).toBeHidden()
  await page.getByRole('button', { name: '編輯', exact: true }).click()
  await page.getByRole('textbox', { name: 'ACP 啟動參數 1', exact: true }).fill('--stdio=new')
  await page.getByRole('button', { name: '移除 ACP 啟動參數 3', exact: true }).click()
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /^編輯 / })).toBeHidden()
  await page.getByRole('button', { name: '編輯', exact: true }).click()
  await page.getByRole('button', { name: '移除 ACP 啟動參數 2', exact: true }).click()
  await page.getByRole('button', { name: '移除 ACP 啟動參數 1', exact: true }).click()
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByRole('dialog', { name: /^編輯 / })).toBeHidden()
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).not.toBeChecked()
  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __connectorCalls?: { method: string; input?: Record<string, unknown>; start?: boolean }[]
        }
      ).__connectorCalls!,
  )
  const saved = calls.filter((call) => call.method === 'configure')
  expect(saved).toHaveLength(3)
  expect(saved[0]!.input).toEqual({
    id: 'fixture-native-instance',
    create: false,
    command: '/fixture/acp-agent',
    label: 'Same ACP renamed',
  })
  expect(saved[1]!.input).toEqual({ ...saved[0]!.input, args: ['--stdio=new', '原參數 有空格'] })
  expect(saved[2]!.input).toEqual({ ...saved[0]!.input, args: [] })
  expect(saved.every((call) => call.start === false)).toBe(true)
  expect(calls.some((call) => ['connect', 'pair'].includes(call.method))).toBe(false)
  expect(calls.filter((call) => call.method === 'service')).toEqual([
    { method: 'service', input: 'stop' },
  ])
})

test('a stopped independent connector can update in place while retaining its original identity and stopped service', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=existing-old-stopped')
  await installationDetails(page)
  await expect(page.getByText('0.3.1', { exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: '允許完整訪問本機' })).toHaveCount(0)
  await expect(page.getByText('已停止', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '連接這台電腦', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '更新連接器，保留原資料', exact: true }).click()
  await expect(page.getByRole('switch', { name: '允許完整訪問本機' })).not.toBeChecked()
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).not.toBeChecked()
  await installationDetails(page)
  await expect(page.getByText('original-connector-device', { exact: true })).toBeVisible()
  await expect(page.getByText('/original/data', { exact: true })).toBeVisible()
  await expect(page.getByText(/0\.4\.0 · 協議 4/)).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
    ),
  ).toEqual([
    {
      method: 'useInstallation',
      input: { executable: '/original/python', dataDirectory: '/original/data' },
    },
    { method: 'adopt' },
  ])
})

test('multiple Codex installations require a real choice without requiring a project folder', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=multiple')
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接這台電腦', exact: true }).check()
  await page.getByRole('button', { name: '連接這台電腦', exact: true }).click()
  await page.getByRole('button', { name: '新增 Agent', exact: true }).click()
  await page.getByRole('button', { name: '尋找已安裝的 Codex', exact: true }).click()
  const candidate = page.getByRole('combobox', { name: 'Codex 安裝', exact: true })
  await expect(candidate).toHaveValue('')
  await expect(page.getByRole('button', { name: '儲存', exact: true })).toBeDisabled()
  await candidate.selectOption('fixture-codex-two')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  expect(
    await page.evaluate(
      () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
    ),
  ).toEqual([
    {
      method: 'connect',
      input: { characterId: '00000000-0000-4000-8000-000000000001', label: 'My computer' },
    },
    { method: 'service', input: 'install' },
    { method: 'service', input: 'start' },
    { method: 'discover', input: 'codex' },
    {
      method: 'configure',
      input: {
        id: expect.any(String),
        create: true,
        candidateId: 'fixture-codex-two',
        driver: 'codex',
        label: '本機 Codex',
      },
      start: true,
    },
  ])
  await localActivities(page)
  await expect(page.getByRole('combobox', { name: '任務 Agent', exact: true })).toHaveValue(
    'fixture-server-instance',
  )
  await expect(page.getByRole('button', { name: '讀取原生會話', exact: true })).toBeEnabled()
})

test('a saved native instance survives a failed background start and continues under its real ID', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=service-failure')
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接這台電腦', exact: true }).check()
  await page.getByRole('button', { name: '連接這台電腦', exact: true }).click()
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).toBeChecked()
  await page.getByRole('button', { name: '新增 Agent', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: '新增本機 Agent', exact: true })
  const label = '啟動失敗後保留的 Codex 設定'
  await sheet.getByRole('textbox', { name: 'Agent 顯示名稱', exact: true }).fill(label)
  await sheet.getByRole('button', { name: '尋找已安裝的 Codex', exact: true }).click()
  await sheet.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(sheet.getByRole('status').filter({ hasText: '啟動背景連接：' })).toBeVisible()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('textbox', { name: 'Agent 顯示名稱', exact: true })).toHaveValue(
    label,
  )
  await expect(sheet.getByRole('combobox', { name: '原生工具類型', exact: true })).toBeDisabled()
  const persisted = await page.evaluate(async () => {
    const state = await window.yuki.connector.state('00000000-0000-4000-8000-000000000001')
    if (!state.ok || !state.value.available) throw Error('Expected the saved local installation')
    return state.value
  })
  expect(persisted.instances).toHaveLength(1)
  expect(persisted.instances[0]).toMatchObject({ id: expect.any(String), label, driver: 'codex' })
  expect(persisted.service.running).toBe(false)
  await sheet.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).not.toBeChecked()
  await page.getByRole('switch', { name: '背景連接', exact: true }).click()
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).toBeChecked()
  await expect(page.getByText('Codex 原生連線已建立')).toBeVisible()
  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __connectorCalls?: { method: string; input?: { id?: string }; start?: boolean }[]
        }
      ).__connectorCalls!,
  )
  const configurations = calls.filter((call) => call.method === 'configure')
  const ids = configurations.map((call) => call.input?.id)
  expect(ids).toHaveLength(2)
  expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/)
  expect(ids[1]).toBe(ids[0])
  expect(ids[0]).toBe(persisted.instances[0]!.id)
  expect(configurations.map((call) => call.start)).toEqual([true, false])
  expect(calls.filter((call) => call.method === 'connect')).toHaveLength(1)
  await writeFile(
    test.info().outputPath('saved-native-start-failure.json'),
    JSON.stringify({ persisted, calls }, null, 2),
  )
})

for (const [mode, message] of [
  ['protocol-connector', '請更新 Yuki Desktop 與隨附連接器'],
  ['protocol-server', '請更新 Yuki 伺服器以支援協議 4'],
  ['protocol-unknown', '尚未提供；可更新 Yuki 後重新開啟設定。'],
] as const) {
  test(`connector protocol diagnostics identify the update target without blocking existing settings (${mode})`, async ({
    page,
  }) => {
    await page.goto(`http://127.0.0.1:4178/components.html?connector=${mode}`)
    if (mode === 'protocol-unknown') await installationDetails(page)
    await expect(page.getByText(message, { exact: false }).first()).toBeVisible()
    await expect(page.getByRole('switch', { name: '背景連接', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '編輯', exact: true }).click()
    await expect(page.getByRole('button', { name: '儲存', exact: true })).toBeEnabled()
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
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).toBeChecked()
  const status = page.getByRole('heading', { name: '狀態', exact: true }).locator('..')
  await expect(status.getByText('已連線', { exact: true })).toBeVisible()
  await expect(page.getByText(/尚未就緒：請先在原生 Agent 完成登入/)).toBeVisible()
  await page.getByRole('button', { name: '編輯', exact: true }).click()
  await page.getByRole('button', { name: '檢查就緒', exact: true }).click()
  await expect(
    page.getByText('請先在原生 Agent 完成登入，再重新檢查。', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '開啟程式位置', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.evaluate(async () => {
    const state = await window.yuki.connector.state('00000000-0000-4000-8000-000000000001')
    if (!state.ok || !state.value.available) throw Error('Expected the existing local installation')
    window.yuki.connector.state = async () => ({
      ok: true,
      value: {
        ...state.value,
        admission: { matched: null, connected: false, problem: 'transport_unknown' },
      },
    })
    ;(window as Window & { __connectorAdvance?: (phase: string) => void }).__connectorAdvance!(
      'server-unreachable',
    )
  })
  await expect(page.getByRole('status').filter({ hasText: '伺服器接納尚未確認：' })).toContainText(
    '無法取得伺服器回應。',
  )
  await expect(page.getByRole('status').filter({ hasText: '伺服器接納尚未確認：' })).toContainText(
    '本機內容已保留。',
  )
  await expect(page.getByRole('status').filter({ hasText: '伺服器接納尚未確認：' })).toContainText(
    '本機背景連接仍可管理。',
  )
  await installationDetails(page)
  await expect(page.getByText('尚未確認目前本人', { exact: true })).toBeVisible()
  await expect(page.getByText('transport_unknown', { exact: false })).toHaveCount(0)
  await expect(page.getByText('目前的 Yuki 未接納原連接，原身份與回執會保留。')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '建立新連接', exact: true })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '重新讀取狀態', exact: true })).toHaveCount(0)
})

test('a previously authorized namespace continues discovery without another consent gate', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=paired')
  await expect(
    page.getByRole('checkbox', { name: '我允許這個 Yuki 連接這台電腦', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: '連接這台電腦', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '新增 Agent', exact: true }).click()
  await page.getByRole('button', { name: '尋找已安裝的 Codex', exact: true }).click()
  await expect(page.getByRole('button', { name: '儲存', exact: true })).toBeEnabled()
})

test('a computer without Agent instances exposes local full access and original terminal receipts', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=terminal-detail')
  const access = page.getByRole('switch', { name: '允許完整訪問本機' })
  await expect(access).not.toBeChecked()
  await expect(page.getByText(/雲端目錄同步尚未確認/)).toHaveCount(0)
  await access.click()
  await expect(access).toBeChecked()
  await access.click()
  await expect(access).not.toBeChecked()
  await expect(page.getByText(/雲端目錄同步尚未確認/)).toBeVisible()
  await localActivities(page)
  await expect(page.getByRole('combobox', { name: '任務 Agent' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '查看原回執', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看原回執', exact: true }).click()
  await expect(page.getByText('第一頁原進度', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '終端執行', exact: true }).click()
  await page.getByRole('button', { name: '查看終端回執', exact: true }).click()
  await expect(page.locator('pre').filter({ hasText: 'hello' })).toBeVisible()
  await page.getByRole('button', { name: '讀取後續終端輸出' }).click()
  await expect(page.locator('pre').filter({ hasText: 'hello' })).toContainText('done')
  await expect(page.getByText('狀態：exited · 退出碼 0', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止原終端執行' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: '結果尚未確認，請查證原請求。' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '重送原停止請求', exact: true }).click()
  await page.getByRole('button', { name: '查證原停止請求' }).click()
  await expect(page.getByRole('status').filter({ hasText: '原回執 completed' })).toBeVisible()
  const calls = await page.evaluate(
    () =>
      (window as Window & { __connectorCalls?: { method: string; input?: unknown }[] })
        .__connectorCalls!,
  )
  expect(calls.filter((call) => call.method === 'fullAccess').map((call) => call.input)).toEqual([
    { enabled: true, id: '00000000-0000-4000-8000-000000000001' },
    { enabled: false, id: '00000000-0000-4000-8000-000000000001' },
  ])
  const stop = calls.find((call) => call.method === 'controlTerminal')!.input as {
    request: string
    run: string
  }
  expect(calls.filter((call) => call.method === 'controlTerminal')).toHaveLength(2)
  expect(
    calls
      .filter((call) => call.method === 'controlTerminal')
      .every((call) => (call.input as { request: string }).request === stop.request),
  ).toBe(true)
  expect(calls.find((call) => call.method === 'terminalControl')!.input).toEqual({
    run: 'original-terminal',
    request: stop.request,
  })
  expect(calls.some((call) => ['configure', 'discover', 'service'].includes(call.method))).toBe(
    false,
  )
  await writeFile(
    test.info().outputPath('local-terminal-original-request.json'),
    JSON.stringify({ calls, stop }, null, 2),
  )
  await page.evaluate(() => {
    const read = window.yuki.connector.terminal
    window.yuki.connector.terminal = async (...args) => {
      const result = await read(...args)
      return result.ok
        ? {
            ok: true,
            value: {
              ...result.value,
              status: 'succeeded',
              pending: false,
              output: undefined,
              output_unavailable: true,
            },
          }
        : result
    }
  })
  await page.getByRole('button', { name: '重新整理', exact: true }).click()
  await expect(
    page.getByText('原執行狀態已保留，當前無法讀取本機輸出。', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('狀態：succeeded · 退出碼 0', { exact: true })).toBeVisible()
})

test('original Agent directory hides private records when its current authority is lost', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=operation-detail')
  await localActivities(page)
  await expect(page.getByRole('button', { name: '查看原回執', exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.yuki.connector.operations = async () => ({ ok: false, code: 'unauthenticated' })
  })
  await page.getByRole('button', { name: '重新整理', exact: true }).click()
  await expect(page.getByText('原操作目錄暫時無法讀取。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看原回執', exact: true })).toHaveCount(0)
  await expect(page.getByText('Work — · running', { exact: true })).toHaveCount(0)
})

test('terminal directory hides cached records and pagination when its current authority is lost', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=terminal-detail')
  await localActivities(page)
  await page.getByRole('tab', { name: '終端執行', exact: true }).click()
  await page.evaluate(() => {
    const read = window.yuki.connector.terminals
    window.yuki.connector.terminals = async (...args) => {
      const result = await read(...args)
      return result.ok
        ? { ok: true, value: { ...result.value, next_cursor: 'original-private-next' } }
        : result
    }
  })
  await page.getByRole('button', { name: '重新整理', exact: true }).click()
  await expect(page.getByRole('button', { name: '更多終端任務', exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.yuki.connector.terminals = async () => ({ ok: false, code: 'unauthenticated' })
  })
  await page.getByRole('button', { name: '重新整理', exact: true }).click()
  await expect(page.getByText('終端目錄暫時無法讀取。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看終端回執', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '更多終端任務', exact: true })).toHaveCount(0)
  await expect(page.getByText('Write-Output hello', { exact: true })).toHaveCount(0)
})

test('an opened original receipt receives a late permission and terminal result while retaining both loaded event pages', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=operation-detail')
  await localActivities(page)
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
  await page.getByRole('button', { name: '重新整理', exact: true }).click()
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
