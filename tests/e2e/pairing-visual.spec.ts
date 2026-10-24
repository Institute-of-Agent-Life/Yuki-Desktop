import { expect, test } from '@playwright/test'
import { yukiFixture } from '../fixtures/backend'
import { captureViewport, captureWorkspace, contentSize } from '../fixtures/visual'
import { sidebar } from '../fixtures/navigation'

test('first use opens an unconfigured workspace and later pairing remains reachable at short sizes', async () => {
  test.setTimeout(180000)
  const rig = await yukiFixture()
  const app = await rig.launch('pairing-visual')
  let success = false
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(true)
    await contentSize(app, page, 960, 720)
    for (const name of ['連接已有 Yuki', '在本機部署 Yuki']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
    }
    const navigation = await sidebar(page)
    for (const name of ['對話', '工作', '設定'])
      await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-region="toolbar"]')).toBeVisible()
    await expect(page.getByRole('button', { name: '先逛逛，稍後設定', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => window.yuki.client.connections())).toEqual({
      ok: true,
      value: [],
    })
    await expect(page.locator('[data-character-session]')).toHaveCount(0)
    await captureViewport(app, page, test.info().outputPath('first-use-unconfigured-workspace.png'))
    await expect(page.getByLabel('伺服器位址', { exact: true })).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('tab', { name: '外觀', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toHaveCount(0)
    await expect(page.locator('[data-region="toolbar"]')).toBeVisible()
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()

    const code = await rig.code()
    const link = `yuki://pair?server=${encodeURIComponent(rig.base)}&code=${code}`
    const input = page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
    await expect(page.getByLabel('伺服器位址', { exact: true })).toHaveCount(0)
    const prepare = async () => {
      await expect(input).toBeVisible()
      const confirm = page.getByRole('button', { name: '確認並連接', exact: true })
      if (!(await confirm.isVisible())) {
        await input.fill(link)
        await page.getByRole('button', { name: '繼續', exact: true }).click()
      }
      await expect(confirm).toBeVisible()
      await expect(page.getByText(`伺服器：${rig.base}`, { exact: true })).toBeVisible()
    }
    await prepare()
    await input.fill('A'.repeat(64))
    await expect(page.getByRole('button', { name: '確認並連接', exact: true })).toBeDisabled()
    await input.fill(link)
    await captureWorkspace(app, page, 'pairing-confirmation', prepare, {
      verify: async () => {
        await input.scrollIntoViewIfNeeded()
        await expect(input).toBeInViewport({ ratio: 1 })
        await input.focus()
        await page.keyboard.press('Tab')
        await expect(page.getByRole('button', { name: '貼上', exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(page.getByLabel('這台裝置的名稱', { exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(page.getByRole('button', { name: '返回', exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        const confirm = page.getByRole('button', { name: '確認並連接', exact: true })
        await expect(confirm).toBeFocused()
        await expect(confirm).toBeEnabled()
        await expect(confirm).toBeInViewport({ ratio: 1 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      },
    })
    await contentSize(app, page, 960, 720)
    await prepare()
    await page.getByRole('button', { name: '確認並連接', exact: true }).press('Enter')
    await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible({
      timeout: 30000,
    })
    await expect
      .poll(() => page.evaluate(() => window.yuki.client.connections()))
      .toMatchObject({ ok: true, value: [{ baseUrl: rig.base }] })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
