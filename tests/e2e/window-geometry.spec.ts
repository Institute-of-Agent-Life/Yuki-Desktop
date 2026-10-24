import { activeCharacterName } from '../fixtures/active-character'
import { crashElectron } from '../fixtures/electron-process'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchShell } from '../fixtures/shell-app'
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

async function nativeWindow(app: ElectronApplication) {
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()))
    .toBe(true)
  return app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    const display = screen.getDisplayMatching(window.getBounds())
    return {
      bounds: window.getBounds(),
      contentBounds: window.getContentBounds(),
      contentSize: window.getContentSize(),
      minimum: window.getMinimumSize(),
      displayId: display.id,
      scaleFactor: display.scaleFactor,
      workArea: display.workArea,
      visible: window.isVisible(),
    }
  })
}

test('native moves persist before an App crash and an offscreen window clamps on cold reopening', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture()
  let app = await launchShell(
      join(rig.root, 'native-window-moves'),
      process.env.YUKI_DESKTOP_EXECUTABLE,
    ),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const security = await app.evaluate(({ app, BrowserWindow }) => {
      const renderer = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId()
      return {
        platform: process.platform,
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
    if (security.platform === 'linux') expect(security.linuxSeccomp).toBe('2')
    else expect(security.sandboxed).toBe(true)
    const display = await app.evaluate(({ BrowserWindow, screen }) => {
      const display = screen.getDisplayMatching(BrowserWindow.getAllWindows()[0]!.getBounds())
      return { id: display.id, workArea: display.workArea }
    })
    const area = display.workArea
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
    const beforeState = await nativeWindow(app)
    const before = beforeState.bounds
    expect(before).toMatchObject(point)
    // Observe the actual persisted receipt before SIGKILL; no close event can save it for us.
    await expect.poll(() => savedBounds(app)).toEqual(before)
    await crashElectron(app)
    await app.close().catch(() => {})
    app = await launchShell(
      join(rig.root, 'native-window-moves'),
      process.env.YUKI_DESKTOP_EXECUTABLE,
    )
    page = await app.firstWindow()
    await expect(
      page.getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` }),
    ).toBeVisible()
    const restored = await nativeWindow(app)
    await writeFile(
      test.info().outputPath('native-cold-geometry.json'),
      JSON.stringify({ before: beforeState, restored }, null, 2),
    )
    expect(restored.bounds).toEqual(before)
    expect(restored.contentBounds).toEqual(beforeState.contentBounds)
    expect(restored.contentSize).toEqual(beforeState.contentSize)
    // This programmatic move can itself project the size through Electron's
    // SetPosition -> SetBounds. Its returned native rectangle is the receipt.
    const outside = {
      x: area.x + area.width - before.width + 100,
      y: area.y + area.height - before.height + 100,
    }
    await app.evaluate(
      ({ BrowserWindow }, point) => BrowserWindow.getAllWindows()[0]!.setPosition(point.x, point.y),
      outside,
    )
    const offscreen = await nativeWindow(app)
    expect(offscreen.displayId).toBe(display.id)
    expect(offscreen.bounds).toMatchObject(outside)
    expect(offscreen.bounds.x + offscreen.bounds.width).toBeGreaterThan(area.x + area.width)
    expect(offscreen.bounds.y + offscreen.bounds.height).toBeGreaterThan(area.y + area.height)
    await expect.poll(() => savedBounds(app)).toEqual(offscreen.bounds)
    const persistedOffscreen = await nativeWindow(app)
    expect(persistedOffscreen.bounds).toEqual(offscreen.bounds)
    expect(persistedOffscreen.contentBounds).toEqual(offscreen.contentBounds)
    expect(persistedOffscreen.contentSize).toEqual(offscreen.contentSize)
    await writeFile(
      test.info().outputPath('native-offscreen-before-crash.json'),
      JSON.stringify(
        { requested: outside, offscreen, persistedOffscreen, saved: await savedBounds(app) },
        null,
        2,
      ),
    )
    await crashElectron(app)
    await app.close().catch(() => {})
    app = await launchShell(
      join(rig.root, 'native-window-moves'),
      process.env.YUKI_DESKTOP_EXECUTABLE,
    )
    page = await app.firstWindow()
    await expect(
      page.getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` }),
    ).toBeVisible()
    const clamped = await nativeWindow(app)
    const expected = {
      ...offscreen.bounds,
      x: area.x + area.width - offscreen.bounds.width,
      y: area.y + area.height - offscreen.bounds.height,
    }
    await writeFile(
      test.info().outputPath('native-window-restoration.json'),
      JSON.stringify(
        { before: beforeState, restored, offscreen, persistedOffscreen, clamped, expected, area },
        null,
        2,
      ),
    )
    expect(clamped.displayId).toBe(display.id)
    if (security.platform === 'win32') {
      // Issue #5 retains the strict Windows outer-frame precision probe.
      // This functional case checks the actual content and reachable controls.
      expect(clamped.bounds).toMatchObject({ x: expected.x, y: expected.y })
    } else {
      expect(clamped.bounds).toEqual(expected)
      expect(clamped.contentBounds).toEqual({
        ...offscreen.contentBounds,
        x: offscreen.contentBounds.x + expected.x - offscreen.bounds.x,
        y: offscreen.contentBounds.y + expected.y - offscreen.bounds.y,
      })
      expect(clamped.contentSize).toEqual(offscreen.contentSize)
    }
    expect(clamped.contentBounds.x).toBeGreaterThanOrEqual(area.x)
    expect(clamped.contentBounds.y).toBeGreaterThanOrEqual(area.y)
    expect(clamped.contentBounds.x + clamped.contentBounds.width).toBeLessThanOrEqual(
      area.x + area.width,
    )
    expect(clamped.contentBounds.y + clamped.contentBounds.height).toBeLessThanOrEqual(
      area.y + area.height,
    )
    await expect.poll(() => savedBounds(app)).toEqual(clamped.bounds)
    const titlebar = page.locator('[data-region="toolbar"]')
    await expect(titlebar).toBeInViewport({ ratio: 1 })
    const toolbar = (await titlebar.boundingBox())!
    expect(toolbar.y).toBe((await titlebar.locator('..').boundingBox())!.y)
    expect(toolbar.height).toBe(52)
    expect(clamped.contentBounds.x + toolbar.x).toBeGreaterThanOrEqual(area.x)
    expect(clamped.contentBounds.x + toolbar.x + toolbar.width).toBeLessThanOrEqual(
      area.x + area.width,
    )
    expect(clamped.contentBounds.y + toolbar.y).toBeGreaterThanOrEqual(area.y)
    expect(clamped.contentBounds.y + toolbar.y + toolbar.height).toBeLessThanOrEqual(
      area.y + area.height,
    )
    await page.screenshot({ path: test.info().outputPath('native-clamped-titlebar.png') })
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})
