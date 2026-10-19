import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { yukiFixture } from '../fixtures/backend'

test('uses the real paste/copy, send-key and close/reopen UI paths with isolated OS clipboard adapters', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('native-device')
  let success = false
  try {
    let page = await app.firstWindow()
    const bounds = await (await app.browserWindow(page)).evaluate((window) => window.getBounds())
    expect(bounds.width).toBe(720)
    expect(bounds.height).toBe(560)
    const code = await rig.code()
    await app.evaluate(({ clipboard }, code) => {
      clipboard.readText = () => code
      clipboard.writeText = (text) => {
        ;(globalThis as unknown as { copied: string }).copied = text
      }
    }, code)
    await page.getByRole('button', { name: '開始', exact: true }).click()
    await page.getByLabel('伺服器位址').fill(rig.base)
    await page.getByRole('button', { name: '繼續', exact: true }).click()
    await page.getByRole('button', { name: '貼上', exact: true }).click()
    await expect(page.getByLabel('綁定碼或完整回覆')).toHaveValue(code)
    await page.getByRole('button', { name: '配對', exact: true }).click()
    await page.getByRole('button', { name: '進入', exact: true }).click()
    const sample = 'const value = "<script>";\nconsole.log(value)\n'
    const composer = page.getByRole('textbox', { name: '和 Yuki 說點什麼' })
    await fetch(`${rig.base}/__test/model-delay/2`, { method: 'POST' })
    await composer.fill('```javascript\n' + sample + '```')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Yuki 正在處理', { exact: true })).toBeVisible()
    await expect(page.getByText('Yuki 正在處理', { exact: true })).toHaveCount(0, {
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
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,')
    await page.getByRole('tab', { name: '⌘ / Ctrl Enter', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await composer.fill('用選定的送出鍵送出')
    await composer.press('Enter')
    await expect(composer).toHaveValue('用選定的送出鍵送出\n')
    await composer.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(composer).toHaveValue('')
    const pid = app.process().pid,
      reopened = app.waitForEvent('window')
    await (await app.browserWindow(page)).evaluate((window) => window.close())
    await expect.poll(() => app.windows().length).toBe(0)
    const second = spawn(app.process().spawnfile, ['.'], {
      env: { ...process.env, YUKI_DESKTOP_DATA: join(rig.root, 'native-device') },
      stdio: 'ignore',
    })
    await new Promise<void>((resolve) => second.once('exit', () => resolve()))
    page = await reopened
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toBeVisible()
    expect(app.process().pid).toBe(pid)
    await expect(page.getByRole('button', { name: '複製程式碼', exact: true })).toBeVisible()
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
