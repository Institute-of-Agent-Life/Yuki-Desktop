import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { launchShell } from '../fixtures/shell-app'

test('Windows packaged window keeps Alt hidden and native encryption survives restart', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows desktop session')
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-native-'))
  const marker = `native-roundtrip-${randomUUID()}`
  const cipherPath = join(data, 'native-cipher.bin')
  let app = await launchShell(data)
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    const facts = await app.evaluate(({ app, BrowserWindow, screen, safeStorage }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('Native window is missing')
      const display = screen.getDisplayMatching(win.getBounds())
      const renderer = app
        .getAppMetrics()
        .find((entry) => entry.pid === win.webContents.getOSProcessId())
      return {
        platform: process.platform,
        packaged: app.isPackaged,
        electron: process.versions.electron,
        pid: process.pid,
        bounds: win.getBounds(),
        workArea: display.workArea,
        scaleFactor: display.scaleFactor,
        menuVisible: win.isMenuBarVisible(),
        encryptionAvailable: safeStorage.isEncryptionAvailable(),
        rendererSandboxed: renderer?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    const nativeSession = JSON.parse(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$ErrorActionPreference='Stop'; $target=Get-Process -Id ${facts.pid}; ` +
            '[pscustomobject]@{SessionId=$target.SessionId; DesktopPresent=' +
            '(@(Get-Process explorer | Where-Object {$_.SessionId -eq $target.SessionId}).Count -gt 0)} ' +
            '| ConvertTo-Json -Compress',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
      ),
    ) as { SessionId: number; DesktopPresent: boolean }
    expect(nativeSession.SessionId).toBeGreaterThan(0)
    expect(nativeSession.DesktopPresent).toBe(true)
    const overlay = await page.evaluate(() => {
      const controls = (
        navigator as Navigator & {
          windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect }
        }
      ).windowControlsOverlay
      return { visible: controls?.visible, height: controls?.getTitlebarAreaRect().height }
    })
    expect(overlay).toEqual({ visible: true, height: 52 })
    expect(facts.platform).toBe('win32')
    expect(facts.packaged).toBe(true)
    expect(facts.rendererSandboxed).toBe(true)
    expect(
      await page.evaluate(() => ({
        require: typeof (window as unknown as { require?: unknown }).require,
        process: typeof (window as unknown as { process?: unknown }).process,
      })),
    ).toEqual({ require: 'undefined', process: 'undefined' })
    expect(facts.noSandbox).toBe(false)
    expect(facts.encryptionAvailable).toBe(true)
    expect(facts.bounds.x).toBeGreaterThanOrEqual(facts.workArea.x)
    expect(facts.bounds.y).toBeGreaterThanOrEqual(facts.workArea.y)
    expect(facts.bounds.x + facts.bounds.width).toBeLessThanOrEqual(
      facts.workArea.x + facts.workArea.width,
    )
    expect(facts.bounds.y + facts.bounds.height).toBeLessThanOrEqual(
      facts.workArea.y + facts.workArea.height,
    )
    const cipher = await app.evaluate(
      ({ safeStorage }, value) => safeStorage.encryptString(value).toString('base64'),
      marker,
    )
    await writeFile(cipherPath, Buffer.from(cipher, 'base64'))
    expect((await readFile(cipherPath)).includes(Buffer.from(marker))).toBe(false)
    await app.close()
    app = await launchShell(data)
    page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    const restored = await app.evaluate(
      ({ safeStorage }, value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
      (await readFile(cipherPath)).toString('base64'),
    )
    expect(restored).toBe(marker)
    await writeFile(
      test.info().outputPath('windows-native-facts.json'),
      JSON.stringify({ ...facts, nativeSession, overlay }, null, 2),
    )
    expect(facts.menuVisible).toBe(false)
    await page.keyboard.press('Alt')
    await page.screenshot({ path: test.info().outputPath('windows-native-alt.png') })
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMenuBarVisible()),
      )
      .toBe(false)
  } finally {
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
