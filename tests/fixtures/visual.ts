import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

export const workspaceSizes = [
  [1440, 900],
  [1100, 760],
  [960, 492],
] as const
const viewports = new WeakMap<Page, { width: number; height: number; emulated: boolean }>()
export async function contentSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
) {
  const viewportMethod = await app.evaluate(
    ({ BrowserWindow, screen }, size) => {
      const window = BrowserWindow.getAllWindows()[0]!
      window.webContents.disableDeviceEmulation()
      const [minimumWidth, minimumHeight] = window.getMinimumSize()
      const area = screen.getDisplayMatching(window.getBounds()).workArea
      if (
        size.width >= minimumWidth! &&
        size.height >= minimumHeight! &&
        size.width <= area.width &&
        size.height <= area.height
      ) {
        window.setContentSize(size.width, size.height)
        return 'native-window' as const
      }
      window.webContents.enableDeviceEmulation({
        screenPosition: 'desktop',
        screenSize: size,
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 0,
        viewSize: size,
        scale: 1,
      })
      return 'electron-device-emulation' as const
    },
    { width, height },
  )
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  viewports.set(page, { width, height, emulated: viewportMethod === 'electron-device-emulation' })
  return viewportMethod
}

/** CDP capture resets Electron's device emulation. Capture its surface directly instead. */
export async function captureViewport(app: ElectronApplication, page: Page, path: string) {
  const viewport = viewports.get(page)
  if (!viewport?.emulated) return page.screenshot({ path, animations: 'disabled' })
  const { width, height } = viewport
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
  const data = await app.evaluate(
    async ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const bounds = window.getContentBounds()
      if (size.width > bounds.width || size.height > bounds.height)
        throw Error('The emulated viewport must fit the native capture surface')
      const image = await window.webContents.capturePage({ x: 0, y: 0, ...size })
      return image.toPNG().toString('base64')
    },
    { width, height },
  )
  const buffer = Buffer.from(data, 'base64')
  await writeFile(path, buffer)
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
  return buffer
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
      const viewportMethod = await contentSize(app, page, width, height)
      await options.verify?.()
      const dpr = await page.evaluate(() => devicePixelRatio)
      const path = test
        .info()
        .outputPath(
          `${process.platform}-${dpr}x-${theme}-${scenario}-${width}x${height}${viewportMethod === 'electron-device-emulation' ? '-emulated' : ''}.png`,
        )
      await captureViewport(app, page, path)
      // CSS measurements are review evidence, not an automatic visual approval.
      const metrics = await page.evaluate(() => {
        const describe = (element: Element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return {
            tag: element.tagName,
            region: element.getAttribute('data-region'),
            role: element.getAttribute('role'),
            name:
              element.getAttribute('aria-label') ??
              (element.tagName === 'BUTTON'
                ? element.textContent?.trim().slice(0, 160)
                : undefined),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            fontWeight: style.fontWeight,
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderWidth: style.borderWidth,
            padding: style.padding,
          }
        }
        const visible = (element: Element) => {
          const box = element.getBoundingClientRect()
          return (
            box.width > 0 &&
            box.height > 0 &&
            box.bottom > 0 &&
            box.top < innerHeight &&
            box.right > 0 &&
            box.left < innerWidth &&
            getComputedStyle(element).visibility !== 'hidden'
          )
        }
        return {
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          appearance: { ...document.documentElement.dataset },
          regions: [...document.querySelectorAll('[data-region]')].filter(visible).map(describe),
          typography: [
            ...document.querySelectorAll('h1,h2,h3,[role="log"] p,textarea,[role="status"],small'),
          ]
            .filter(visible)
            .slice(0, 24)
            .map(describe),
          controls: [...document.querySelectorAll('button')]
            .filter(visible)
            .slice(0, 48)
            .map(describe),
        }
      })
      await writeFile(
        path.replace(/\.png$/, '.metrics.json'),
        JSON.stringify({ ...metrics, viewportMethod }, null, 2) + '\n',
      )
    }
    await options.cleanup?.()
  }
}
