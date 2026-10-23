import { expect, type Page } from '@playwright/test'

export async function sidebar(page: Page) {
  const toggle = page.getByRole('button', { name: '側邊欄', exact: true })
  await expect(toggle).toBeVisible()
  const navigation = page.getByRole('navigation', { name: '主要導覽', exact: true })
  if (!(await navigation.isVisible())) await toggle.click()
  await expect(navigation).toBeVisible()
  return navigation
}

export async function navigate(page: Page, name: string | RegExp) {
  await (await sidebar(page)).getByRole('button', { name, exact: true }).click()
}
