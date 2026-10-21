import { expect, test, type Page } from '@playwright/test'

const gallery = 'http://127.0.0.1:4178/components.html'
const counts = async (page: Page) =>
  JSON.parse((await page.getByLabel('互動次數').textContent())!) as {
    switch: number
    segment: number
    button: number
  }
test('press feedback never delays the action and clears after rapid clicks, leave and cancellation', async ({
  page,
}) => {
  await page.goto(gallery)
  const button = page.getByRole('button', { name: '次要', exact: true }),
    bounds = (await button.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await expect
    .poll(() => button.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).a))
    .toBeLessThan(0.97)
  expect((await counts(page)).button).toBe(0)
  await page.mouse.up()
  await expect.poll(async () => (await counts(page)).button).toBe(1)
  await button.click()
  await button.click()
  await expect.poll(async () => (await counts(page)).button).toBe(3)
  await expect(button).toHaveCSS('transform', 'none')
  await page.mouse.move(bounds.x + 12, bounds.y + 12)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width + 40, bounds.y + 12)
  await page.mouse.up()
  expect((await counts(page)).button).toBe(3)
  await expect(button).toHaveCSS('transform', 'none')
  await button.focus()
  await page.keyboard.press('Space')
  await expect.poll(async () => (await counts(page)).button).toBe(4)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(bounds.x + 12, bounds.y + 12)
  await page.mouse.down()
  await expect(button).toHaveCSS('transform', 'none')
  await page.mouse.up()
  await page.getByRole('button', { name: '停用', exact: true }).hover()
  await expect.poll(async () => (await counts(page)).button).toBe(5)
})

test('segmented selection and switches commit once per drag and cancel without a commit', async ({
  page,
}) => {
  await page.goto(gallery)
  const light = page.getByRole('radio', { name: '淺色', exact: true }),
    dark = page.getByRole('radio', { name: '深色', exact: true })
  const a = (await light.boundingBox())!,
    b = (await dark.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + 13)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + 13, { steps: 6 })
  const pill = page.getByRole('radiogroup', { name: '預覽主題' }).locator('[data-glass=segment]')
  await expect
    .poll(() => pill.evaluate((node) => Number(node.style.getPropertyValue('--glass-pressure'))))
    .toBeGreaterThan(0.5)
  await expect(light).toHaveAttribute('aria-checked', 'true')
  await page.mouse.up()
  await expect(dark).toHaveAttribute('aria-checked', 'true')
  expect((await counts(page)).segment).toBe(1)
  await page.mouse.move(b.x + 30, b.y + 13)
  await page.mouse.down()
  await page.mouse.move(a.x + 30, a.y + 13, { steps: 4 })
  await page.mouse.move(b.x + 30, b.y + 13, { steps: 4 })
  await page.mouse.up()
  expect((await counts(page)).segment).toBe(1)
  await dark.press('ArrowLeft')
  await expect(light).toBeFocused()
  expect((await counts(page)).segment).toBe(2)
  const toggle = page.getByRole('switch', { name: '測試切換' }),
    t = (await toggle.boundingBox())!
  await page.mouse.move(t.x + 10, t.y + 11)
  await page.mouse.down()
  await page.mouse.move(t.x + 28, t.y + 11, { steps: 4 })
  await page.mouse.up()
  await expect(toggle).toBeChecked()
  expect((await counts(page)).switch).toBe(1)
  await page.mouse.move(t.x + 28, t.y + 11)
  await page.mouse.down()
  await page.mouse.move(t.x + 9, t.y + 11, { steps: 4 })
  await page.dispatchEvent('body', 'pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect(toggle).toBeChecked()
  expect((await counts(page)).switch).toBe(1)
  await toggle.press('Space')
  await expect(toggle).not.toBeChecked()
  expect((await counts(page)).switch).toBe(2)
})

