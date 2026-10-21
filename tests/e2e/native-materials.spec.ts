import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchShell } from '../fixtures/shell-app'
import { pairUI } from '../fixtures/backend'

async function snapshot(app: ElectronApplication, page: Page) {
  const renderer = await page.evaluate(() => {
    const root = document.documentElement
    const sidebar = document.querySelector('[data-region="sidebar"]')!
    const content = document.querySelector('section[aria-label="設定"]')!
    return {
      theme: root.dataset.theme,
      material: root.dataset.material,
      root: getComputedStyle(root).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      sidebar: getComputedStyle(sidebar).backgroundColor,
      sidebarImage: getComputedStyle(sidebar).backgroundImage,
      content: getComputedStyle(content).backgroundColor,
      ground: getComputedStyle(document.querySelector('main')!).backgroundColor,
      windowColor: getComputedStyle(root).getPropertyValue('--bg-window').trim(),
      sidebarColor: getComputedStyle(root).getPropertyValue('--bg-sidebar').trim(),
    }
  })
  return {
    renderer,
    native: await app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const [, height] = window.getContentSize()
      const pixel = await window.webContents.capturePage({
        x: 2,
        y: height! - 80,
        width: 1,
        height: 1,
      })
      return {
        background: window.getBackgroundColor(),
        bounds: window.getBounds(),
        groundPixel: [...pixel.toBitmap({ scaleFactor: 1 }).subarray(0, 4)],
      }
    }),
  }
}

async function paintedSnapshot(app: ElectronApplication, page: Page, alpha: number) {
  // A 5% panel shadow can add coverage over the exposed ground strip.
  // Verify the exact ground color separately and bound the composited pixel by that shadow.
  await expect
    .poll(async () => {
      const actual = (await snapshot(app, page)).native.groundPixel[3]!
      return actual >= alpha && actual <= Math.ceil(alpha + (255 - alpha) * 0.05)
    })
    .toBe(true)
  return snapshot(app, page)
}

