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
      JSON.stringify({ native, viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })) }, null, 2),
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
    await page.getByRole('radio', { name: '⌘ / Ctrl Enter', exact: true }).click()
    const keepInTray = page.getByRole('switch', { name: '關閉視窗時保持在選單列', exact: true })
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
    await (await app.browserWindow(page)).evaluate((window) => window.close())
    await expect.poll(() => app.windows().length).toBe(0)
    const second = spawn(app.process().spawnfile, process.env.YUKI_DESKTOP_EXECUTABLE ? [] : [rig.entry], {
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE'),
        ),
        YUKI_DESKTOP_DATA: join(rig.root, 'native-device'),
      },
      stdio: 'ignore',
    })
    await new Promise<void>((resolve) => second.once('exit', () => resolve()))
    page = await reopened
    await expect(
      page.getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` }),
    ).toBeVisible()
    expect(app.process().pid).toBe(pid)
    await expect(page.getByRole('button', { name: '複製程式碼', exact: true })).toBeVisible()
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
