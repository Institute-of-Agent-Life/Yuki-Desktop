import { expect, test, type Locator } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { ConnectorTarget } from '../../src/shared/connector'
import { activeCharacterName } from '../fixtures/active-character'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { captureViewport, contentSize, workspaceSizes } from '../fixtures/visual'

async function settledTabs(tabs: Locator) {
  await expect
    .poll(() =>
      tabs.evaluate((nav) => {
        const thumb = nav.querySelector('[data-glass="segment"]')!.getBoundingClientRect()
        const tab = nav.querySelector('[role="tab"][aria-selected="true"]')!.getBoundingClientRect()
        return Math.max(Math.abs(thumb.x - tab.x), Math.abs(thumb.width - tab.width))
      }),
    )
    .toBeLessThanOrEqual(1)
}

test('a real paired Desktop opens local computer settings without authorizing or starting a connector', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('local-computer-empty')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    const name = await activeCharacterName(page)
    await page.keyboard.press('ControlOrMeta+6')
    await expect(page.getByRole('heading', { name: /^這台電腦尚未連接到 / })).toBeVisible()
    await expect(page.getByRole('button', { name: '前往設定', exact: true })).toBeVisible()
    await expect(page.getByRole('tablist', { name: '這台電腦的活動', exact: true })).toHaveCount(0)
    const layouts = []
    for (const [width, height] of workspaceSizes) {
      const viewportMethod = await contentSize(app, page, width, height)
      await captureViewport(
        app,
        page,
        test.info().outputPath(`local-computer-empty-${width}x${height}.png`),
      )
      layouts.push({
        requested: { width, height },
        viewportMethod,
        headings: await page.getByRole('heading').allTextContents(),
        nativeRequestVisible: await page
          .getByText('原生 Agent 的權限要求', { exact: true })
          .isVisible(),
      })
    }
    await page.getByRole('button', { name: '前往設定', exact: true }).click()
    await expect(page.getByRole('tab', { name: '這台電腦', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '主要導覽', exact: true })).toBeHidden()
    expect(await currentConnection(page)).toMatchObject({
      characterId: connection.characterId,
      personId: connection.personId,
      bindingId: connection.bindingId,
      conversationId: connection.conversationId,
    })
    await writeFile(
      test.info().outputPath('local-computer-empty.json'),
      JSON.stringify(
        {
          evidence:
            'real backend and isolated Electron profile; no host connector authorization or service installation',
          characterId: connection.characterId,
          name,
          layouts,
          selectedSettingsCategory: 'computer',
        },
        null,
        2,
      ),
    )
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('the component fixture connects through the original settings controls and opens both local activity tabs', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=missing&view=local')
  await expect(
    page.getByRole('heading', { name: '這台電腦尚未連接到 Fixture Yuki', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '前往設定', exact: true }).click()
  await expect(page.locator('[data-fixture-view="settings"]')).toBeVisible()
  const consent = page.getByRole('checkbox', { name: '我允許這個 Yuki 連接這台電腦', exact: true })
  await expect(consent).not.toBeChecked()
  await consent.check()
  await page.getByRole('button', { name: '連接這台電腦', exact: true }).click()
  await expect(page.getByRole('switch', { name: '背景連接', exact: true })).toBeChecked()
  await page.getByRole('button', { name: '顯示本機活動', exact: true }).click()
  const tabs = page.getByRole('tablist', { name: '這台電腦的活動', exact: true })
  await expect(tabs.getByRole('tab')).toHaveText(['原生 Agent 任務', '終端執行'])
  await expect(tabs.getByRole('tab', { name: '原生 Agent 任務', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await tabs.getByRole('tab', { name: '終端執行', exact: true }).click()
  await expect(page.getByRole('tabpanel', { name: '終端執行', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新整理', exact: true })).toHaveCount(1)
  await settledTabs(tabs)
  await page.screenshot({ path: test.info().outputPath('local-computer-connected-fixture.png') })
  await writeFile(
    test.info().outputPath('local-computer-connection.json'),
    JSON.stringify(
      {
        evidence: 'component fixture with actual connector settings and LocalComputer components',
        tabs: await tabs.getByRole('tab').allTextContents(),
        calls: await page.evaluate(
          () => (window as Window & { __connectorCalls?: unknown[] }).__connectorCalls,
        ),
      },
      null,
      2,
    ),
  )
})

test('the component fixture keeps the original request, loaded progress and draft across local activity tabs', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html?connector=operation-detail&view=local')
  const tabs = page.getByRole('tablist', { name: '這台電腦的活動', exact: true })
  await expect(tabs.getByRole('tab')).toHaveText(['原生 Agent 任務', '終端執行'])
  await page.getByRole('button', { name: '查看原回執', exact: true }).click()
  await expect(page.getByText('第一頁原進度', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '讀取後續進度', exact: true }).click()
  await expect(page.getByText('第二頁原進度', { exact: true })).toBeVisible()
  const input = page.getByRole('textbox', { name: '原生任務要求', exact: true })
  const draft = '切換分頁後仍保留的原任務要求'
  await input.fill(draft)
  await page.evaluate(() =>
    (
      window as Window & {
        __connectorAdvance?: (phase: string) => void
      }
    ).__connectorAdvance!('permission'),
  )
  const approval = page.getByRole('button', { name: 'accept', exact: true })
  await expect(approval).toBeVisible()
  const layouts = []
  for (const [width, height] of workspaceSizes) {
    await page.setViewportSize({ width, height })
    await expect(page.getByText('原任務的遲到權限要求', { exact: true })).toBeVisible()
    await settledTabs(tabs)
    await page.screenshot({
      path: test.info().outputPath(`local-computer-native-${width}x${height}.png`),
    })
    layouts.push({
      viewport: { width, height },
      tab: '原生 Agent 任務',
      nativeRequestVisible: await approval.isVisible(),
      bodyFits: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    })
    await tabs.getByRole('tab', { name: '終端執行', exact: true }).click()
    await expect(approval).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重新整理', exact: true })).toHaveCount(1)
    await settledTabs(tabs)
    await page.screenshot({
      path: test.info().outputPath(`local-computer-terminal-${width}x${height}.png`),
    })
    layouts.push({ viewport: { width, height }, tab: '終端執行', nativeRequestVisible: false })
    await tabs.getByRole('tab', { name: '原生 Agent 任務', exact: true }).click()
    await expect(approval).toBeVisible()
    await expect(input).toHaveValue(draft)
    await expect(page.getByText('第一頁原進度', { exact: true })).toHaveCount(1)
    await expect(page.getByText('第二頁原進度', { exact: true })).toHaveCount(1)
  }
  await approval.click()
  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __connectorCalls?: { method: string; input?: unknown }[]
        }
      ).__connectorCalls!,
  )
  const submissions = calls.filter((call) => call.method === 'submit')
  expect(submissions).toHaveLength(1)
  const submitted = submissions[0]!.input as { text: string; agentTarget: ConnectorTarget }
  expect(submitted.agentTarget).toMatchObject({
    device_id: 'fixture-connector-device',
    instance_id: 'fixture-server-instance',
    operation_id: 'original-operation',
    permission_id: 'original-permission',
    intent: 'respond',
    option_id: 'accept',
  })
  const reads = await page.evaluate(
    () =>
      (
        window as Window & {
          __connectorOperationReads?: { id: string; cursor: number }[]
        }
      ).__connectorOperationReads!,
  )
  expect(reads.every((read) => read.id === 'original-operation')).toBe(true)
  expect(reads.some((read) => read.cursor === 200)).toBe(true)
  await writeFile(
    test.info().outputPath('local-computer.json'),
    JSON.stringify(
      {
        evidence: 'component fixture; no claim of a real host connector or native Agent handshake',
        tabs: await tabs.getByRole('tab').allTextContents(),
        layouts,
        submitted,
        reads,
        draft,
      },
      null,
      2,
    ),
  )
})
