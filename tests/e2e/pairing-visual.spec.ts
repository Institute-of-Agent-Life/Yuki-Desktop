import { expect, test } from '@playwright/test'
import { yukiFixture } from '../fixtures/backend'
import { captureViewport, captureWorkspace, contentSize } from '../fixtures/visual'

test('first-use artwork, pairing geometry and keyboard flow remain visible at native and short sizes', async () => {
  test.setTimeout(150000)
  const rig = await yukiFixture()
  const app = await rig.launch('pairing-visual')
  let success = false
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '開始', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '開始', exact: true })).toHaveCSS(
      'height',
      '36px',
    )
    const bounds = await (await app.browserWindow(page)).evaluate((window) => window.getBounds())
    expect([bounds.width, bounds.height]).toEqual([720, 560])
    await page.screenshot({ path: test.info().outputPath('native-onboarding-welcome-720x560.png') })
    const artwork = page.locator('svg.lucide-snowflake')
    await expect(artwork).toBeVisible()
    await expect(artwork).toHaveCSS('width', '160px')
    await expect(artwork).toHaveCSS('height', '160px')
    await expect(artwork).toBeInViewport({ ratio: 1 })
    const progress = page.getByRole('list', { name: '配對進度', exact: true })
    await expect(progress.locator('[aria-current="step"]')).toHaveAttribute('aria-label', '歡迎')
    const code = await rig.code()
    const reply = `綁定碼：${code}（10 分鐘內有效，只能使用一次）`
    const prepare = async () => {
      const start = page.getByRole('button', { name: '開始', exact: true })
      if (await start.isVisible()) await start.click()
      const server = page.getByLabel('伺服器位址', { exact: true })
      if (await server.isVisible()) {
        await server.fill(rig.base)
        await expect(page.getByRole('button', { name: '繼續', exact: true })).toHaveCSS(
          'height',
          '36px',
        )
        await page.getByRole('button', { name: '繼續', exact: true }).click()
      }
      await expect(page.getByLabel('綁定碼或完整回覆')).toBeVisible()
      await page.getByLabel('綁定碼或完整回覆').fill('A'.repeat(64))
      await expect(page.getByRole('button', { name: '配對', exact: true })).toBeDisabled()
      await page.getByLabel('綁定碼或完整回覆').fill(reply)
      await expect(
        page.getByText(`已辨識：${code.slice(0, 6)}…${code.slice(-4)}（32 字元）`, { exact: true }),
      ).toBeVisible()
      await expect(page.getByRole('button', { name: '配對', exact: true })).toBeEnabled()
    }
    await prepare()
    await captureWorkspace(app, page, 'state-onboarding-code', prepare, {
      verify: async () => {
        const input = page.getByLabel('綁定碼或完整回覆')
        await expect(input).toHaveCSS('height', '36px')
        await expect(input).toHaveCSS('font-size', '14px')
        await expect(page.getByRole('button', { name: '貼上', exact: true })).toHaveCSS(
          'height',
          '36px',
        )
        await expect(progress.locator('[aria-current="step"]')).toHaveAttribute(
          'aria-label',
          '綁定碼',
        )
        await expect(page.getByLabel('裝置名稱')).toHaveCSS('height', '36px')
        await input.press('Tab')
        await expect(page.getByRole('button', { name: '貼上', exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(page.getByLabel('裝置名稱')).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(page.getByRole('button', { name: '返回', exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        const pair = page.getByRole('button', { name: '配對', exact: true })
        await expect(pair).toBeFocused()
        await expect(pair).toHaveCSS('height', '36px')
        await expect(pair).toBeInViewport({ ratio: 1 })
      },
    })
    await contentSize(app, page, 720, 560)
    await prepare()
    await captureViewport(app, page, test.info().outputPath('native-onboarding-code-720x560.png'))
    await page.getByRole('button', { name: '配對', exact: true }).press('Enter')
    await expect(page.getByRole('button', { name: '進入', exact: true })).toBeVisible({
      timeout: 20000,
    })
    await expect(page.getByRole('button', { name: '進入', exact: true })).toHaveCSS(
      'height',
      '36px',
    )
    await expect(progress.locator('[aria-current="step"]')).toHaveAttribute('aria-label', '認識你')
    await page.getByRole('button', { name: '進入', exact: true }).press('Enter')
    await expect(page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })).toBeVisible()
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
