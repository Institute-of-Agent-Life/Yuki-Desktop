import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Meta } from '../../src/shared/api'
import { yukiFixture } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'

test('Windows packaged onboarding offers three choices and pairs through the actual keyboard path', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  test.setTimeout(120000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  const rig = await yukiFixture(),
    metadata = await fetch(`${rig.base}/client/v1/meta`)
  expect(metadata.ok).toBe(true)
  const meta = ((await metadata.json()) as { data: Meta }).data,
    code = await rig.code(),
    app = await launchShell(join(rig.root, 'profile'))
  let success = false
  try {
    const page = await app.firstWindow()
    for (const name of [
      '連接已有 Yuki',
      '在本機部署 Yuki',
      '先逛逛，稍後設定',
      '設定',
      '使用說明',
    ]) {
      const button = page.getByRole('button', { name, exact: true })
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeInViewport({ ratio: 1 })
    }
    const facts = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        platform: process.platform,
        packaged: app.isPackaged,
        pid: process.pid,
        bounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
        minimum: window.getMinimumSize(),
        scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
        rendererSandboxed: app
          .getAppMetrics()
          .find((entry) => entry.pid === window.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    const session = JSON.parse(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$target=Get-Process -Id ${facts.pid}; [pscustomobject]@{SessionId=$target.SessionId; ` +
            'DesktopPresent=(@(Get-Process explorer | Where-Object {$_.SessionId -eq $target.SessionId}).Count -gt 0)} | ConvertTo-Json -Compress',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 },
      ),
    ) as {
      SessionId: number
      DesktopPresent: boolean
    }
    expect(facts).toMatchObject({
      platform: 'win32',
      packaged: true,
      rendererSandboxed: true,
      noSandbox: false,
    })
    expect(session.SessionId).toBeGreaterThan(0)
    expect(session.DesktopPresent).toBe(true)
    await page.getByRole('button', { name: '先逛逛，稍後設定', exact: true }).press('Enter')
    await expect(page.getByRole('heading', { name: '你的 Yuki 工作區', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toHaveCount(0)
    await page.getByRole('button', { name: '設定', exact: true }).click()
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).press('Enter')
    const input = page
      .getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
      .filter({ visible: true })
    await input.fill(`yuki://pair?${new URLSearchParams({ server: rig.base, code })}`)
    await page.getByRole('button', { name: '繼續', exact: true }).press('Enter')
    await expect(
      page.getByRole('heading', { name: meta.character.display_name, exact: true }),
    ).toBeVisible()
    await expect(page.getByText(`伺服器：${rig.base}`, { exact: true })).toBeVisible()
    const device = page.getByLabel('這台裝置的名稱', { exact: true }),
      confirm = page.getByRole('button', { name: '確認並連接', exact: true })
    await device.fill('')
    await expect(confirm).toBeDisabled()
    await device.fill('Windows 原生鍵盤驗證')
    await input.focus()
    await input.press('Tab')
    await expect(page.getByRole('button', { name: '貼上', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(device).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '返回', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(confirm).toBeFocused()
    await expect(confirm).toBeInViewport({ ratio: 1 })
    await page.screenshot({
      path: test.info().outputPath('windows-native-pairing-confirmation.png'),
    })
    await confirm.press('Enter')
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible({
      timeout: 30000,
    })
    const connection = await page.evaluate(() => window.yuki.client.connections())
    expect(connection.ok && connection.value[0]?.characterId).toBe(meta.character.id)
    expect(connection.ok && connection.value[0]?.persistentCredentials).toBe(true)
    await writeFile(
      test.info().outputPath('windows-native-onboarding.json'),
      JSON.stringify(
        {
          facts,
          session,
          characterId: meta.character.id,
          viewport: await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
            dpr: devicePixelRatio,
          })),
        },
        null,
        2,
      ) + '\n',
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
