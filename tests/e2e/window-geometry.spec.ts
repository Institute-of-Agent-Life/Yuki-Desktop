import { expect, test, type ElectronApplication } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { contentSize } from '../fixtures/visual'

async function savedBounds(app: ElectronApplication) {
  return app.evaluate(({ app }) => {
    const { createRequire } = process.getBuiltinModule('node:module')
    const { join } = process.getBuiltinModule('node:path')
    const require = createRequire(app.getAppPath() + '/package.json')
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(join(app.getPath('userData'), 'desktop.sqlite3'), { readonly: true })
    try {
      const row = db.prepare("SELECT value FROM preferences WHERE key='window'").get() as
        { value: string } | undefined
      return row
        ? (JSON.parse(row.value) as { x: number; y: number; width: number; height: number })
        : null
    } finally {
      db.close()
    }
  })
}

test('native movement persists without resizing feedback and a cold launch recovers an offscreen titlebar', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture()
  let app = await rig.launch('native-window-moves'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const security = await app.evaluate(({ app, BrowserWindow }) => {
      const renderer = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId()
      return {
        sandboxed: app.getAppMetrics().find((item) => item.pid === renderer)?.sandboxed,
        linuxSeccomp:
          process.platform === 'linux'
            ? process
                .getBuiltinModule('node:fs')
                .readFileSync(`/proc/${renderer}/status`, 'utf8')
                .match(/^Seccomp:\s+(\d+)$/m)?.[1]
            : undefined,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    expect(security.noSandbox).toBe(false)
    if (process.platform === 'linux') expect(security.linuxSeccomp).toBe('2')
    else expect(security.sandboxed).toBe(true)
    const area = await app.evaluate(
      ({ BrowserWindow, screen }) =>
        screen.getDisplayMatching(BrowserWindow.getAllWindows()[0]!.getBounds()).workArea,
    )
    await writeFile(
      test.info().outputPath('native-work-area.json'),
      JSON.stringify({ area, method: 'native-window-programmatic-move' }, null, 2),
    )
    if (area.width < 1220 || area.height < 860) {
      success = true
      test.skip(true, 'The native work area cannot fit the window and a visible movement margin.')
    }
    expect(await contentSize(app, page, 1100, 760)).toBe('native-window')
    const point = { x: area.x + 120, y: area.y + 100 }
    await app.evaluate(
      ({ BrowserWindow }, point) => BrowserWindow.getAllWindows()[0]!.setPosition(point.x, point.y),
      point,
    )
    const before = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBounds(),
    )
    expect(before).toMatchObject(point)
    // Observe the actual persisted receipt before SIGKILL; no close event can save it for us.
    await expect.poll(() => savedBounds(app)).toEqual(before)
    const crashed = app.waitForEvent('close')
    await app.evaluate(() => process.exit(1)).catch(() => {})
    await crashed
    app = await rig.launch('native-window-moves')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
    const restored = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBounds(),
    )
    expect(restored).toMatchObject({ x: before.x, y: before.y })
    const scaleFactor = await app.evaluate(
      ({ BrowserWindow, screen }) =>
        screen.getDisplayMatching(BrowserWindow.getAllWindows()[0]!.getBounds()).scaleFactor,
    )
    const pixelStepInIntegerDip = Math.ceil(1 / scaleFactor)
    expect(Math.abs(restored.width - before.width)).toBeLessThanOrEqual(pixelStepInIntegerDip)
    expect(Math.abs(restored.height - before.height)).toBeLessThanOrEqual(pixelStepInIntegerDip)
    // Native frame creation can round the first restore to a representable DIP.
    // Subsequent cold launches must retain that exact rectangle, not grow each time.
    for (let round = 0; round < 2; round++) {
      await app.close()
      app = await rig.launch('native-window-moves')
      page = await app.firstWindow()
      await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
      expect(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds()),
      ).toEqual(restored)
    }
    const nativeMoved = await app.evaluate(({ BrowserWindow }, area) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setPosition(area.x + area.width - 100, area.y + area.height - 100)
      return window.getBounds()
    }, area)
    await expect.poll(() => savedBounds(app)).toEqual(nativeMoved)
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds()),
    ).toEqual(nativeMoved)
    await app.close()
    app = await rig.launch('native-window-moves')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
    const recovered = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getBounds(),
    )
    expect(recovered.x).toBeGreaterThanOrEqual(area.x)
    expect(recovered.y).toBeGreaterThanOrEqual(area.y)
    expect(recovered.x).toBeLessThan(nativeMoved.x)
    expect(recovered.y).toBeLessThan(nativeMoved.y)
    expect(recovered.x).toBeLessThan(area.x + area.width)
    expect(recovered.y).toBeLessThan(area.y + area.height)
    const toolbarNode = page.locator('[data-region="toolbar"]')
    const toolbar = (await toolbarNode.boundingBox())!
    expect(toolbar.y).toBe(
      await toolbarNode.evaluate((node) => node.closest('section')!.getBoundingClientRect().top),
    )
    expect(toolbar.y).toBeGreaterThanOrEqual(0)
    expect(toolbar.height).toBe(52)
    await writeFile(
      test.info().outputPath('native-window-restoration.json'),
      JSON.stringify(
        { before, restored, scaleFactor, pixelStepInIntegerDip, nativeMoved, recovered, area },
        null,
        2,
      ),
    )
    await page.screenshot({ path: test.info().outputPath('native-clamped-titlebar.png') })
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})
