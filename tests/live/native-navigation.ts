import type { Page } from '@playwright/test'
import { navigate } from '../fixtures/navigation'

export async function agents(page: Page) {
  await navigate(page, '設定')
  await page.getByRole('tab', { name: '本機 Agent', exact: true }).click()
}
