import { expect, test } from '@playwright/test'
import { expectContainedText } from '../fixtures/contained-text'

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

test('sheet status contains long text while the workspace banner stays 32px and actions remain reachable', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/components.html')
  for (const [width, height] of [
    [1100, 760],
    [960, 492],
  ] as const) {
    await page.setViewportSize({ width, height })
    for (const theme of ['淺色', '深色']) {
      await page.getByRole('tab', { name: theme, exact: true }).click()
      const workspaceStatus = page.getByRole('status').filter({ hasText: '離線狀態' })
      expect((await workspaceStatus.boundingBox())!.height).toBe(32)
      const open = page.getByRole('button', { name: '開啟對話框', exact: true })
      await open.click()
      const dialog = page.getByRole('dialog')
      const status = dialog.getByRole('status')
      await status.scrollIntoViewIfNeeded()
      await expectContainedText(status)
      await expect(dialog.getByRole('button', { name: '確認', exact: true })).toBeInViewport()
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible()
      await expect(open).toBeFocused()
    }
  }
})

test('Linux native frame keeps a 52px app toolbar without reserving absent overlay controls', async ({
  page,
}) => {
  for (const [width, height] of [
    [1440, 900],
    [960, 492],
  ] as const) {
    await page.setViewportSize({ width, height })
    await page.goto('http://127.0.0.1:4178/components.html')
    await expect(page.locator('html')).toHaveAttribute('data-platform', 'linux')
    const toolbar = page.locator('[data-region="toolbar"]')
    await expect(toolbar).toHaveCSS('height', '52px')
    await expect(toolbar).toHaveCSS('padding-right', '20px')
    const inspector = toolbar.getByRole('button', { name: '檢視器', exact: true })
    await expect(inspector).toBeInViewport({ ratio: 1 })
    await inspector.click()
    await expect(page.locator('[data-region="inspector"]')).toBeVisible()
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await expect(page.locator('[data-region="inspector"]')).not.toBeVisible()
    await page.screenshot({
      path: test.info().outputPath(`linux-native-frame-toolbar-${width}x${height}.png`),
    })
  }
})

test('Linux menu entry remains keyboard reachable and reports an unavailable native menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 492 })
  await page.goto('http://127.0.0.1:4178/components.html')
  const menu = page.getByRole('button', { name: '更多命令', exact: true })
  await expect(menu).toHaveCount(1)
  await expect(menu).toBeInViewport({ ratio: 1 })
  await menu.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('alert')).toHaveText('選單暫時無法開啟，請再試一次。')
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(menu).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alert')).toHaveCount(0)
  // This browser fixture returns unavailable; native success is covered on Windows.
})

test('a long role name leaves the menu and toolbar actions reachable', async ({ page }) => {
  const name = '長角色名稱'.repeat(16)
  for (const width of [1440, 960]) {
    await page.setViewportSize({ width, height: 492 })
    await page.goto('http://127.0.0.1:4178/components.html?name=' + encodeURIComponent(name))
    const toolbar = page.locator('[data-region="toolbar"]')
    await expect(toolbar).toHaveCSS('height', '52px')
    const title = toolbar.getByText(name, { exact: true })
    await expect(title).toHaveCSS('text-overflow', 'ellipsis')
    expect(await title.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    const more = toolbar.getByRole('button', { name: '更多命令', exact: true })
    const inspector = toolbar.getByRole('button', { name: '檢視器', exact: true })
    await expect(more).toBeInViewport({ ratio: 1 })
    await expect(inspector).toBeInViewport({ ratio: 1 })
    await inspector.click()
    await expect(page.locator('[data-region="inspector"]')).toBeVisible()
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await more.click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.keyboard.press('Escape')
  }
})
