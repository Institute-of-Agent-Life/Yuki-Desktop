import { expect, test } from '@playwright/test'

test('connector settings pair independently and report actual service controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 650 })
  await page.goto('http://127.0.0.1:4178/components.html?connector=unpaired')
  const code = page.getByLabel('Agent 電腦授權碼', { exact: true })
  await expect(page.getByRole('textbox', { name: 'Agent 伺服器位址' })).toHaveValue(
    'https://yuki.example',
  )
  await expect(code).toHaveAttribute('type', 'password')
  await code.fill('one-time-private-code')
  await page.getByRole('button', { name: '配對這台電腦' }).click()
  await expect(page.getByText('已配對', { exact: true })).toBeVisible()
  await expect(code).toHaveCount(0)
  await page.getByRole('button', { name: '啟動', exact: true }).click()
  await expect(page.getByText('執行中', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(page.getByText('已停止', { exact: true })).toBeVisible()
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: test.info().outputPath('connector-720.png') })
})
