import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pairUI } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { launchShell } from '../fixtures/shell-app'
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

async function nativeWindow(app: ElectronApplication, page: Page) {
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()))
    .toBe(true)
  const native = await app.evaluate(({ app, BrowserWindow, screen }, log) => {
    const fs = process.getBuiltinModule('node:fs')
    const record = (stage: string) =>
      fs.appendFileSync(log, JSON.stringify({ stage, pid: process.pid, time: Date.now() }) + '\n')
    record('entered')
    const window = BrowserWindow.getAllWindows()[0]!
    const bounds = window.getBounds()
    record('bounds')
    const contentBounds = window.getContentBounds()
    record('content')
    const display = screen.getDisplayMatching(bounds)
    record('display')
    const metrics = app.getAppMetrics()
    record('metrics')
    return {
      pid: process.pid,
      browserPid: metrics.find((item) => item.type === 'Browser')?.pid,
      executable: app.getPath('exe'),
      profile: app.getPath('userData'),
      platform: process.platform,
      packaged: app.isPackaged,
      bounds,
      contentBounds,
      contentSize: window.getContentSize(),
      displayId: display.id,
      area: display.workArea,
      scaleFactor: display.scaleFactor,
      sandboxed: metrics.find((item) => item.pid === window.webContents.getOSProcessId())
        ?.sandboxed,
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      visible: window.isVisible(),
      maximized: window.isMaximized(),
    }
  }, test.info().outputPath('native-observations.jsonl'))
  expect(native).toMatchObject({
    browserPid: native.pid,
    executable: process.env.YUKI_ELECTRON_EXECUTABLE,
    platform: 'win32',
    packaged: true,
    sandboxed: true,
    noSandbox: false,
    visible: true,
    maximized: false,
  })
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
  }))
  expect(viewport.width).toBe(native.contentBounds.width)
  expect(viewport.height).toBe(native.contentBounds.height)
  expect(viewport.dpr).toBe(native.scaleFactor)
  return { ...native, viewport, saved: await savedBounds(app) }
}

