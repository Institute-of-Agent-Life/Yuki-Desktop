import { expect, test } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pairUI } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'
import { windowsFileDialogOwner } from '../fixtures/windows-file-dialog'
import { nativeWindowsControls, captionContrast } from '../fixtures/windows-window-controls'

test('Windows native caption stays legible through Settings themes and actual maximize and restore buttons', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires a fresh isolated reference server')
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  test.setTimeout(120000)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-caption-'))
  const app = await launchShell(data)
  const pid = await app.evaluate(() => process.pid)
  const proof: Record<string, unknown> = { data, pid, stages: [] }
  const stages = proof.stages as unknown[]
  const save = () =>
    writeFile(
      test.info().outputPath('windows-native-caption.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    const page = await app.firstWindow()
    const response = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(response.ok).toBe(true)
    await pairUI(
      page,
      base!,
      ((await response.json()) as { code: string }).code,
      'Windows 原生視窗按鈕',
      20000,
    )
    await page.keyboard.press('Control+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const owner = await windowsFileDialogOwner(app)
    expect(owner.processId).toBe(pid)
    expect(owner.executable).toBe(process.env.YUKI_ELECTRON_EXECUTABLE)
    proof.owner = owner
    const native = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        platform: process.platform,
        bounds: window.getBounds(),
        packaged: app.isPackaged,
        browserPid: app.getAppMetrics().find((item) => item.type === 'Browser')?.pid,
        sandboxed: app
          .getAppMetrics()
          .find((item) => item.pid === window.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
        dpr: screen.getDisplayMatching(window.getBounds()).scaleFactor,
      }
    })
    expect(native).toMatchObject({
      platform: 'win32',
      packaged: true,
      browserPid: pid,
      sandboxed: true,
      noSandbox: false,
    })
    proof.native = native
    for (const [theme, label] of [
      ['light', '淺色'],
      ['dark', '深色'],
    ] as const) {
      await page
        .getByRole('tablist', { name: '主題', exact: true })
        .getByRole('tab', { name: label, exact: true })
        .click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect
        .poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors))
        .toBe(theme === 'dark')
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds()),
        )
        .toEqual(native.bounds)
      const receipt = await nativeWindowsControls(owner, {
        outputPath: test.info().outputPath(`windows-native-caption-${theme}.png`),
      })
      expect(receipt).toMatchObject({ processId: pid, physicalCoordinates: true })
      expect(receipt.sessionId).toBeGreaterThan(0)
      expect(receipt.windowDpi / 96).toBe(native.dpr)
      expect(receipt.buttons).toHaveLength(3)
      const contrast = await captionContrast(app, receipt)
      stages.push({ stage: theme, receipt, contrast })
      await save()
      for (const button of contrast)
        expect(button.legiblePixels, `${theme}: ${button.name}`).toBeGreaterThanOrEqual(4)
      const overlay = await page.evaluate(() => {
        const controls = (
          navigator as Navigator & {
            windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect }
          }
        ).windowControlsOverlay
        return { visible: controls?.visible, height: controls?.getTitlebarAreaRect().height }
      })
      expect(overlay).toEqual({ visible: true, height: 52 })
    }
    const before = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBounds(),
    )
    const controls = await nativeWindowsControls(owner)
    const maximize = [...controls.buttons].sort((a, b) => a.rect[0] - b.rect[0])[1]!
    const invokedMaximize = await nativeWindowsControls(owner, { invokeName: maximize.name })
    expect(invokedMaximize.invoked).toBe(maximize.name)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()),
      )
      .toBe(true)
    const maximized = await nativeWindowsControls(owner, {
      outputPath: test.info().outputPath('windows-native-maximized.png'),
    })
    stages.push({ stage: 'actual-native-maximize', receipt: maximized, invokedMaximize })
    await save()
    const restore = [...maximized.buttons].sort((a, b) => a.rect[0] - b.rect[0])[1]!
    const invokedRestore = await nativeWindowsControls(owner, { invokeName: restore.name })
    expect(invokedRestore.invoked).toBe(restore.name)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()),
      )
      .toBe(false)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds()),
      )
      .toEqual(before)
    stages.push({ stage: 'actual-native-restore', invokedRestore, bounds: before })
    proof.complete = true
  } catch (error) {
    proof.error = String(error)
    throw error
  } finally {
    await save()
    const executable = process.env.YUKI_ELECTRON_EXECUTABLE!.replaceAll("'", "''")
    const script = `$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){if($p.ExecutablePath -cne '${executable}'){throw 'Refuse unrelated process'}; Stop-Process -Id ${pid} -Force}`
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { timeout: 10000, windowsHide: true },
    )
    await app.close().catch(() => {})
  }
})
