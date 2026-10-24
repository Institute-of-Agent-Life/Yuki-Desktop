import { activeCharacterName } from '../fixtures/active-character'
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
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toHaveCSS(
      'height',
      '36px',
    )
    const window = await app.browserWindow(page)
    await expect.poll(() => window.evaluate((window) => window.isVisible())).toBe(true)
    const bounds = await window.evaluate((window) => window.getBounds())
    expect([bounds.width, bounds.height]).toEqual([720, 560])
    await page.screenshot({ path: test.info().outputPath('native-unconfigured-workspace-720x560.png') })
    const entry = page.getByRole('region', { name: '你的 Yuki 工作區', exact: true })
    await expect(entry).toBeVisible()
    const artwork = entry.locator('svg.lucide-message-circle')
    await expect(artwork).toBeVisible()
    await expect(artwork).toHaveCSS('width', '40px')
    await expect(artwork).toHaveCSS('height', '40px')
    await expect(artwork).toBeInViewport({ ratio: 1 })
    await expect(page.getByRole('button', { name: '在本機部署 Yuki', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '使用說明', exact: true })).toBeVisible()
    await expect(page.getByLabel('伺服器位址', { exact: true })).toHaveCount(0)
    const code = await rig.code()
    const reply = `綁定碼：${code}（10 分鐘內有效，只能使用一次）`
    const prepare = async () => {
      const start = page.getByRole('button', { name: '連接已有 Yuki', exact: true })
      if (await start.isVisible()) await start.click()
      const manual = page.getByRole('button', { name: '手動輸入伺服器位址', exact: true })
      if (await manual.isVisible()) await manual.click()
      const server = page.getByLabel('伺服器位址', { exact: true })
      const input = page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
      if (await server.isVisible()) {
        await server.fill(rig.base)
        await input.fill(reply)
        await expect(page.getByRole('button', { name: '繼續', exact: true })).toHaveCSS(
          'height',
          '28px',
        )
        await page.getByRole('button', { name: '繼續', exact: true }).click()
      }
      const confirm = page.getByRole('button', { name: '確認並連接', exact: true })
      await expect(confirm).toBeVisible()
      await input.fill('A'.repeat(64))
      await expect(confirm).toBeDisabled()
      await input.fill(reply)
      await expect(page.getByText(`伺服器：${rig.base}`, { exact: true })).toBeVisible()
      await expect(confirm).toBeEnabled()
    }
    await prepare()
    await captureWorkspace(app, page, 'state-onboarding-code', prepare, {
      verify: async () => {
        const input = page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
        await expect(input).toHaveCSS('height', '36px')
        await expect(input).toHaveCSS('font-size', '14px')
        await expect(page.getByRole('button', { name: '貼上', exact: true })).toHaveCSS(
          'height',
          '28px',
        )
        await expect(page.getByLabel('這台裝置的名稱')).toHaveCSS('height', '36px')
        await input.press('Tab')
        await expect(page.getByRole('button', { name: '貼上', exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(page.getByLabel('這台裝置的名稱')).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(page.getByRole('button', { name: '返回', exact: true })).toBeFocused()
        await page.keyboard.press('Tab')
        const pair = page.getByRole('button', { name: '確認並連接', exact: true })
        await expect(pair).toBeFocused()
        await expect(pair).toHaveCSS('height', '28px')
        await expect(pair).toBeInViewport({ ratio: 1 })
      },
    })
    await contentSize(app, page, 720, 560)
    await prepare()
    await captureViewport(app, page, test.info().outputPath('native-onboarding-code-720x560.png'))
    await page.getByRole('button', { name: '確認並連接', exact: true }).press('Enter')
    await expect(
      page.getByRole('textbox', {
        name: `和 ${await activeCharacterName(page)} 說點什麼`,
        exact: true,
      }),
    ).toBeVisible()
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
