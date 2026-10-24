import { activeCharacterName } from '../fixtures/active-character'
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Meta } from '../../src/shared/api'
import { launchShell } from '../fixtures/shell-app'

test('Windows native onboarding keeps artwork and pairing controls reachable and pairs through the actual keyboard path', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an explicitly selected isolated loopback Yuki reference server')
  test.setTimeout(120000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const metadata = await fetch(`${base}/client/v1/meta`)
  expect(metadata.ok).toBe(true)
  const meta = ((await metadata.json()) as { data: Meta }).data
  const link = await fetch(`${base}/__test/link-code`, { method: 'POST' })
  expect(link.ok).toBe(true)
  const code = ((await link.json()) as { code: string }).code
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-onboarding-'))
  const app = await launchShell(data)
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(true)
    const facts = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        platform: process.platform,
        packaged: app.isPackaged,
        pid: process.pid,
        bounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
        normalBounds: window.getNormalBounds(),
        minimum: window.getMinimumSize(),
        workArea: screen.getDisplayMatching(window.getBounds()).workArea,
        scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
        rendererSandboxed: app
          .getAppMetrics()
          .find((item) => item.pid === window.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
        visible: window.isVisible(),
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
    ) as { SessionId: number; DesktopPresent: boolean }
    expect(facts.platform).toBe('win32')
    expect(facts.packaged).toBe(true)
    expect(facts.rendererSandboxed).toBe(true)
    expect(facts.noSandbox).toBe(false)
    expect(session.SessionId).toBeGreaterThan(0)
    expect(session.DesktopPresent).toBe(true)
    await writeFile(
      test.info().outputPath('windows-initial-geometry.json'),
      JSON.stringify(
        {
          facts,
          session,
          viewport: await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
            dpr: devicePixelRatio,
          })),
        },
        null,
        2,
      ),
    )
    expect(facts.minimum).toEqual([0, 0])
    expect(facts.visible).toBe(true)
    expect([facts.bounds.width, facts.bounds.height]).toEqual([720, 560])
    const artwork = page
      .getByRole('region', { name: '你的 Yuki 工作區', exact: true })
      .locator('svg.lucide-message-circle')
    await expect(artwork).toBeInViewport({ ratio: 1 })
    await expect(artwork).toHaveCSS('height', '40px')
    const appearance = await page.evaluate(() => ({
      dpr: devicePixelRatio,
      theme: document.documentElement.dataset.theme,
      opaque: document.documentElement.dataset.opaque,
      contrast: document.documentElement.dataset.contrast,
    }))
    expect(['light', 'dark']).toContain(appearance.theme)
    expect(appearance.dpr).toBe(facts.scaleFactor)
    const prefix = `win32-${appearance.dpr}x-${appearance.theme}-`
    await page.screenshot({
      path: test
        .info()
        .outputPath(
          prefix +
            `state-onboarding-welcome-native-${facts.contentBounds.width}x${facts.contentBounds.height}.png`,
        ),
    })
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).press('Enter')
    await page.getByRole('button', { name: '手動輸入伺服器位址', exact: true }).click()
    await page.getByLabel('伺服器位址', { exact: true }).fill(base!)
    const next = page.getByRole('button', { name: '繼續', exact: true })
    await expect(next).toHaveCSS('height', '28px')
    await next.press('Enter')
    await expect(
      page.getByRole('heading', { name: meta.character.display_name, exact: true }),
    ).toBeVisible()
    const input = page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
    await input.fill('A'.repeat(64))
    const pair = page.getByRole('button', { name: '確認並連接', exact: true })
    await expect(pair).toBeDisabled()
    await input.fill(`綁定碼：${code}（10 分鐘內有效）`)
    await expect(pair).toBeEnabled()
    await expect(input).toHaveCSS('height', '36px')
    await expect(input).toHaveCSS('font-size', '13px')
    const paste = page.getByRole('button', { name: '貼上', exact: true })
    await expect(paste).toHaveCSS('height', '28px')
    await input.press('Tab')
    await expect(paste).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByLabel('這台裝置的名稱')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '返回', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(pair).toBeFocused()
    await expect(pair).toBeInViewport({ ratio: 1 })
    await expect(pair).toHaveCSS('height', '28px')
    await expect(page.getByText(`伺服器：${base}`, { exact: true })).toBeVisible()
    await page.screenshot({
      path: test
        .info()
        .outputPath(
          prefix +
            `state-onboarding-code-native-${facts.contentBounds.width}x${facts.contentBounds.height}.png`,
        ),
    })
    await pair.press('Enter')
    await expect(
      page.getByRole('textbox', {
        name: `和 ${await activeCharacterName(page)} 說點什麼`,
        exact: true,
      }),
    ).toBeVisible()
    const connection = await page.evaluate(() => window.yuki.client.connections())
    expect(connection.ok && connection.value[0]?.characterId).toBe(meta.character.id)
    expect(connection.ok && connection.value[0]?.persistentCredentials).toBe(true)
    await writeFile(
      test.info().outputPath('windows-native-onboarding.json'),
      JSON.stringify({ facts, session, appearance, characterId: meta.character.id }, null, 2) +
        '\n',
    )
  } finally {
    await app.close()
    console.log(`Windows onboarding evidence profile: ${data}`)
  }
})
