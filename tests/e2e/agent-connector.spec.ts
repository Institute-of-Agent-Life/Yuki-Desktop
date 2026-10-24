import { expect, test } from '@playwright/test'

test('connector settings prepare an independent runtime, explicitly connect the current role and manage its service', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 650 })
  await page.goto('http://127.0.0.1:4178/components.html?connector=missing')
  await page.getByRole('button', { name: '準備本機連接器', exact: true }).click()
  const connect = page.getByRole('button', { name: '連接目前的 Yuki', exact: true })
  await expect(connect).toBeDisabled()
  await page.getByRole('textbox', { name: '電腦名稱', exact: true }).fill('My work computer')
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接本機 Agent', exact: true }).check()
  await connect.click()
  await expect(page.getByText('目前本人', { exact: true })).toBeVisible()
  await expect(page.getByText('fixture-connector-device', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '啟動連接器', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '安裝目前使用者的背景服務', exact: true }).click()
  await page.getByRole('button', { name: '啟動連接器', exact: true }).click()
  await expect(page.getByText('執行中', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止連接器', exact: true }).click()
  await expect(page.getByText('已停止', { exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
    ),
  ).toEqual([
    { method: 'install' },
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
