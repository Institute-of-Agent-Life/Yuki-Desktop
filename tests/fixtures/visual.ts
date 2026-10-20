import { expect, test, type ElectronApplication, type Page } from '@playwright/test'

export const workspaceSizes = [
  [1440, 900],
  [1100, 760],
  [960, 492],
] as const
export async function contentSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.setMinimumSize(960, 492)
      window.setContentSize(size.width, size.height)
    },
    { width, height },
  )
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
}
/** Captures the real app; theme changes go through its normal Settings controls. */
export async function captureWorkspace(
  app: ElectronApplication,
  page: Page,
  scenario: string,
  prepare: () => Promise<void>,
  options: { verify?: () => Promise<void>; cleanup?: () => Promise<void> } = {},
) {
  for (const theme of ['light', 'dark', 'opaque', 'contrast'] as const) {
    await contentSize(app, page, 1440, 900)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await page.getByRole('tab', { name: theme === 'dark' ? '深色' : '淺色', exact: true }).click()
    for (const [label, checked] of [
      ['永遠不透明', theme === 'opaque'],
      ['增加對比', theme === 'contrast'],
      ['減少動態', true],
    ] as const) {
      const toggle = page.getByRole('switch', { name: label, exact: true })
      if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', String(checked))
    }
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      theme === 'dark' ? 'dark' : 'light',
    )
    await expect(page.locator('html')).toHaveAttribute(
      'data-contrast',
      String(theme === 'contrast'),
    )
    await expect(page.locator('html')).toHaveAttribute('data-opaque', String(theme === 'opaque'))
    await prepare()
    for (const [width, height] of workspaceSizes) {
      await contentSize(app, page, width, height)
      await options.verify?.()
      const dpr = await page.evaluate(() => devicePixelRatio)
      await page.screenshot({
        path: test
          .info()
          .outputPath(`${process.platform}-${dpr}x-${theme}-${scenario}-${width}x${height}.png`),
        animations: 'disabled',
      })
    }
    await options.cleanup?.()
  }
}
