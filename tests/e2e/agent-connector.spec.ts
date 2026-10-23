import { expect, test } from '@playwright/test'

test('connector GUI uses explicit current-person authorization without exposing a code', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 650 })
  await page.goto('http://127.0.0.1:4178/components.html?connector=unpaired')
  const connect = page.getByRole('button', { name: '連接目前的 Yuki' })
  await expect(connect).toBeDisabled()
  await expect(page.getByText('https://yuki.example', { exact: false })).toBeVisible()
  await page.getByRole('checkbox', { name: '我允許這個 Yuki 連接本機 Agent' }).check()
  await connect.click()
  await expect(connect).toHaveCount(0)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await page.getByRole('button', { name: '安裝目前使用者的背景服務' }).click()
  await page.getByRole('button', { name: '啟動連接器', exact: true }).click()
  await expect(page.getByText('執行中', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止連接器', exact: true }).click()
  await expect(page.getByText('已停止', { exact: true })).toBeVisible()
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
})

test('failed authorization keeps input and supports keyboard retry without claiming pairing', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=unpaired')
  await page.evaluate(() => {
    window.yuki.connector.connect = async () => ({
      ok: false,
      code: 'connector_server_unreachable',
    })
  })
  await page.getByLabel('電腦名稱', { exact: true }).fill('Original PC')
  const consent = page.getByRole('checkbox', { name: '我允許這個 Yuki 連接本機 Agent' })
  await consent.focus()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: '連接目前的 Yuki' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('無法連到 Yuki 伺服器。請確認連線後重試。')).toBeVisible()
  await expect(page.getByLabel('電腦名稱', { exact: true })).toHaveValue('Original PC')
  await expect(page.getByRole('button', { name: '連接目前的 Yuki' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '啟動連接器' })).toHaveCount(0)
})

test('task controls preserve server session, operation and permission IDs and show pending receipts', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=unpaired')
  await page.evaluate(() => {
    window.yuki.connector.state = async () => ({
      ok: true,
      value: {
        available: true,
        paired: true,
        deviceId: 'device-original',
        instances: [{ id: 'local-original', driver: 'codex', label: 'Codex', cwd: 'C:/project' }],
        service: { installed: true, running: true },
        admission: {
          matched: true,
          connected: true,
          instances: [
            { id: 'server-instance', localId: 'local-original', driver: 'codex', label: 'Codex' },
          ],
        },
      },
    })
    window.yuki.connector.sessions = async () => ({
      ok: true,
      value: { sessions: [{ id: 'server-session', label: 'Original session' }] },
    })
    window.yuki.connector.operations = async () => ({
      ok: true,
      value: {
        operations: [
          {
            id: 'original-operation',
            instance_id: 'server-instance',
            session_id: 'server-session',
            execution_id: 'server-execution',
            status: 'unknown',
            work_id: 'original-work',
          },
        ],
      },
    })
    window.yuki.connector.operation = async () => ({
      ok: true,
      value: {
        id: 'original-operation',
        instance_id: 'server-instance',
        session_id: 'server-session',
        execution_id: 'server-execution',
        status: 'unknown',
        pending: true,
        uncertain: true,
        events: [
          {
            cursor: 39,
            kind: 'progress',
            payload: {
              item: {
                type: 'commandExecution',
                command: 'npm test',
                status: 'completed',
                exitCode: 0,
              },
            },
          },
          {
            cursor: 40,
            kind: 'progress',
            payload: {
              item: {
                type: 'fileChange',
                status: 'completed',
                changes: [{ path: 'src/example.ts' }],
              },
            },
          },
          {
            cursor: 41,
            kind: 'progress',
            payload: {
              native: { plan: [{ step: 'Verify original change', status: 'completed' }] },
            },
          },
          {
            cursor: 42,
            permission_id: 'server-permission',
            kind: 'permission',
            payload: {
              native_request: {
                availableDecisions: ['accept', 'decline'],
                id: 'native-private-id',
              },
            },
          },
        ],
      },
    })
    window.yuki.connector.submit = async (_character, input) => {
      document.body.dataset.lastTarget = JSON.stringify(input.agentTarget)
      return {
        ok: true,
        value: { requestId: 'original-request', state: 'accepted', eventId: 7, problem: null },
      }
    }
  })
  await page.getByRole('button', { name: '重新讀取狀態' }).click()
  await page.getByLabel('任務 Agent').selectOption('server-instance')
  await page.getByRole('button', { name: '讀取原生會話' }).click()
  await page.getByLabel('原生會話').selectOption('server-session')
  await page.getByLabel('原生任務要求').fill('Continue original task')
  await page.getByRole('button', { name: '交給 Yuki 執行', exact: true }).click()
  await expect(page.getByText(/要求已交給 Yuki/)).toBeVisible()
  expect(await page.locator('body').getAttribute('data-last-target')).toContain('server-session')
  await page.getByRole('button', { name: '查看原回執' }).click()
  await expect(page.getByText(/結果尚未確認/)).toBeVisible()
  await expect(page.getByText('npm test', { exact: true })).toBeVisible()
  await expect(page.getByText('src/example.ts', { exact: true })).toBeVisible()
  await expect(page.getByText('Verify original change · completed', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'decline', exact: true }).click()
  const target = JSON.parse((await page.locator('body').getAttribute('data-last-target'))!)
  expect(target).toMatchObject({
    device_id: 'device-original',
    instance_id: 'server-instance',
    session_id: 'server-session',
    execution_id: 'server-execution',
    operation_id: 'original-operation',
    permission_id: 'server-permission',
    response: { decision: 'decline' },
  })
  expect(JSON.stringify(target)).not.toContain('native-private-id')
  await page.getByRole('button', { name: '停止觀察', exact: true }).click()
  expect(JSON.parse((await page.locator('body').getAttribute('data-last-target'))!).intent).toBe(
    'detach',
  )
})

