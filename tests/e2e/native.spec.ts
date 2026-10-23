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
    const code = `yuki://pair?${new URLSearchParams({ server: rig.base, code: await rig.code() })}`
    await app.evaluate(({ clipboard }, code) => {
      clipboard.readText = () => code
      clipboard.writeText = (text) => {
        ;(globalThis as unknown as { copied: string }).copied = text
      }
    }, code)
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '貼上', exact: true }).click()
    await expect(
      page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true }).filter({ visible: true }),
    ).toHaveValue(code)
    await expect(page.getByText(`伺服器：${rig.base}`, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '確認並連接', exact: true }).click()
    const sample = 'const value = "<script>";\nconsole.log(value)\n'
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await composer.fill('```javascript\n' + sample + '```')
    await page.getByRole('button', { name: '送出', exact: true }).click()
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
    await page.getByRole('switch', { name: '關閉視窗時保持在選單列', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await composer.fill('用選定的送出鍵送出')
    await composer.press('Enter')
    await expect(composer).toHaveValue('用選定的送出鍵送出\n')
    await composer.press('ControlOrMeta+Enter')
    await expect(composer).toHaveValue('')
    const pid = await app.evaluate(() => process.pid),
      executable = await app.evaluate(() => process.execPath),
      reopened = app.waitForEvent('window')
    await (await app.browserWindow(page)).evaluate((window) => window.close())
    await expect.poll(() => app.windows().length).toBe(0)
    const second = spawn(executable, [rig.entry], {
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE'),
        ),
        YUKI_DESKTOP_DATA: join(rig.root, 'native-device'),
      },
      stdio: 'ignore',
      windowsHide: true,
    })
    await new Promise<void>((resolve) => second.once('exit', () => resolve()))
    page = await reopened
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
    expect(await app.evaluate(() => process.pid)).toBe(pid)
    await expect(page.getByRole('button', { name: '複製程式碼', exact: true })).toBeVisible()
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
