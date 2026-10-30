import { activeCharacterName } from '../fixtures/active-character'
import { captureViewport, contentSize } from '../fixtures/visual'
import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
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
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` })
      .fill(privateText)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true })).toBeVisible()
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
    await page.getByLabel('時間顯示', { exact: true }).selectOption('system')
    await page.getByRole('tab', { name: '一般', exact: true }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('tab', { name: '外觀', exact: true })).toBeFocused()
    await expect(page.getByLabel('時間顯示', { exact: true })).toHaveCount(0)
    await page.getByRole('radio', { name: '深色', exact: true }).click()
    await page.getByRole('switch', { name: '永遠不透明', exact: true }).click()
    await page.getByRole('switch', { name: '減少動態', exact: true }).click()
    await page.getByRole('tab', { name: '通知', exact: true }).click()
    await page.getByRole('switch', { name: 'Yuki 主動傳來的訊息', exact: true }).click()
    await page.getByRole('tab', { name: '更新', exact: true }).click()
    await expect(page.getByRole('heading', { name: '更新', exact: true })).toBeVisible()
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
    await expect(
      page.getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` }),
    ).toBeVisible()
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
        if (viewportMethod === 'electron-device-emulation')
          await expect
            .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
            .toEqual([width, height])
        for (const category of ['一般', '外觀', '通知', '更新', '所有 Yuki', '進階']) {
          await page.getByRole('tab', { name: category, exact: true }).click()
          await expect(page.getByRole('heading', { name: category, exact: true })).toBeVisible()
          await captureViewport(
            app,
            page,
            test
              .info()
              .outputPath(
                `${process.platform}-${mode}-settings-${category}-${width}x${height}${viewportMethod === 'electron-device-emulation' ? '-emulated' : ''}.png`,
              ),
          )
        }
      }
    }
    await page.keyboard.press('ControlOrMeta+1')
    await expect(
      page.getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` }),
    ).toBeVisible()
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('full-window settings hide the workspace and restore its draft, reader position and layout', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ character: true }),
    app = await rig.launch('settings-workspace')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const seeded = await fetch(rig.base + '/__test/history?count=61', { method: 'POST' })
    expect(seeded.status).toBe(200)
    await page.reload()
    await contentSize(app, page, 1440, 900)
    const draft = '設定導覽切換仍保留的原角色草稿'
    const composer = page.getByRole('textbox', {
      name: '和 ' + (await activeCharacterName(page)) + ' 說點什麼',
      exact: true,
    })
    await composer.fill(draft)
    const sidebar = page.getByRole('navigation', { name: '主要導覽', exact: true })
    const divider = page.getByRole('separator', { name: '調整側邊欄', exact: true })
    await divider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(divider).toHaveAttribute('aria-valuenow', '264')
    await page.getByRole('button', { name: '詳情', exact: true }).click()
    const inspector = page.getByRole('complementary', { name: '詳情', exact: true })
    await expect(inspector).toBeVisible()
    const log = page.getByRole('log', { name: '對話訊息', exact: true })
    await expect(log.locator('article[data-event-id]')).toHaveCount(50)
    const readerBefore = await log.evaluate((node) => {
      node.scrollTop = (node.scrollHeight - node.clientHeight) / 2
      return { top: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight }
    })
    expect(readerBefore.top).toBeGreaterThan(0)
    await page.keyboard.press('ControlOrMeta+,')
    await expect(sidebar).toBeHidden()
    await expect(inspector).toBeHidden()
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toBeVisible()
    await expect(page.locator('section[aria-label="設定"] > header > strong')).toHaveText('設定')
    await expect(page.getByRole('button', { name: '側邊欄', exact: true })).toHaveCount(0)
    await captureViewport(app, page, test.info().outputPath('settings-single-navigation.png'))
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(composer).toHaveValue(draft)
    await expect(inspector).toBeVisible()
    await expect(divider).toHaveAttribute('aria-valuenow', '264')
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBe(readerBefore.top)
    const readerAfter = await log.evaluate((node) => ({
      top: node.scrollTop,
      height: node.scrollHeight,
      viewport: node.clientHeight,
    }))
    await page.getByRole('button', { name: '放大詳情', exact: true }).click()
    await expect(page.getByRole('button', { name: '還原版面', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await expect(sidebar).toBeHidden()
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByRole('button', { name: '還原版面', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '還原版面', exact: true }).click()
    await page.keyboard.press('ControlOrMeta+,')
    await page.keyboard.press('ControlOrMeta+2')
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: '工作', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+1')
    await expect(composer).toHaveValue(draft)
    await page.keyboard.press('ControlOrMeta+,')
    const method = await contentSize(app, page, 960, 492)
    await expect(sidebar).toBeHidden()
    await expect(page.getByRole('button', { name: '側邊欄', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeVisible()
    await captureViewport(app, page, test.info().outputPath('settings-small-' + method + '.png'))
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(composer).toHaveValue(draft)
    await writeFile(
      test.info().outputPath('settings-workspace.json'),
      JSON.stringify(
        {
          readerBefore,
          readerAfter,
          draft,
          sidebarWidth: 264,
          narrowViewportMethod: method,
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