test('native material remains exposed only beneath the sidebar and follows actual appearance controls', async () => {
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires a fresh isolated reference server')
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  test.setTimeout(120000)
  const data = await mkdtemp(join(tmpdir(), 'yuki-native-materials-'))
  let app = await launchShell(data)
  const stages: unknown[] = []
  const proof: Record<string, unknown> = { data, stages }
  const save = () =>
    writeFile(
      test.info().outputPath('native-materials.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    let page = await app.firstWindow()
    const response = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(response.ok).toBe(true)
    await pairUI(
      page,
      base!,
      ((await response.json()) as { code: string }).code,
      '原生材質驗證',
      20000,
    )
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const native = await app.evaluate(({ app, BrowserWindow }) => ({
      platform: process.platform,
      os: process.getBuiltinModule('node:os').release(),
      packaged: app.isPackaged,
      sandboxed: app
        .getAppMetrics()
        .find(
          (entry) => entry.pid === BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
        )?.sandboxed,
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    }))
    expect(native).toMatchObject({ packaged: true, sandboxed: true, noSandbox: false })
    proof.native = native
    const supported =
      native.platform === 'darwin'
        ? 'vibrancy'
        : native.platform === 'win32' && Number(native.os.split('.')[2]) >= 22621
          ? 'mica'
          : 'none'
    const boot = await page.evaluate(() => window.yuki.boot())
    proof.boot = boot
    expect(boot.nativeMaterial).toBe(supported)
    const systemOpaque = boot.reducedTransparency || boot.highContrast
    const material = systemOpaque ? 'none' : supported
    const initialBounds = (await snapshot(app, page)).native.bounds
    for (const [theme, label] of [
      ['light', '淺色'],
      ['dark', '深色'],
    ] as const) {
      await page
        .getByRole('radiogroup', { name: '主題', exact: true })
        .getByRole('radio', { name: label, exact: true })
        .click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const expectedAlpha =
        material === 'none' ? 255 : Math.round((theme === 'dark' ? 0.88 : 0.84) * 255)
      const normal = await paintedSnapshot(app, page, expectedAlpha)
      stages.push({ stage: theme, ...normal })
      await save()
      const opaqueBackground = theme === 'dark' ? '#101215' : '#e9edf3'
      const opaqueRoot = theme === 'dark' ? 'rgb(16, 18, 21)' : 'rgb(233, 237, 243)'
      const opaqueSidebar = theme === 'dark' ? 'rgb(32, 34, 39)' : 'rgb(230, 234, 240)'
      expect(normal.renderer.root).toBe(material === 'none' ? opaqueRoot : 'rgba(0, 0, 0, 0)')
      expect(normal.native.background.toLowerCase()).toBe(
        material === 'none' ? opaqueBackground : '#000000',
      )
      expect(normal.renderer.material).toBe(material)
      expect(normal.renderer.ground).toBe(
        material === 'none'
          ? opaqueRoot
          : theme === 'dark'
            ? 'rgba(14, 15, 19, 0.88)'
            : 'rgba(229, 234, 242, 0.84)',
      )
      expect(normal.native.groundPixel[3]).toBeGreaterThanOrEqual(expectedAlpha)
      expect(normal.native.groundPixel[3]).toBeLessThanOrEqual(
        Math.ceil(expectedAlpha + (255 - expectedAlpha) * 0.05),
      )
      if (material === 'none') expect(normal.renderer.sidebar).toBe(opaqueSidebar)
      else {
        expect(normal.renderer.sidebar).toBe('rgba(0, 0, 0, 0)')
        expect(normal.renderer.sidebarImage).toContain('linear-gradient')
      }
      expect(normal.renderer.content).toBe(
        theme === 'dark' ? 'rgb(27, 29, 34)' : 'rgb(255, 255, 255)',
      )
      expect(normal.native.bounds).toEqual(initialBounds)
      await page.screenshot({ path: test.info().outputPath(`native-material-${theme}.png`) })
      await page.getByRole('switch', { name: '永遠不透明', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-material', 'none')
      const opaque = await paintedSnapshot(app, page, 255)
      stages.push({ stage: theme + '-opaque', ...opaque })
      await save()
      expect(opaque.renderer.root).toBe(opaqueRoot)
      expect(opaque.native.groundPixel[3]).toBe(255)
      expect(opaque.renderer.sidebar).toBe(opaqueSidebar)
      expect(opaque.native.background.toLowerCase()).toBe(opaqueBackground)
      expect(opaque.native.bounds).toEqual(initialBounds)
      await page.getByRole('switch', { name: '永遠不透明', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-material', material)
      await expect
        .poll(async () => (await snapshot(app, page)).native.background.toLowerCase())
        .toBe(material === 'none' ? opaqueBackground : '#000000')
      await page.getByRole('switch', { name: '增加對比', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-material', 'none')
      const contrast = await paintedSnapshot(app, page, 255)
      stages.push({ stage: theme + '-contrast', ...contrast })
      await save()
      expect(contrast.renderer.sidebar).toBe(opaqueSidebar)
      expect(contrast.native.groundPixel[3]).toBe(255)
      expect(contrast.native.background.toLowerCase()).toBe(opaqueBackground)
      await page.getByRole('switch', { name: '增加對比', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-material', material)
    }
    await page.getByRole('switch', { name: '永遠不透明', exact: true }).click()
    await app.close()
    app = await launchShell(data)
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-material', 'none')
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await expect(page.getByRole('switch', { name: '永遠不透明', exact: true })).toBeChecked()
    const cold = await paintedSnapshot(app, page, 255)
    stages.push({ stage: 'cold-opaque', ...cold })
    expect(cold.native.background.toLowerCase()).toBe('#101215')
    expect(cold.renderer.sidebar).toBe('rgb(32, 34, 39)')
    expect(cold.native.groundPixel[3]).toBe(255)
    await page.getByRole('switch', { name: '永遠不透明', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-material', material)
    const enabledAlpha = material === 'none' ? 255 : Math.round(0.88 * 255)
    const enabled = await paintedSnapshot(app, page, enabledAlpha)
    stages.push({ stage: 'cold-enable-material', ...enabled })
    expect(enabled.renderer.ground).toBe(
      material === 'none' ? 'rgb(16, 18, 21)' : 'rgba(14, 15, 19, 0.88)',
    )
    expect(enabled.native.groundPixel[3]).toBeGreaterThanOrEqual(enabledAlpha)
    expect(enabled.native.groundPixel[3]).toBeLessThanOrEqual(
      Math.ceil(enabledAlpha + (255 - enabledAlpha) * 0.05),
    )
    proof.complete = true
  } catch (error) {
    proof.error = String(error)
    throw error
  } finally {
    await save()
    await app.close().catch(() => {})
  }
})
