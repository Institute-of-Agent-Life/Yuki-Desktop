import { activeCharacterName } from '../fixtures/active-character'
import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pairUI, yukiFixture } from '../fixtures/backend'

test('uses the real paste/copy, send-key and close/reopen UI paths with isolated OS clipboard adapters', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('native-device')
  const launcher = app.process()
  let firstStderr = ''
  launcher.stderr?.on('data', (chunk) => {
    firstStderr += chunk.toString()
  })
  let second: ReturnType<typeof spawn> | undefined
  let success = false
  try {
    let page = await app.firstWindow()
    const window = await app.browserWindow(page)
    await expect.poll(() => window.evaluate((window) => window.isVisible())).toBe(true)
    const bounds = await window.evaluate((window) => window.getBounds())
    const native = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const display = screen.getDisplayMatching(window.getBounds())
      return {
        outerBounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
        minimumSize: window.getMinimumSize(),
        visible: window.isVisible(),
        scaleFactor: display.scaleFactor,
        workArea: display.workArea,
      }
    })
    await writeFile(
      test.info().outputPath('native-initial-geometry.json'),
      JSON.stringify(
        {
          native,
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
    expect(bounds.width).toBe(720)
    expect(bounds.height).toBe(560)
    const code = await rig.code()
    await app.evaluate(({ clipboard }, code) => {
      clipboard.readText = () => code
      clipboard.writeText = (text) => {
        ;(globalThis as unknown as { copied: string }).copied = text
      }
    }, code)
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '手動輸入伺服器位址', exact: true }).click()
    await page.getByLabel('伺服器位址').fill(rig.base)
    await page.getByRole('button', { name: '貼上', exact: true }).click()
    await expect(page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })).toHaveValue(code)
    await pairUI(page, rig.base, code)
    const name = await activeCharacterName(page)
    const sample = 'const value = "<script>";\nconsole.log(value)\n'
    const composer = page.getByRole('textbox', {
      name: `和 ${name} 說點什麼`,
    })
    await fetch(`${rig.base}/__test/model-delay/2`, { method: 'POST' })
    await composer.fill('```javascript\n' + sample + '```')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText(`${name} 正在處理`, { exact: true })).toBeVisible()
    await expect(page.getByText(`${name} 正在處理`, { exact: true })).toHaveCount(0, {
      timeout: 10000,
    })
    const copy = page.getByRole('button', { name: '複製程式碼', exact: true })
    await copy.click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { copied: string }).copied))
      .toBe(sample)
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('conversation-code.png'),
    })
    await page.keyboard.press('ControlOrMeta+,')
    const platform = await page.evaluate(async () => (await globalThis.window.yuki.boot()).platform)
    await page
      .getByRole('radio', { name: platform === 'darwin' ? '⌘ Enter' : 'Ctrl Enter', exact: true })
      .click()
    const keepInTray = page.getByRole('switch', {
      name: `關閉視窗後保留在${platform === 'darwin' ? '選單列' : '系統匣'}`,
      exact: true,
    })
    await expect(keepInTray).toHaveAttribute('aria-checked', 'false')
    await keepInTray.click()
    await expect(keepInTray).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await composer.fill('用選定的送出鍵送出')
    await composer.press('Enter')
    await expect(composer).toHaveValue('用選定的送出鍵送出\n')
    await composer.press('ControlOrMeta+Enter')
    await expect(composer).toHaveValue('')
    const pid = app.process().pid,
      reopened = app.waitForEvent('window')
    const firstInstance = await app.evaluate(({ app, BrowserWindow }, log) => {
      const fs = process.getBuiltinModule('node:fs'),
        path = process.getBuiltinModule('node:path')
      const require = process
        .getBuiltinModule('node:module')
        .createRequire(path.join(app.getAppPath(), 'package.json'))
      const Database = require('better-sqlite3') as typeof import('better-sqlite3')
      const db = new Database(path.join(app.getPath('userData'), 'desktop.sqlite3'), {
        readonly: true,
      })
      const row = db.prepare("SELECT value FROM preferences WHERE key='appearance'").get() as {
        value: string
      }
      const keepInTray: boolean = JSON.parse(row.value).keepInTray
      db.close()
      const first = {
        pid: process.pid,
        name: app.getName(),
        userData: app.getPath('userData'),
        executable: process.execPath,
        argv: process.argv,
        keepInTray,
      }
      const observe = (stage: string, details: object = {}) =>
        fs.appendFileSync(
          log,
          JSON.stringify({
            ...first,
            stage,
            ...details,
            windows: BrowserWindow.getAllWindows().map((window) => ({
              id: window.id,
              destroyed: window.isDestroyed(),
              visible: window.isVisible(),
              bounds: window.getBounds(),
            })),
          }) + '\n',
        )
      app.prependListener('second-instance', (_event, argv, workingDirectory) =>
        observe('second-instance', { argv, workingDirectory }),
      )
      app.prependListener('browser-window-created', (_event, window) => {
        observe('browser-window-created', { id: window.id })
        window.once('closed', () => observe('browser-window-closed', { id: window.id }))
      })
      app.prependListener('window-all-closed', () => observe('window-all-closed'))
      process.prependListener('uncaughtExceptionMonitor', (error) =>
        observe('uncaught-exception', { message: error.message, stack: error.stack }),
      )
      for (const window of BrowserWindow.getAllWindows())
        window.once('closed', () => observe('browser-window-closed', { id: window.id }))
      observe('before-close')
      return first
    }, test.info().outputPath('native-instance-events.jsonl'))
    expect(firstInstance.keepInTray).toBe(true)
    await (await app.browserWindow(page)).evaluate((window) => window.close())
    await expect.poll(() => app.windows().length).toBe(0)
    second = spawn(
      firstInstance.executable,
      process.env.YUKI_DESKTOP_EXECUTABLE ? [] : [rig.entry],
      {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE'),
          ),
          YUKI_DESKTOP_DATA: join(rig.root, 'native-device'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = '',
      stderr = ''
    second.stdout!.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    second.stderr!.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    const secondExit = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => second!.once('close', (code, signal) => resolve({ code, signal })),
    )
    await writeFile(
      test.info().outputPath('native-second-instance.json'),
      JSON.stringify(
        {
          firstInstance,
          launcher: {
            pid: launcher.pid,
            spawnfile: launcher.spawnfile,
            spawnargs: launcher.spawnargs,
          },
          entry: rig.entry,
          secondPid: second.pid,
          secondExit,
          stdout,
          stderr,
        },
        null,
        2,
      ),
    )
    page = await reopened
    await expect(
      page.getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` }),
    ).toBeVisible()
    expect(app.process().pid).toBe(pid)
    expect(await app.evaluate(() => process.pid)).toBe(firstInstance.pid)
    await expect(page.getByRole('button', { name: '複製程式碼', exact: true })).toBeVisible()
    success = true
  } finally {
    await writeFile(
      test.info().outputPath('native-instance-final.json'),
      JSON.stringify(
        {
          launcher: {
            pid: launcher.pid,
            spawnfile: launcher.spawnfile,
            spawnargs: launcher.spawnargs,
            exitCode: launcher.exitCode,
            signal: launcher.signalCode,
          },
          second: second && {
            pid: second.pid,
            exitCode: second.exitCode,
            signal: second.signalCode,
          },
          firstStderr,
        },
        null,
        2,
      ),
    )
    if (second && second.exitCode === null && second.signalCode === null) {
      const exited = new Promise<void>((resolve) => second!.once('close', () => resolve()))
      second.kill('SIGKILL')
      await exited
    }
    await app.close()
    await rig.close(success)
  }
})
