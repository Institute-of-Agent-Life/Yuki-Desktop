import { captureViewport, contentSize } from '../fixtures/visual'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'

test('actual settings paths retain native preferences, timezone, notifications and private diagnostic export', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture()
  let app = await rig.launch('settings'),
    success = false
  try {
    let page = await app.firstWindow()
    const exportPath = join(rig.root, 'diagnostics.json')
    await app.evaluate(({ app, dialog }, path) => {
      const state = globalThis as typeof globalThis & {
        login: { requested: boolean; approved: boolean; sets: boolean[] }
        diagnosticToken?: string
      }
      state.login = { requested: false, approved: false, sets: [] }
      app.getLoginItemSettings = () => ({
        openAtLogin: state.login.requested,
        status: state.login.requested && !state.login.approved ? 'requires-approval' : 'enabled',
        openAsHidden: false,
        wasOpenedAtLogin: false,
        wasOpenedAsHidden: false,
        restoreState: false,
        executableWillLaunchAtLogin: state.login.requested && state.login.approved,
        launchItems: [],
      })
      app.setLoginItemSettings = (options) => {
        state.login.requested = !!options.openAtLogin
        state.login.sets.push(!!options.openAtLogin)
      }
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
      const original = globalThis.fetch
      globalThis.fetch = (input, init) => {
        const bearer = (init?.headers as Record<string, string> | undefined)?.Authorization
        if (bearer) state.diagnosticToken = bearer.replace(/^Bearer /, '')
        return original(input, init)
      }
    }, exportPath)
    await pairUI(page, rig.base, await rig.code())
    const privateText = '這是診斷檔不得包含的原訊息 /private/project/source-secret.md'
    await page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ }).fill(privateText)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true }).last()).toBeVisible()
    const cdp = await app.context().newCDPSession(page)
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' })
    const time = page.locator('article[aria-label="你的訊息"] time').first()
    const originalTimestamp = await time.getAttribute('datetime')
    const expectedTaipei = await page.evaluate(
      (timestamp) =>
        new Date(timestamp!).toLocaleString(undefined, {
          timeZone: 'Asia/Taipei',
          hour: '2-digit',
          minute: '2-digit',
        }),
      originalTimestamp,
    )
    await expect(time).toHaveText(expectedTaipei)
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const login = page.getByRole('switch', { name: '登入時開啟', exact: true })
    if (process.env.YUKI_DESKTOP_EXECUTABLE) {
      await login.click()
      await expect(login).toHaveAttribute('aria-checked', 'false')
      await expect(
        page.getByText('需要到系統的登入項目設定中核准。', { exact: true }),
      ).toBeVisible()
      await app.evaluate(() => {
        ;(globalThis as typeof globalThis & { login: { approved: boolean } }).login.approved = true
      })
      await page.getByRole('button', { name: '重新讀取登入設定', exact: true }).click()
      await expect(login).toHaveAttribute('aria-checked', 'true')
      await login.click()
      await expect(login).toHaveAttribute('aria-checked', 'false')
      expect(
        await app.evaluate(
          () => (globalThis as typeof globalThis & { login: { sets: boolean[] } }).login.sets,
        ),
      ).toEqual([true, false])
    } else await expect(login).toBeDisabled()
    await page.getByRole('tab', { name: '一般', exact: true }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('tab', { name: '外觀', exact: true })).toBeFocused()
    await page.getByLabel('時間顯示', { exact: true }).selectOption('system')
    await page.getByRole('radio', { name: '深色', exact: true }).click()
    await page.getByRole('switch', { name: '永遠不透明', exact: true }).click()
    await page.getByRole('switch', { name: '減少動態', exact: true }).click()
    await page.getByRole('tab', { name: '通知', exact: true }).click()
    await page.getByRole('switch', { name: '角色主動訊息', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const expectedSystem = await page.evaluate(
      (timestamp) =>
        new Date(timestamp!).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' }),
      originalTimestamp,
    )
    await expect(time).toHaveText(expectedSystem)
    expect(await time.getAttribute('datetime')).toBe(originalTimestamp)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '進階', exact: true }).click()
    await page.getByRole('button', { name: '匯出…', exact: true }).click()
    await expect(page.getByText('診斷記錄已匯出。', { exact: true })).toBeVisible()
    const raw = await readFile(exportPath, 'utf8'),
      snapshot = JSON.parse(raw)
    expect(raw).not.toContain(privateText)
    expect(raw).not.toContain(rig.root)
    expect(snapshot.local.connections).toBe(1)
    expect(
      Object.values(snapshot.local.messages).reduce((sum: number, value) => sum + Number(value), 0),
    ).toBe(1)
    expect(
      await app.evaluate((_, summary) => {
        const secret = (globalThis as typeof globalThis & { diagnosticToken?: string })
          .diagnosticToken
        if (!secret) throw Error('test did not observe the actual credential')
        return !summary.includes(secret)
      }, raw),
    ).toBe(true)
    const saved = await page.evaluate(async () => (await window.yuki.boot()).preferences)
    expect(saved).toMatchObject({
      timeZone: 'system',
      theme: 'dark',
      opaque: true,
      reducedMotion: true,
      notifyProactive: false,
    })
    await app.close()
    app = await rig.launch('settings')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
    expect(await page.evaluate(async () => (await window.yuki.boot()).preferences)).toEqual(saved)
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('settings categories remain keyboard reachable in all four themes and small workspaces', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('settings-visual')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await page.keyboard.press('ControlOrMeta+,')
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await contentSize(app, page, 1440, 900)
      await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 900])
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radio', { name: mode === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      for (const [label, value] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = page.getByRole('switch', { name: label, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(value)) await toggle.click()
      }
      for (const [width, height] of [
        [1440, 900],
        [1100, 760],
        [960, 492],
      ] as const) {
        const viewportMethod = await contentSize(app, page, width, height)
        await expect
          .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
          .toEqual([width, height])
        for (const category of ['一般', '外觀', '通知', '進階']) {
          await page.getByRole('tab', { name: category, exact: true }).click()
          await expect(page.getByRole('heading', { name: category, exact: true })).toBeVisible()
          await captureViewport(
            app,
            page,
            test
              .info()
              .outputPath(
                `${process.platform}-${await page.evaluate(() => devicePixelRatio)}x-${mode}-settings-${category}-${width}x${height}${viewportMethod === 'electron-device-emulation' ? '-emulated' : ''}.png`,
              ),
          )
        }
      }
    }
    await page.keyboard.press('ControlOrMeta+1')
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('settings use the original role workspace, preserve its inspector and restore navigation from a small overlay', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('settings-workspace')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await contentSize(app, page, 1440, 900)
    const draft = '設定導覽切換仍保留的原角色草稿'
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/, exact: true })
    await composer.fill(draft)
    const sidebar = page.getByRole('navigation', { name: '主要導覽', exact: true })
    const divider = page.getByRole('separator', { name: '調整側邊欄', exact: true })
    await divider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(divider).toHaveAttribute('aria-valuenow', '264')
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '檢視器', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeVisible()
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByRole('button', { name: '設定', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(divider).toHaveAttribute('aria-valuenow', '264')
    expect(
      await sidebar.evaluate((node) => {
        const style = getComputedStyle(node)
        return (
          node.getBoundingClientRect().width +
          parseFloat(style.marginLeft) +
          parseFloat(style.marginRight)
        )
      }),
    ).toBe(264)
    expect(
      (await page.getByRole('tablist', { name: '設定分類', exact: true }).boundingBox())!.width,
    ).toBe(200)
    await expect(page.getByRole('complementary', { name: '檢視器', exact: true })).toHaveCount(0)
    await page.screenshot({
      path: test.info().outputPath('settings-with-original-role-sidebar.png'),
    })
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(composer).toHaveValue(draft)
    await expect(page.getByRole('complementary', { name: '檢視器', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '展開工作區', exact: true }).click()
    await expect(page.getByRole('button', { name: '收合工作區', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await expect(sidebar).toBeVisible()
    await expect(page.getByRole('complementary', { name: '檢視器', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByRole('button', { name: '收合工作區', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '收合工作區', exact: true }).click()
    await page.keyboard.press('ControlOrMeta+,')
    await sidebar.getByRole('button', { name: '工作', exact: true }).click()
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '工作', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+1')
    await expect(composer).toHaveValue(draft)
    await page.keyboard.press('ControlOrMeta+,')
    await sidebar.getByRole('button', { name: /^關於 .+$/ }).click()
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '編輯角色資料', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    const method = await contentSize(app, page, 960, 492)
    await expect(sidebar).toBeHidden()
    await page.getByRole('button', { name: '側邊欄', exact: true }).click()
    await expect(sidebar).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sidebar).toBeHidden()
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeVisible()
    await captureViewport(app, page, test.info().outputPath(`settings-small-${method}.png`))
    await page.getByRole('button', { name: '側邊欄', exact: true }).click()
    await sidebar.getByRole('button', { name: '對話', exact: true }).click()
    await expect(composer).toHaveValue(draft)
    await expect(sidebar).toBeHidden()
    await page.getByRole('button', { name: '側邊欄', exact: true }).click()
    await expect(sidebar).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await expect(sidebar).toBeHidden()
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeVisible()
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})
