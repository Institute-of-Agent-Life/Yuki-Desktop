import { expect, test } from '@playwright/test'

test('component keyboard, focus restoration and small sheets use real interactions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 492 })
  await page.goto('http://127.0.0.1:4178/components.html')
  const open = page.getByRole('button', { name: '開啟對話框', exact: true })
  await open.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const confirm = dialog.getByRole('button', { name: '確認', exact: true })
  await expect(confirm).toBeInViewport()
  await confirm.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('heading', { name: '驗證對話框' })).toBeVisible()
  await page.screenshot({
    animations: 'disabled',
    path: test.info().outputPath('sheet-960x492.png'),
  })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(open).toBeFocused()
  await page.getByRole('tab', { name: '深色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({
    animations: 'disabled',
    path: test.info().outputPath('components-dark.png'),
  })
})

test('actual column drags preserve center width at 1180', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 })
  await page.goto('http://127.0.0.1:4178/components.html')
  await page.getByRole('button', { name: '檢視器', exact: true }).click()
  const divider = page.getByRole('separator', { name: '調整檢視器' })
  const box = await divider.boundingBox()
  await page.mouse.move(box!.x + 4, box!.y + 100)
  await page.mouse.down()
  await page.mouse.move(350, box!.y + 100)
  await page.mouse.up()
  const center = page.locator('[data-region="content"]')
  expect((await center.boundingBox())!.width).toBeGreaterThanOrEqual(520)
  await page.screenshot({
    animations: 'disabled',
    path: test.info().outputPath('columns-1180.png'),
  })
})