for (const pendingState of ['draft', 'submitted'] as const)
  test(`native task ${pendingState} keeps original request for verification`, async ({ page }) => {
    await page.goto('http://127.0.0.1:4178/components.html?connector=unpaired')
    await page.evaluate((pending) => {
      window.yuki.connector.state = async () => ({
        ok: true,
        value: {
          available: true,
          paired: true,
          deviceId: 'device',
          instances: [{ id: 'local', label: 'Codex', driver: 'codex', cwd: 'C:/project' }],
          service: { installed: true, running: true },
          admission: {
            matched: true,
            connected: false,
            instances: [{ id: 'instance', localId: 'local', label: 'Codex', driver: 'codex' }],
          },
        },
      })
      let submissions = 0
      window.yuki.connector.submit = async () => {
        document.body.dataset.submissions = String(++submissions)
        return {
          ok: true,
          value: {
            requestId: 'same-original-request',
            state: pending,
            eventId: null,
            problem: 'transport_unknown',
          },
        }
      }
      window.yuki.client.verify = async (_character, requestId) => {
        document.body.dataset.verifiedRequest = requestId
        return {
          ok: true,
          value: {
            requestId,
            body: { request_id: requestId, text: 'original input', attachments: [] },
            payloadHash: 'original',
            createdAt: 0,
            state: 'accepted',
            eventId: 12,
            problem: null,
          },
        }
      }
    }, pendingState)
    await page.getByRole('button', { name: '重新讀取狀態' }).click()
    await page.getByLabel('任務 Agent').selectOption('instance')
    await page.getByLabel('原生任務要求').fill('original input')
    const send = page.getByRole('button', { name: '交給 Yuki 執行', exact: true })
    await send.click()
    await expect(
      page.getByText(pendingState === 'draft' ? /要求只保存在本機/ : /接納尚待查證/),
    ).toBeVisible()
    await expect(page.getByLabel('原生任務要求')).toHaveValue('original input')
    await expect(page.getByText(/要求已交給 Yuki/)).toHaveCount(0)
    await send.click()
    await expect(page.getByText(/要求已交給 Yuki/)).toBeVisible()
    await expect(page.getByLabel('原生任務要求')).toHaveValue('')
    await expect(page.locator('body')).toHaveAttribute('data-submissions', '1')
    await expect(page.locator('body')).toHaveAttribute(
      'data-verified-request',
      'same-original-request',
    )
  })