test('slider follows the pointer with no value spring and survives cancellation, external synchronization and reduced motion', async ({
  page,
}) => {
  await page.goto(gallery)
  const slider = page.getByRole('slider', { name: '測試縮放' }),
    bounds = (await slider.boundingBox())!
  const x = (fraction: number) => bounds.x + 14 + (bounds.width - 28) * fraction,
    y = bounds.y + 15
  await page.mouse.move(x(0.5), y)
  await page.mouse.down()
  await expect
    .poll(() =>
      slider
        .locator('[data-glass=slider]')
        .evaluate((node) => Number(node.style.getPropertyValue('--glass-pressure'))),
    )
    .toBeGreaterThan(0.5)
  await expect(slider).toHaveAttribute('aria-valuenow', '250')
  await page.mouse.move(x(0.8), y, { steps: 5 })
  await expect
    .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
    .toBeCloseTo(340, 0)
  await page.mouse.move(bounds.x + bounds.width + 100, y)
  await expect(slider).toHaveAttribute('aria-valuenow', '400')
  await page.dispatchEvent('body', 'pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect(slider).toHaveAttribute('aria-valuenow', '400')
  await slider.press('Home')
  await expect(slider).toHaveAttribute('aria-valuenow', '100')
  await slider.press('Shift+ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '125')
  await slider.press('PageUp')
  await expect(slider).toHaveAttribute('aria-valuenow', '150')
  await page.getByRole('button', { name: '稍後同步外部值' }).click()
  await page.mouse.move(x(0.5), y)
  await page.mouse.down()
  await expect(page.getByLabel('縮放讀數')).toHaveText('125%')
  await expect(slider).toHaveAttribute('aria-valuenow', '250')
  await page.mouse.up()
  await expect(slider).toHaveAttribute('aria-valuenow', '125')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(x(0.9), y)
  await page.mouse.down()
  await expect
    .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
    .toBeCloseTo(370, 0)
  const thumb = slider.locator('[data-glass="slider"]')
  await expect
    .poll(() => thumb.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).a))
    .toBe(1)
  await expect
    .poll(() => thumb.evaluate((node) => Number(node.style.getPropertyValue('--glass-pressure'))))
    .toBe(1)
  await page.mouse.up()
  await page.screenshot({ path: test.info().outputPath('controls-frosted.png') })
})

test('SVG lens really displaces backdrop pixels while foreground text stays sharp', async ({
  page,
}) => {
  await page.goto(gallery)
  const sample = page.getByTestId('lens-sample'),
    lens = sample.locator('[data-glass=toolbar]')
  await expect(lens).toHaveAttribute('data-refracting', 'true')
  const on = await sample.screenshot()
  await page.getByRole('button', { name: '只切換像素折射', exact: true }).click()
  const off = await sample.screenshot()
  const pixels = await page.evaluate(
    async ({ on, off }) => {
      const decode = async (bytes: string) => {
        const image = new Image()
        image.src = 'data:image/png;base64,' + bytes
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return {
          width: image.width,
          height: image.height,
          data: context.getImageData(0, 0, image.width, image.height).data,
        }
      }
      const a = await decode(on),
        b = await decode(off)
      let changed = 0,
        foreground = 0,
        movedForeground = 0
      for (let k = 0; k < a.data.length; k += 4) {
        if (
          Math.abs(a.data[k]! - b.data[k]!) +
            Math.abs(a.data[k + 1]! - b.data[k + 1]!) +
            Math.abs(a.data[k + 2]! - b.data[k + 2]!) >
          30
        )
          changed++
        const redA = a.data[k]! > 180 && a.data[k + 1]! < 80 && a.data[k + 2]! < 80
        const redB = b.data[k]! > 180 && b.data[k + 1]! < 80 && b.data[k + 2]! < 80
        if (redA) foreground++
        if (redA !== redB) movedForeground++
      }
      return { changed, foreground, movedForeground }
    },
    { on: on.toString('base64'), off: off.toString('base64') },
  )
  expect(pixels.changed).toBeGreaterThan(100)
  expect(pixels.foreground).toBeGreaterThan(20)
  expect(pixels.movedForeground).toBe(0)
})
