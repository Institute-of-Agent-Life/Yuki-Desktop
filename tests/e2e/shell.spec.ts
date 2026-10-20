import { expect, test } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchShell } from '../fixtures/shell-app'

test('native startup, actual button and keyboard paths, preferences survive restart', async () => {
  const data = await mkdtemp(join(tmpdir(), 'yuki-desktop-test-'))
  const launch = () => launchShell(data)
  const started = performance.now()
  const timings: Record<string, number> = {}
  let success = false
  let app = await launch()
  timings.mainConnectedMs = performance.now() - started
  try {
    let page = await app.firstWindow()
    timings.windowOpenedMs = performance.now() - started
    await page.waitForLoadState('domcontentloaded')
    timings.domReadyMs = performance.now() - started
    const runtime = await app.evaluate(({ app, BrowserWindow, Menu }) => ({
      platform: process.platform,
      menuLabels: Menu.getApplicationMenu()?.items.map((item) => item.label),
      arch: process.arch,
      packaged: app.isPackaged,
      electron: process.versions.electron,
      translated: app.runningUnderARM64Translation,
      sandboxed: app
        .getAppMetrics()
        .find(
          (entry) => entry.pid === BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
        )?.sandboxed,
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    }))
    if (process.env.YUKI_NATIVE_EXPECT_ARCH)
      expect(runtime.arch).toBe(process.env.YUKI_NATIVE_EXPECT_ARCH)
    if (process.env.YUKI_NATIVE_EXPECT_TRANSLATION === '1') expect(runtime.translated).toBe(true)
    await writeFile(
      test.info().outputPath('native-runtime.json'),
      JSON.stringify(runtime, null, 2) + '\n',
    )

    if (runtime.platform === 'darwin') {
      expect(runtime.menuLabels).toEqual(['Yuki', '檔案', '編輯', '顯示', '視窗', '說明'])
      await expect(page.getByRole('button', { name: '更多命令', exact: true })).toHaveCount(0)
    }
    await expect(page.getByRole('button', { name: '開始', exact: true })).toBeVisible()
    timings.firstControlReadyMs = performance.now() - started
    await page.getByRole('button', { name: '開始', exact: true }).click()
    await expect(page.getByLabel('伺服器位址')).toBeFocused()
    await page.getByLabel('伺服器位址').fill('https://example.invalid/mika')
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('region', { name: '設定', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await page.getByRole('tab', { name: '深色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('switch', { name: '永遠不透明' }).click()
    await expect(page.getByRole('switch', { name: '永遠不透明' })).toBeChecked()
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('settings-dark.png'),
    })
    const isolated = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }))
    expect(isolated).toEqual({ require: 'undefined', process: 'undefined' })
    await page.evaluate(() => window.open('https://example.invalid'))
    expect(app.windows()).toHaveLength(1)
    await app.close()
    const reopenStarted = performance.now()
    app = await launch()
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    timings.reopenedControlReadyMs = performance.now() - reopenStarted
    success = true
  } finally {
    // Debugger-attached functional timing is separate from cold-start SLA acceptance.
    await writeFile(
      test.info().outputPath('native-functional-timings.json'),
      JSON.stringify(timings, null, 2) + '\n',
    )
    await app.close()
    if (success) await rm(data, { recursive: true, force: true })
    else console.log(`Native shell evidence profile: ${data}`)
  }
})
