import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { captureViewport, contentSize } from '../fixtures/visual'

test('a CSS viewport larger than the native work area captures every corner at full resolution and preserves real pointer navigation', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture()
  const app = await rig.launch('emulated-viewport')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const draft = '原草稿：縮放預覽仍能操作，不送出模型任務。'
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await composer.fill(draft)
    const native = await app.evaluate(({ BrowserWindow, screen, app }) => {
      const win = BrowserWindow.getAllWindows()[0]!
      return {
        work: screen.getDisplayMatching(win.getBounds()).workArea,
        minimum: win.getMinimumSize(),
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      }
    })
    expect(native.noSandbox).toBe(false)
    const width = native.work.width + 400,
      height = native.work.height + 300
    expect(await contentSize(app, page, width, height)).toBe('electron-device-emulation')
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await expect(page.getByRole('tab', { name: '外觀', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.getByRole('radio', { name: '深色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const cornerColors = ['19,237,101', '231,17,183', '37,113,239', '241,173,29']
    await page.evaluate((colors) => {
      for (const [index, color] of colors.entries()) {
        const marker = document.createElement('div')
        marker.dataset.captureCorner = String(index)
        Object.assign(marker.style, {
          position: 'fixed',
          width: '20px',
          height: '20px',
          zIndex: '2147483647',
          pointerEvents: 'none',
          background: `rgb(${color})`,
          [index % 2 ? 'right' : 'left']: '0',
          [index < 2 ? 'top' : 'bottom']: '0',
        })
        document.body.append(marker)
      }
    }, cornerColors)
    const path = test.info().outputPath('large-css-complete.png')
    const frame = await captureViewport(app, page, path)
    const cornerPixels = await app.evaluate(
      ({ nativeImage }, { bytes, colors }) => {
        const image = nativeImage.createFromBuffer(Buffer.from(bytes, 'base64'))
        const bitmap = image.toBitmap()
        const size = image.getSize()
        const corners = colors.map(() => ({
          count: 0,
          minX: size.width,
          minY: size.height,
          maxX: -1,
          maxY: -1,
        }))
        for (let i = 0; i < bitmap.length; i += 4) {
          const color = `${bitmap[i + 2]},${bitmap[i + 1]},${bitmap[i]}`
          const index = colors.indexOf(color)
          if (index < 0) continue
          const corner = corners[index]!
          const x = (i / 4) % size.width
          const y = Math.floor(i / 4 / size.width)
          corner.count += 1
          corner.minX = Math.min(corner.minX, x)
          corner.minY = Math.min(corner.minY, y)
          corner.maxX = Math.max(corner.maxX, x)
          corner.maxY = Math.max(corner.maxY, y)
        }
        return corners
      },
      { bytes: frame.toString('base64'), colors: cornerColors },
    )
    // Padding a native-sized scene into a larger PNG must fail, even if all marker colors exist.
    const pngWidth = frame.readUInt32BE(16),
      pngHeight = frame.readUInt32BE(20)
    const dpr = await page.evaluate(() => devicePixelRatio)
    const markerPixels = Math.round(20 * dpr)
    for (const [index, corner] of cornerPixels.entries()) {
      expect(corner).toEqual({
        count: markerPixels * markerPixels,
        minX: index % 2 ? pngWidth - markerPixels : 0,
        maxX: index % 2 ? pngWidth - 1 : markerPixels - 1,
        minY: index < 2 ? 0 : pngHeight - markerPixels,
        maxY: index < 2 ? markerPixels - 1 : pngHeight - 1,
      })
    }
    await page
      .locator('[data-capture-corner]')
      .evaluateAll((markers) => markers.forEach((marker) => marker.remove()))
    const evidence = JSON.parse(await readFile(path.replace('.png', '.capture.json'), 'utf8')) as {
      viewport: { width: number; height: number }
      interactionScale: number
      captureScale: number
      nativeSurface: { width: number; height: number }
      captureDip: { width: number; height: number }
      pngPixels: { width: number; height: number }
    }
    expect(evidence.viewport).toEqual({ width, height })
    expect(evidence.interactionScale).toBe(1)
    expect(evidence.captureScale).toBe(1)
    expect(evidence.captureDip).toEqual({ width, height })
    expect(evidence.pngPixels).toEqual({
      width: frame.readUInt32BE(16),
      height: frame.readUInt32BE(20),
    })
    expect(evidence.pngPixels).toEqual({
      width: Math.round(evidence.captureDip.width * dpr),
      height: Math.round(evidence.captureDip.height * dpr),
    })
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(composer).toHaveValue(draft)
    await composer.click()
    await expect(composer).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type(' pointer verified')
    await expect(composer).toHaveValue(draft + ' pointer verified')
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize()),
    ).toEqual(native.minimum)
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
