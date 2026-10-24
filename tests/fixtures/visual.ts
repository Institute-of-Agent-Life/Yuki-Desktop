import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

export const workspaceSizes = [
  [1440, 900],
  [1100, 760],
  [960, 492],
] as const
const viewports = new WeakMap<
  Page,
  { width: number; height: number; emulated: boolean; scale: number }
>()
let measurement = 0
async function renderedWorkspaceLayout(page: Page) {
  return page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    regions: [...document.querySelectorAll<HTMLElement>('[data-region]')]
      .filter((element) => !element.closest('[hidden]') && element.getClientRects().length > 0)
      .map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          region: element.dataset.region,
          rect: { x, y, width, height },
          visibility: style.visibility,
          position: style.position,
        }
      }),
  }))
}
export async function systemAccessibility(page: Page) {
  return page.evaluate(async () => {
    const boot = await window.yuki.boot()
    return {
      reducedTransparency: boot.reducedTransparency,
      highContrast: boot.highContrast,
      cssReducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      cssHighContrast: matchMedia('(prefers-contrast: more)').matches,
    }
  })
}
export async function contentSize(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
) {
  const viewport = await app.evaluate(
    async ({ BrowserWindow, screen }, size) => {
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
        return { method: 'native-window' as const, scale: 1 }
      }
      window.webContents.enableDeviceEmulation({
        screenPosition: 'desktop',
        screenSize: size,
        viewPosition: { x: 0, y: 0 },
        deviceScaleFactor: 0,
        viewSize: size,
        scale: 1,
      })
      return { method: 'electron-device-emulation' as const, scale: 1 }
    },
    { width, height },
  )
  const viewportMethod = viewport.method
  const emulated = viewportMethod === 'electron-device-emulation'
  if (emulated)
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
  else {
    // Native DPI/frame rounding is measured, never replaced with a claimed exact CSS size.
    let previous = ''
    await expect
      .poll(async () => {
        const current = await page.evaluate(() => JSON.stringify([innerWidth, innerHeight]))
        const settled = current === previous
        previous = current
        return settled
      })
      .toBe(true)
  }
  const actual = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
  }))
  viewports.set(page, { ...actual, emulated, scale: viewport.scale })
  await writeFile(
    test.info().outputPath(`viewport-${++measurement}-requested-${width}x${height}.json`),
    JSON.stringify(
      { requested: { width, height }, actual, viewportMethod, emulationScale: viewport.scale },
      null,
      2,
    ),
  )
  return viewportMethod
}

/** Capture virtual CSS views with Chromium, then restore Electron's interactive emulation. */
export async function captureViewport(app: ElectronApplication, page: Page, path: string) {
  const viewport = viewports.get(page)
  if (!viewport?.emulated) return page.screenshot({ path, animations: 'disabled' })
  const { width, height } = viewport
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
  const layoutBefore = await renderedWorkspaceLayout(page)
  const nativeSurface = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getContentBounds(),
  )
  const dpr = await page.evaluate(() => devicePixelRatio)
  const cdp = await page.context().newCDPSession(page)
  let pngPixels: { width: number; height: number } | null = null
  let layoutAfter: typeof layoutBefore | null = null
  try {
    // An explicit Chromium viewport paints the whole CSS view rather than padding
    // a cropped native surface. It remains virtual, not a larger physical display.
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    })
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    const frame = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    })
    const buffer = Buffer.from(frame.data, 'base64')
    pngPixels = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    await writeFile(path, buffer)
    return buffer
  } finally {
    try {
      await cdp.send('Emulation.clearDeviceMetricsOverride')
      await cdp.detach()
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0]!.webContents.enableDeviceEmulation({
            screenPosition: 'desktop',
            screenSize: size,
            viewPosition: { x: 0, y: 0 },
            deviceScaleFactor: 0,
            viewSize: size,
            scale: 1,
          })
        },
        { width, height },
      )
      // Restoring CSS dimensions does not mean React has committed its resize layout.
      await expect
        .poll(async () => {
          layoutAfter = await renderedWorkspaceLayout(page)
          return layoutAfter
        })
        .toEqual(layoutBefore)
    } finally {
      await writeFile(
        path.replace(/\.png$/, '.capture.json'),
        JSON.stringify(
          {
            viewport: { width, height },
            viewportMethod: 'electron-device-emulation',
            captureMethod: 'cdp-virtual-viewport',
            interactionScale: 1,
            captureScale: 1,
            nativeSurface,
            captureDip: { width, height },
            pngPixels,
            layoutBefore,
            layoutAfter,
          },
          null,
          2,
        ),
      )
    }
  }
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
    await page.getByRole('radio', { name: theme === 'dark' ? '深色' : '淺色', exact: true }).click()
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
    const system = await systemAccessibility(page)
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      theme === 'dark' ? 'dark' : 'light',
    )
    await expect(page.locator('html')).toHaveAttribute(
      'data-contrast',
      String(theme === 'contrast' || system.highContrast || system.cssHighContrast),
    )
    await expect(page.locator('html')).toHaveAttribute(
      'data-opaque',
      String(theme === 'opaque' || theme === 'contrast' || Object.values(system).some(Boolean)),
    )
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
        JSON.stringify(
          {
            ...metrics,
            requested: { width, height },
            viewportMethod,
            emulationScale: viewports.get(page)!.scale,
            systemAccessibility: system,
          },
          null,
          2,
        ) + '\n',
      )
    }
    await options.cleanup?.()
  }
}
