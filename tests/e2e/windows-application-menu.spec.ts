import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchShell } from '../fixtures/shell-app'
import { currentConnection, pairUI } from '../fixtures/backend'
import { nativeWindowsMenu } from '../fixtures/windows-application-menu'
import { windowsFileDialogOwner } from '../fixtures/windows-file-dialog'
import { nativeWindowsControls } from '../fixtures/windows-window-controls'

test('Windows application commands have a real native menu entry before pairing and retain drafts through native quit', async () => {
  test.skip(process.platform !== 'win32', 'Requires a Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  expect(base).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  test.setTimeout(120000)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-menu-'))
  let app = await launchShell(data)
  const stages: unknown[] = [],
    proof: Record<string, unknown> = { data, stages }
  const save = () =>
    writeFile(
      test.info().outputPath('windows-application-menu.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    let page = await app.firstWindow()
    let owner = await windowsFileDialogOwner(app)
    proof.owner = owner
    const native = await app.evaluate(({ app, Menu, BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        packaged: app.isPackaged,
        platform: process.platform,
        pid: process.pid,
        labels: Menu.getApplicationMenu()?.items.map((item) => item.label),
        menuBar: window.isMenuBarVisible(),
        bounds: window.getBounds(),
        content: window.getContentBounds(),
        scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
        sandboxed: app
          .getAppMetrics()
          .find((item) => item.pid === window.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    expect(native).toMatchObject({
      packaged: true,
      platform: 'win32',
      menuBar: false,
      sandboxed: true,
      noSandbox: false,
    })
    expect(native.labels).toEqual(['檔案', '編輯', '顯示', '視窗', '說明'])
    proof.native = native
    const more = () => page.getByRole('button', { name: '更多命令', exact: true })
    const geometry = async (stage: string) => {
      await expect(more()).toHaveCount(1)
      await expect(more()).toBeInViewport({ ratio: 1 })
      const box = await more().boundingBox()
      const overlay = await page.evaluate(() => {
        const rect = (
          navigator as Navigator & { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } }
        ).windowControlsOverlay.getTitlebarAreaRect()
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      })
      expect(box!.width).toBe(28)
      expect(box!.height).toBe(28)
      expect(overlay.height).toBe(52)
      expect(box!.x + box!.width).toBeLessThanOrEqual(overlay.x + overlay.width - 12)
      stages.push({ stage, box, overlay })
      await save()
    }
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    await geometry('welcome')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeFocused()
    await more().focus()
    await page.mouse.move(20, 300)
    await page.keyboard.press('ArrowDown')
    const popup = await nativeWindowsMenu(owner)
    stages.push({ stage: 'welcome-keyboard-native-popup', popup })
    expect(popup.items.map((item) => item.name)).toEqual(native.labels)
    expect(popup.sessionId).toBeGreaterThan(0)
    const anchor = await more().boundingBox()
    const firstItem = popup.items[0]!
    const expectedX = native.content.x + anchor!.x
    const expectedY = native.content.y + anchor!.y + anchor!.height + 4
    const actualX = firstItem.rect[0] / native.scaleFactor
    const actualY = firstItem.rect[1] / native.scaleFactor
    proof.popupAnchor = { expectedX, expectedY, actualX, actualY }
    // UIA uses physical pixels; the native menu has vertical item padding.
    expect(Math.abs(actualX - expectedX)).toBeLessThanOrEqual(2)
    expect(actualY - expectedY).toBeGreaterThanOrEqual(0)
    expect(actualY - expectedY).toBeLessThanOrEqual(16)

    const capture = await nativeWindowsControls(
      { ...owner, handle: String(popup.items[0]!.windowHandle) },
      { outputPath: test.info().outputPath('native-menu-light.png') },
    )
    stages.push({ stage: 'owned-native-menu-capture', capture })
    const settings = await nativeWindowsMenu(owner, { path: ['檔案', '設定…'] })
    stages.push({ stage: 'native-settings', settings })
    await save()
    await expect(page.getByRole('region', { name: '設定', exact: true })).toBeVisible()
    await expect(more()).toHaveAttribute('aria-expanded', 'false')
    await geometry('standalone-settings')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await page.getByRole('radio', { name: '深色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    await geometry('pairing')
    const code = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(code.ok).toBe(true)
    await pairUI(page, base!, ((await code.json()) as { code: string }).code, '原生選單驗證', 20000)
    const connection = await currentConnection(page)
    const boot = await page.evaluate(() => window.yuki.client.connections())
    expect(boot.ok).toBe(true)
    if (!boot.ok) throw Error(boot.code)
    proof.connections = boot.value.map((connection) => ({
      characterId: connection.characterId,
      personId: connection.personId,
      conversationId: connection.conversationId,
      deviceId: connection.deviceId,
    }))
    const draft = 'menu-draft-' + randomUUID()
    await page
      .getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true })
      .fill(draft)
    proof.draft = draft
    await geometry('conversation')
    await more().click()
    stages.push({
      stage: 'native-palette',
      receipt: await nativeWindowsMenu(owner, { path: ['顯示', '指令面板'] }),
    })
    await expect(page.getByRole('dialog', { name: '指令面板', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await more().click()
    stages.push({
      stage: 'workspace-settings',
      receipt: await nativeWindowsMenu(owner, { path: ['檔案', '設定…'] }),
    })
    await expect(page.getByRole('region', { name: '設定', exact: true })).toBeVisible()
    await geometry('embedded-settings')
    await more().click()
    stages.push({
      stage: 'return-chat',
      receipt: await nativeWindowsMenu(owner, { path: ['顯示', '對話'] }),
    })
    await expect(
      page.getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true }),
    ).toHaveValue(draft)
    const invalid = await page.evaluate(() => window.yuki.applicationMenu({ x: -1, y: 0 }))
    expect(invalid).toMatchObject({ ok: false, code: 'validation_error' })
    proof.invalidPosition = invalid
    await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()! as ReturnType<typeof Menu.getApplicationMenu> & {
        savedPopup?: unknown
      }
      menu.savedPopup = menu.popup
      menu.popup = () => {
        throw Error('injected native popup failure')
      }
    })
    await more().click()
    await expect(page.getByRole('alert')).toHaveText('選單暫時無法開啟，請再試一次。')
    await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()! as ReturnType<typeof Menu.getApplicationMenu> & {
        savedPopup?: unknown
      }
      menu.popup = menu.savedPopup as typeof menu.popup
      delete menu.savedPopup
    })
    await more().click()
    const recovered = await nativeWindowsMenu(owner, { dismiss: true })
    stages.push({ stage: 'injected-popup-failure-recovered-native-escape', receipt: recovered })
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(more()).toHaveAttribute('aria-expanded', 'false')
    await expect(more()).toBeFocused()
    await page.screenshot({ path: test.info().outputPath('conversation-menu-dark.png') })
    await more().press('Space')
    const darkPopup = await nativeWindowsMenu(owner)
    stages.push({ stage: 'space-key-native-popup', receipt: darkPopup })
    stages.push({
      stage: 'dark-native-capture',
      capture: await nativeWindowsControls(
        { ...owner, handle: String(darkPopup.items[0]!.windowHandle) },
        { outputPath: test.info().outputPath('native-menu-dark.png') },
      ),
    })
    const closed = app.waitForEvent('close')
    stages.push({
      stage: 'native-quit',
      receipt: await nativeWindowsMenu(owner, { path: ['檔案', '結束'] }),
    })
    await closed
    proof.nativeQuitClosed = true
    app = await launchShell(data)
    page = await app.firstWindow()
    owner = await windowsFileDialogOwner(app)
    proof.reopenedOwner = owner
    expect(owner.processId).not.toBe(native.pid)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(
      page.getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true }),
    ).toHaveValue(draft)
    const cold = await page.evaluate(() => window.yuki.client.connections())
    expect(cold.ok).toBe(true)
    if (!cold.ok) throw Error(cold.code)
    expect(
      cold.value.map((connection) => ({
        characterId: connection.characterId,
        personId: connection.personId,
        conversationId: connection.conversationId,
        deviceId: connection.deviceId,
      })),
    ).toEqual(proof.connections)
    await geometry('cold-reopened-conversation')
    const normalBounds = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBounds(),
    )
    await more().click()
    stages.push({
      stage: 'native-window-menu-maximize',
      receipt: await nativeWindowsMenu(owner, { path: ['視窗', '最大化／還原'] }),
    })
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()),
      )
      .toBe(true)
    await more().click()
    stages.push({
      stage: 'native-window-menu-restore',
      receipt: await nativeWindowsMenu(owner, { path: ['視窗', '最大化／還原'] }),
    })
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized()),
      )
      .toBe(false)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds()),
      )
      .toEqual(normalBounds)
    proof.windowMenuRestoredBounds = normalBounds
    const previousWidth = await page.evaluate(() => innerWidth)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.25),
    )
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(previousWidth)
    const zoomed = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        content: window.getContentBounds(),
        bounds: window.getBounds(),
        zoom: window.webContents.getZoomFactor(),
      }
    })
    expect(zoomed.zoom).toBe(1.25)
    const zoomedAnchor = await more().boundingBox()
    const nativeControls = await nativeWindowsControls(owner)
    expect(
      zoomed.content.x + (zoomedAnchor!.x + zoomedAnchor!.width) * zoomed.zoom,
    ).toBeLessThanOrEqual(
      Math.min(...nativeControls.buttons.map((button) => button.rect[0] / native.scaleFactor)) - 12,
    )
    await more().focus()
    await page.mouse.move(20, 300)
    await page.keyboard.press('ArrowDown')
    const zoomedPopup = await nativeWindowsMenu(owner, { dismiss: true })
    const zoomedExpectedX = zoomed.content.x + zoomedAnchor!.x * zoomed.zoom
    const zoomedExpectedY =
      zoomed.content.y + (zoomedAnchor!.y + zoomedAnchor!.height + 4) * zoomed.zoom
    const zoomedActualX = zoomedPopup.items[0]!.rect[0] / native.scaleFactor
    const zoomedActualY = zoomedPopup.items[0]!.rect[1] / native.scaleFactor
    proof.zoomedAnchor = {
      rendererZoom: zoomed.zoom,
      osScaleFactor: native.scaleFactor,
      expectedX: zoomedExpectedX,
      expectedY: zoomedExpectedY,
      actualX: zoomedActualX,
      actualY: zoomedActualY,
      nativeControls,
      receipt: zoomedPopup,
    }
    expect(Math.abs(zoomedActualX - zoomedExpectedX)).toBeLessThanOrEqual(2)
    expect(zoomedActualY - zoomedExpectedY).toBeGreaterThanOrEqual(0)
    expect(zoomedActualY - zoomedExpectedY).toBeLessThanOrEqual(16)
    await expect(more()).toHaveAttribute('aria-expanded', 'false')
    await expect(
      page.getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true }),
    ).toHaveValue(draft)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1),
    )
    await page.keyboard.press('Alt')
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isMenuBarVisible(),
      ),
    ).toBe(false)
  } finally {
    await save()
    // Cleanup may close a failed popup; successful command paths above use only native UIA.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.closePopup()).catch(() => {})
    await app.close().catch(() => {})
  }
})
