import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { currentConnection, currentEvents, pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { navigate, sidebar } from '../fixtures/navigation'
import { captureViewport, contentSize } from '../fixtures/visual'

async function expectUnconfigured(page: Page) {
  await expect(page.getByRole('navigation', { name: '主要導覽', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.yuki.client.connections())).toEqual({
    ok: true,
    value: [],
  })
  await expect(page.locator('[data-character-session]')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toHaveCount(0)
}

async function serverSettings(page: Page) {
  await navigate(page, '設定')
  await page.getByRole('tab', { name: '所有 Yuki', exact: true }).click()
  await expect(page.getByRole('navigation', { name: '主要導覽', exact: true })).toBeHidden()
  for (const name of ['連線', '裝置', '這台電腦'])
    await expect(page.getByRole('tab', { name, exact: true })).toHaveCount(0)
}

async function sizeWorkspace(app: ElectronApplication, page: Page) {
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()))
    .toBe(true)
  await contentSize(app, page, 1440, 900)
}

test('an unconfigured workspace can connect later and opens the actual paired Person workspace', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('deferred-connection')
  let success = false
  try {
    const page = await app.firstWindow()
    await sizeWorkspace(app, page)
    await expectUnconfigured(page)
    await captureViewport(app, page, test.info().outputPath('unconfigured-workspace.png'))
    await navigate(page, '工作')
    await expect(
      (await sidebar(page)).getByRole('button', { name: '工作', exact: true }),
    ).toHaveAttribute('aria-current', 'page')
    await expectUnconfigured(page)
    await serverSettings(page)
    const panel = page.getByRole('tabpanel')
    await expect(panel.getByRole('button', { name: '連接…', exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: '部署與管理…', exact: true })).toBeVisible()
    await captureViewport(
      app,
      page,
      test.info().outputPath('configure-bot-after-entering-workspace.png'),
    )
    await panel.getByRole('button', { name: '連接…', exact: true }).click()
    const pairingInput = page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
    await expect(pairingInput).toBeVisible()
    await pairingInput.fill('尚未送出的配對內容')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(pairingInput).toBeHidden()
    await expectUnconfigured(page)

    await serverSettings(page)
    await page.getByRole('button', { name: '連接…', exact: true }).click()
    await expect(pairingInput).toHaveValue('')
    await expect(page.getByRole('button', { name: '繼續', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '確認並連接', exact: true })).toHaveCount(0)
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    expect(connection.personId).toBe((await rig.state()).owner_person_id)
    expect(connection.baseUrl).toBe(rig.base)
    await expect(page.locator('[data-character-session]')).toHaveCount(1)
    await expect(page.locator(`[data-character-session="${connection.characterId}"]`)).toBeVisible()
    const message = '先進入工作區，再連接真實本人入口'
    await page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ }).fill(message)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(async () =>
        (await currentEvents(page)).items
          .filter((event) => event.text === message)
          .map((event) => event.author_person_id),
      )
      .toEqual([connection.personId])
    await captureViewport(app, page, test.info().outputPath('workspace-after-later-connection.png'))
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('local Yuki configuration stays reachable later and survives settings without a connection', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture()
  let app = await rig.launch('deferred-local-bot'),
    success = false
  try {
    let page = await app.firstWindow()
    await sizeWorkspace(app, page)
    await expectUnconfigured(page)
    await serverSettings(page)
    await page
      .getByRole('tabpanel')
      .getByRole('button', { name: '部署與管理…', exact: true })
      .click()
    await expect(page.getByRole('heading', { name: '在本機部署 Yuki', exact: true })).toBeVisible()
    const fields = {
      'Yuki 的名稱': '稍後部署的角色',
      你的名稱: '稍後配置的本人',
      模型服務位址: 'http://127.0.0.1:11434/v1',
      模型名稱: 'deferred-local-model',
    }
    for (const [label, value] of Object.entries(fields))
      await page.getByLabel(label, { exact: true }).fill(value)
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '在本機部署 Yuki', exact: true })).toBeVisible()
    for (const [label, value] of Object.entries(fields))
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(value)
    await captureViewport(app, page, test.info().outputPath('local-bot-draft-after-settings.png'))
    await page.getByRole('button', { name: '返回／稍後設定', exact: true }).click()
    await expectUnconfigured(page)
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+,')
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toHaveCount(0)
    await expectUnconfigured(page)
    await app.close()
    app = await rig.launch('deferred-local-bot')
    page = await app.firstWindow()
    await writeFile(
      test.info().outputPath('local-bot-cold-before-stage.json'),
      JSON.stringify({
        renderer: await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        })),
        native: await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          return { visible: window.isVisible(), contentBounds: window.getContentBounds() }
        }),
      }),
    )
    await sizeWorkspace(app, page)
    await expectUnconfigured(page)
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '在本機部署 Yuki', exact: true })).toBeVisible()
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('a late repair of an original role does not interrupt local Yuki configuration or lose its original draft', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/late-original-repair'),
    profile = 'late-original-repair'
  let app = await rig.launch(profile),
    success = false
  const pairPath = '/client/v1/pair'
  try {
    let page = await app.firstWindow()
    await sizeWorkspace(app, page)
    await pairUI(page, proxy.base, await rig.code())
    const original = await currentConnection(page),
      draft = '重新配對後仍屬於原人物與對話的草稿'
    await page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ }).fill(draft)
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const result = await window.yuki.client.draft(id)
          return result.ok && result.value
        }, original.characterId),
      )
      .toBe(draft)
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(join(rig.root, profile))
    const removed = await app.evaluate(({ app }, key) => {
      const path = process.getBuiltinModule('node:path'),
        require = process
          .getBuiltinModule('node:module')
          .createRequire(path.join(app.getAppPath(), 'package.json')),
        Database = require('better-sqlite3'),
        db = new Database(path.join(app.getPath('userData'), 'desktop.sqlite3'))
      try {
        return db.prepare('DELETE FROM credentials WHERE key = ?').run(key).changes
      } finally {
        db.close()
      }
    }, `device/${original.characterId}/${original.personId}`)
    expect(removed).toBe(1)
    await app.close()
    app = await rig.launch(profile)
    page = await app.firstWindow()
    await sizeWorkspace(app, page)
    await sidebar(page)
    expect(await currentConnection(page)).toMatchObject({
      characterId: original.characterId,
      personId: original.personId,
      bindingId: original.bindingId,
      conversationId: original.conversationId,
      needsPairing: true,
    })
    await expect(page.locator('[data-character-session]')).toHaveCount(0)
    const chooseOriginal = async () => {
      await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
      await page.getByRole('menuitemradio').filter({ hasText: original.name }).click()
    }
    const input = page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
    await chooseOriginal()
    await expect(input).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(input).toBeHidden()
    await sidebar(page)
    expect(await currentConnection(page)).toMatchObject({
      characterId: original.characterId,
      needsPairing: true,
    })
    await chooseOriginal()
    await input.fill(
      `yuki://pair?${new URLSearchParams({ server: proxy.base, code: await rig.code() })}`,
    )
    await page.getByRole('button', { name: '繼續', exact: true }).click()
    proxy.faults.holdResponseSuffixes.add(pairPath)
    await page.getByRole('button', { name: '確認並連接', exact: true }).click()
    await expect.poll(() => proxy.held.has(pairPath)).toBe(true)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '所有 Yuki', exact: true }).click()
    await page
      .getByRole('tabpanel')
      .getByRole('button', { name: '部署與管理…', exact: true })
      .click()
    const localHeading = page.getByRole('heading', { name: '在本機部署 Yuki', exact: true })
    await expect(localHeading).toBeVisible()
    proxy.faults.holdResponseSuffixes.delete(pairPath)
    proxy.releaseResponses(pairPath)
    await expect.poll(async () => (await currentConnection(page)).needsPairing ?? false).toBe(false)
    await expect(localHeading).toBeVisible()
    await captureViewport(app, page, test.info().outputPath('late-repair-keeps-local-bot-page.png'))
    await page.getByRole('button', { name: '返回／稍後設定', exact: true }).click()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toHaveValue(draft)
    expect(await currentConnection(page)).toMatchObject({
      characterId: original.characterId,
      personId: original.personId,
      bindingId: original.bindingId,
      conversationId: original.conversationId,
      needsPairing: false,
    })
    expect(
      proxy.calls.filter((call) => call.method === 'POST' && call.path === pairPath),
    ).toHaveLength(2)
    await captureViewport(
      app,
      page,
      test.info().outputPath('original-role-draft-after-late-repair.png'),
    )
    success = true
  } finally {
    proxy.faults.holdResponseSuffixes.delete(pairPath)
    proxy.releaseResponses(pairPath)
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})