test('Windows native workspace restores persisted frame and content bounds across two cold crashes', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires a fresh isolated reference server')
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  test.setTimeout(90000)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-window-geometry-'))
  let app = await launchShell(data)
  let pid: number | undefined = await app.evaluate(() => process.pid)
  let page!: Page
  const proof: Record<string, unknown> = { data, stages: [] }
  const stages = proof.stages as unknown[]
  const save = () =>
    writeFile(
      test.info().outputPath('windows-window-geometry.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    const pairing = await nativeWindow(app, page)
    stages.push({ stage: 'fresh-pairing', ...pairing })
    await save()
    const response = await fetch(base + '/__test/link-code', { method: 'POST' })
    expect(response.ok).toBe(true)
    const { code } = (await response.json()) as { code: string }
    await pairUI(page, base!, code, 'Windows 視窗恢復', 20000)
    const name = await activeCharacterName(page)
    const composer = () => page.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
    await expect(composer()).toBeVisible()
    expect(await contentSize(app, page, 1100, 760)).toBe('native-window')
    await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const bounds = window.getBounds()
      const area = screen.getDisplayMatching(bounds).workArea
      window.setPosition(
        Math.round(area.x + (area.width - bounds.width) / 2),
        Math.round(area.y + (area.height - bounds.height) / 2),
      )
    })
    const before = await nativeWindow(app, page)
    // Read the actual durable receipt before killing the main process. No close handler can save it.
    await expect.poll(() => savedBounds(app)).toEqual(before.bounds)
    stages.push({ stage: 'persisted-before-crash', ...before, saved: await savedBounds(app) })
    await save()
    for (let cold = 1; cold <= 2; cold++) {
      const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
      expect(process.kill(pid!, 'SIGKILL')).toBe(true)
      pid = undefined
      await exited
      await app.close()
      app = await launchShell(data)
      pid = await app.evaluate(() => process.pid)
      page = await app.firstWindow()
      await expect(composer()).toBeVisible()
      const restored = await nativeWindow(app, page)
      stages.push({ stage: `cold-${cold}`, ...restored })
      await save()
      await page.screenshot({ path: test.info().outputPath(`windows-restored-${cold}.png`) })
      expect(restored.profile).toBe(before.profile)
      expect(restored.bounds).toEqual(before.bounds)
      expect(restored.contentBounds).toEqual(before.contentBounds)
      expect(restored.viewport).toEqual(before.viewport)
      await expect.poll(() => savedBounds(app)).toEqual(before.bounds)
      const toolbar = (await page.locator('[data-region="toolbar"]').boundingBox())!
      expect(toolbar.y).toBe(0)
      expect(toolbar.height).toBe(52)
    }
    // SetPosition itself resubmits size through Electron's native projection.
    // Save its actual returned rectangle, then test that App does not grow it.
    const outside = {
      x: before.area.x + before.area.width - before.bounds.width + 80,
      y: before.area.y + before.area.height - before.bounds.height + 80,
    }
    await app.evaluate(
      ({ BrowserWindow }, point) => BrowserWindow.getAllWindows()[0]!.setPosition(point.x, point.y),
      outside,
    )
    const offscreen = await nativeWindow(app, page)
    expect(offscreen.displayId).toBe(before.displayId)
    expect(offscreen.bounds).toMatchObject(outside)
    expect(offscreen.bounds.x + offscreen.bounds.width).toBeGreaterThan(
      before.area.x + before.area.width,
    )
    expect(offscreen.bounds.y + offscreen.bounds.height).toBeGreaterThan(
      before.area.y + before.area.height,
    )
    await expect.poll(() => savedBounds(app)).toEqual(offscreen.bounds)
    const persistedOffscreen = await nativeWindow(app, page)
    expect(persistedOffscreen.bounds).toEqual(offscreen.bounds)
    expect(persistedOffscreen.contentBounds).toEqual(offscreen.contentBounds)
    expect(persistedOffscreen.contentSize).toEqual(offscreen.contentSize)
    expect(persistedOffscreen.viewport).toEqual(offscreen.viewport)
    stages.push({
      stage: 'offscreen-persisted-before-crash',
      requested: outside,
      ...persistedOffscreen,
      original: offscreen,
      saved: await savedBounds(app),
    })
    await save()
    const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
    expect(process.kill(pid!, 'SIGKILL')).toBe(true)
    pid = undefined
    await exited
    await app.close()
    app = await launchShell(data)
    pid = await app.evaluate(() => process.pid)
    page = await app.firstWindow()
    await expect(composer()).toBeVisible()
    const clamped = await nativeWindow(app, page)
    const expected = {
      ...offscreen.bounds,
      x: before.area.x + before.area.width - offscreen.bounds.width,
      y: before.area.y + before.area.height - offscreen.bounds.height,
    }
    stages.push({ stage: 'cold-clamped-at-work-area-edge', ...clamped, expected })
    await save()
    expect(clamped.profile).toBe(before.profile)
    expect(clamped.displayId).toBe(before.displayId)
    expect(clamped.bounds).toEqual(expected)
    expect(clamped.contentBounds).toEqual({
      ...offscreen.contentBounds,
      x: offscreen.contentBounds.x + expected.x - offscreen.bounds.x,
      y: offscreen.contentBounds.y + expected.y - offscreen.bounds.y,
    })
    expect(clamped.contentSize).toEqual(offscreen.contentSize)
    expect(clamped.viewport).toEqual(offscreen.viewport)
    await expect.poll(() => savedBounds(app)).toEqual(expected)
    const titlebar = page.locator('[data-region="toolbar"]')
    await expect(titlebar).toBeInViewport({ ratio: 1 })
    const toolbar = (await titlebar.boundingBox())!
    expect(toolbar.y).toBe(0)
    expect(toolbar.height).toBe(52)
    expect(clamped.contentBounds.y + toolbar.y).toBeGreaterThanOrEqual(before.area.y)
    expect(clamped.contentBounds.y + toolbar.y + toolbar.height).toBeLessThanOrEqual(
      before.area.y + before.area.height,
    )
    await page.screenshot({ path: test.info().outputPath('windows-clamped-titlebar.png') })
    proof.complete = true
  } catch (error) {
    proof.error = String(error)
    if (page && !page.isClosed()) {
      await page
        .screenshot({ path: test.info().outputPath('windows-window-failure.png'), timeout: 3000 })
        .catch(() => {})
      proof.failureView = await page
        .locator('body')
        .innerText({ timeout: 3000 })
        .catch(() => null)
    }
    throw error
  } finally {
    await save()
    if (pid) {
      // Cleanup must also work if the main inspector or native window stops responding.
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
    }
    await app.close().catch(() => {})
  }
})
