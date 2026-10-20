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

test('native move events persist before an App crash and clamp an offscreen titlebar after movement settles', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture()
  let app = await rig.launch('native-window-moves'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
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
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    app = await rig.launch('native-window-moves')
    page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toBeVisible()
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds()),
    ).toEqual(before)
    await app.evaluate(
      ({ BrowserWindow }, area) =>
        BrowserWindow.getAllWindows()[0]!.setPosition(
          area.x + area.width - 100,
          area.y + area.height - 100,
        ),
      area,
    )
    const expected = {
      ...before,
      x: area.x + area.width - before.width,
      y: area.y + area.height - before.height,
    }
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds()),
      )
      .toEqual(expected)
    await expect.poll(() => savedBounds(app)).toEqual(expected)
    const toolbar = (await page.locator('[data-region="toolbar"]').boundingBox())!
    expect(toolbar.y).toBe(0)
    expect(toolbar.height).toBe(52)
    await writeFile(
      test.info().outputPath('native-window-restoration.json'),
      JSON.stringify({ before, restored: before, after: expected, area }, null, 2),
    )
    await page.screenshot({ path: test.info().outputPath('native-clamped-titlebar.png') })
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})
