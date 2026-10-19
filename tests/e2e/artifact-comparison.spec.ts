import { expect, test } from '@playwright/test'

test('compares actual edited bytes in a worker and discards a replaced comparison', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/artifacts.html')
  await page.getByRole('button', { name: '比較原文字', exact: true }).click()
  const original = page.getByRole('region', { name: '目前成果原版本' }),
    comparison = page.getByRole('region', { name: '比較的原版本' })
  await expect(original.locator('pre').filter({ hasText: /^old$/ })).toBeVisible()
  await expect(comparison.locator('pre').filter({ hasText: /^new$/ })).toBeVisible()
  await expect(comparison.locator('pre').filter({ hasText: /^extra$/ })).toBeVisible()
  await expect(original.locator('pre').filter({ hasText: /^new$/ })).toHaveCount(0)
  await page.getByRole('textbox', { name: '原版本', exact: true }).fill('previous\n'.repeat(1000))
  await page.getByRole('textbox', { name: '比較版本', exact: true }).fill('replaced\n'.repeat(1000))
  await page.getByRole('button', { name: '比較原文字', exact: true }).click()
  await page.getByRole('textbox', { name: '原版本', exact: true }).fill('final original\n')
  await page.getByRole('textbox', { name: '比較版本', exact: true }).fill('final comparison\n')
  await page.getByRole('button', { name: '比較原文字', exact: true }).click()
  await expect(original.locator('pre')).toHaveText(['final original'])
  await expect(comparison.locator('pre')).toHaveText(['final comparison'])
  await page.screenshot({ path: test.info().outputPath('artifact-comparison.png') })
})
