import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchShell } from '../fixtures/shell-app'

test('native startup, actual button and keyboard paths, preferences survive restart', async () => {
  const data = await mkdtemp(join(tmpdir(), 'yuki-desktop-test-'))
  const launch = () => launchShell(data)
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '開始', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '開始', exact: true }).click()
    await expect(page.getByLabel('伺服器位址')).toBeFocused()
    await page.getByLabel('伺服器位址').fill('https://example.invalid/mika')
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('region', { name: '設定', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await page.getByRole('tab', { name: '深色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('switch', { name: '永遠不透明' }).click()
    await expect(page.getByRole('switch', { name: '永遠不透明' })).toBeChecked()
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('settings-dark.png'),
    })
    const isolated = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }))
    expect(isolated).toEqual({ require: 'undefined', process: 'undefined' })
    await page.evaluate(() => window.open('https://example.invalid'))
    expect(app.windows()).toHaveLength(1)
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  } finally {
    await app.close()
    await rm(data, { recursive: true, force: true })
  }
})
