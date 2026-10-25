import { expect, test } from '@playwright/test'

test('a real help flag exposes the computer action without treating every terminal step as computer work', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=work-help&help=false')
  await expect(page.getByText('Original terminal step', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '在電腦上查看', exact: true })).toHaveCount(0)
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=work-help&help=true')
  await expect(page.getByText('Original terminal step', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '在電腦上查看', exact: true }).click()
  await expect(page.getByTestId('computer-open-count')).toHaveText('1')
})
