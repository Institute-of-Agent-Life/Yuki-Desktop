import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { activeCharacterName } from '../fixtures/active-character'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { contentSize } from '../fixtures/visual'

/*
 * A custom chat background (docs/reports/2026-11-23-liquid-glass §12, phase 5). Failure cases,
 * written before the feature:
 *   1. Appearance offers no picture of one's own, or choosing one does not make it the backdrop;
 *   2. the picture is not kept by the app: the original is not copied, the same picture is kept
 *      twice, or the copy shown is not a smaller one (at most twice the screen's long side);
 *   3. no brightness table is made at import, so glass cannot follow what lies under it;
 *   4. fit, blur and dim do not reach the page: fill/fit/tile are not cover/contain/repeat, a blur
 *      is drawn live rather than from a blurred copy, the dim is not laid over it;
 *   5. light and dark cannot have pictures of their own, or dark without one does not dim;
 *   6. a replaced or removed picture's files stay behind;
 *   7. preferences outside the allowed values are kept (paths, fits, blur > 20, dim > 60);
 *   8. the chat's own menu cannot change the background;
 *   9. over a high-contrast picture the composer's text falls below 4.5:1 in either theme.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('custom-backdrop.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

// Pictures drawn for the test, so nothing of anyone else's is used: black and white line art
// (strokes, hatching and solid shapes), and a soft colour gradient.
async function picture(page: Page, kind: 'lineart' | 'gradient') {
  const data = await page.evaluate(async (kind) => {
    const canvas = new OffscreenCanvas(1600, 1000),
      context = canvas.getContext('2d')!
    if (kind === 'gradient') {
      const gradient = context.createLinearGradient(0, 0, 1600, 1000)
      gradient.addColorStop(0, '#ff9a62')
      gradient.addColorStop(0.5, '#7c6cff')
      gradient.addColorStop(1, '#1fc8b4')
      context.fillStyle = gradient
      context.fillRect(0, 0, 1600, 1000)
    } else {
      let seed = 7
      const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
      context.fillStyle = '#f4f4f4'
      context.fillRect(0, 0, 1600, 1000)
      context.fillStyle = '#111'
      for (let shape = 0; shape < 14; shape++) {
        context.beginPath()
        const x = random() * 1600,
          y = random() * 1000
        context.moveTo(x, y)
        for (let point = 0; point < 5; point++)
          context.lineTo(x + (random() - 0.5) * 420, y + (random() - 0.5) * 420)
        context.fill()
      }
      context.strokeStyle = '#111'
      for (let band = 0; band < 6; band++) {
        const y = random() * 1000
        context.lineWidth = 2
        for (let x = -200; x < 1600; x += 9) {
          context.beginPath()
          context.moveTo(x, y)
          context.lineTo(x + 120, y - 120)
          context.stroke()
        }
      }
      for (let stroke = 0; stroke < 90; stroke++) {
        context.lineWidth = 3 + random() * 6
        context.strokeStyle = random() < 0.8 ? '#111' : '#fff'
        context.beginPath()
        let x = random() * 1600,
          y = random() * 1000
        context.moveTo(x, y)
        for (let step = 0; step < 6; step++)
          context.lineTo((x += (random() - 0.5) * 90), (y += (random() - 0.5) * 90))
        context.stroke()
      }
    }
    const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }, kind)
  return Buffer.from(data, 'base64')
}

// The system's file dialog answers with `path` the next time the app asks for a picture.
const answerWith = (app: ElectronApplication, path: string) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, path)
const backgrounds = async (app: ElectronApplication) =>
  (
    await readdir(
      join(await app.evaluate(({ app }) => app.getPath('userData')), 'backgrounds'),
    ).catch(() => [] as string[])
  ).sort()
const preferences = (page: Page) =>
  page.evaluate(async () => (await window.yuki.boot()).preferences)
const variables = (page: Page) =>
  page.evaluate((): Record<string, string> => {
    const style = getComputedStyle(document.documentElement)
    return Object.fromEntries(
      ['--backdrop-image', '--backdrop-size', '--backdrop-repeat', '--backdrop-dim'].map((name) => [
        name,
        style.getPropertyValue(name).trim(),
      ]),
    )
  })
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

test('a picture of ones own is kept once, fitted, blurred, dimmed per theme and cleaned up', async () => {
  test.setTimeout(180000)
  const root = await mkdtemp(join(tmpdir(), 'yuki-custom-backdrop-'))
  const app = await (await isolatedDesktop(root)).launch('profile')
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    const lineart = await picture(page, 'lineart'),
      gradient = await picture(page, 'gradient')
    const files = { lineart: join(root, 'lineart.png'), gradient: join(root, 'gradient.png') }
    await writeFile(files.lineart, lineart)
    await writeFile(files.gradient, gradient)
    const ids = { lineart: sha(lineart), gradient: sha(gradient) }
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const pictures = page.getByRole('radiogroup', { name: '對話背景', exact: true })
    const themes = page.getByRole('radiogroup', { name: '主題', exact: true })
    await themes.getByRole('radio', { name: '淺色', exact: true }).click()

    // 1
    await answerWith(app, files.lineart)
    await pictures.getByRole('radio', { name: '自訂圖片', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).toBe('custom')
    expect((await preferences(page)).customBackdrop).toEqual({
      light: ids.lineart,
      fit: 'fill',
      blur: 0,
      dim: 0,
    })
    await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
    expect((await variables(page))['--backdrop-image']).toContain(
      `__backgrounds/${ids.lineart}.webp`,
    )
    // 2, 3
    const kept = await backgrounds(app)
    evidence.kept = kept
    expect(kept).toEqual(
      [`${ids.lineart}.webp`, `${ids.lineart}.json`, `${ids.lineart}.png`].sort(),
    )
    const folder = join(await app.evaluate(({ app }) => app.getPath('userData')), 'backgrounds')
    expect(await readFile(join(folder, `${ids.lineart}.png`))).toEqual(lineart)
    // The smaller copy is what the page shows; the original is never served.
    expect(
      await page.evaluate(
        async (url) => (await fetch(url)).status,
        `app://desktop/__backgrounds/${ids.lineart}.png`,
      ),
    ).toBe(404)
    const shown = await page.evaluate(async (url) => {
      const image = await createImageBitmap(await (await fetch(url)).blob())
      return {
        size: { width: image.width, height: image.height },
        limit: 2 * Math.max(screen.width, screen.height),
      }
    }, `app://desktop/__backgrounds/${ids.lineart}.webp`)
    evidence.shown = shown
    expect(Math.max(shown.size.width, shown.size.height)).toBeLessThanOrEqual(shown.limit)
    const table = JSON.parse(await readFile(join(folder, `${ids.lineart}.json`), 'utf8')) as {
      grid: number
      cells: number[][]
      average: string
    }
    expect(table.grid).toBe(32)
    expect(table.cells).toHaveLength(32 * 32)
    expect(table.average).toMatch(/^#[0-9a-f]{6}$/)
    // High-contrast line art: somewhere a cell holds both near-black and near-white.
    expect(table.cells.some(([, low, high]) => low! < 0.05 && high! > 0.6)).toBe(true)
    // The same picture again is the same file.
    await answerWith(app, files.lineart)
    await page.getByRole('button', { name: '選擇圖片…', exact: true }).first().click()
    await page.waitForTimeout(500)
    expect(await backgrounds(app)).toEqual(kept)

    // 4
    const fit = page.getByRole('radiogroup', { name: '顯示方式', exact: true })
    for (const [label, size, repeat] of [
      ['完整顯示', 'contain', 'no-repeat'],
      ['並排', 'auto', 'repeat'],
      ['填滿', 'cover', 'no-repeat'],
    ] as const) {
      await fit.getByRole('radio', { name: label, exact: true }).click()
      await expect.poll(async () => (await variables(page))['--backdrop-size']).toBe(size)
      expect((await variables(page))['--backdrop-repeat']).toBe(repeat)
    }
    const blur = page.getByRole('slider', { name: '背景模糊', exact: true })
    await blur.focus()
    await page.keyboard.press('End')
    await expect.poll(async () => (await preferences(page)).customBackdrop.blur).toBe(20)
    const blurred = (await variables(page))['--backdrop-image']
    expect(blurred!).toContain(`__backgrounds/${ids.lineart}-blur20.webp`)
    expect(
      await page.evaluate(
        async (url) => {
          const response = await fetch(url)
          return [response.status, response.headers.get('content-type')]
        },
        blurred!.match(/url\("?([^")]+)"?\)/)![1]!,
      ),
    ).toEqual([200, 'image/webp'])
    const dim = page.getByRole('slider', { name: '變暗', exact: true })
    await dim.focus()
    await page.keyboard.press('End')
    await expect.poll(async () => (await preferences(page)).customBackdrop.dim).toBe(60)
    await expect.poll(async () => (await variables(page))['--backdrop-dim']).toBe('60%')
    await page.keyboard.press('Home')
    await blur.focus()
    await page.keyboard.press('Home')
    await expect
      .poll(async () => (await preferences(page)).customBackdrop)
      .toMatchObject({
        blur: 0,
        dim: 0,
      })

    // 5
    const separate = page.getByRole('switch', { name: '淺色與深色分別設定', exact: true })
    await separate.click()
    await answerWith(app, files.gradient)
    await page.getByRole('button', { name: '選擇深色圖片…', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).customBackdrop.dark).toBe(ids.gradient)
    await themes.getByRole('radio', { name: '深色', exact: true }).click()
    await expect
      .poll(async () => (await variables(page))['--backdrop-image'])
      .toContain(`__backgrounds/${ids.gradient}.webp`)
    await expect.poll(async () => (await variables(page))['--backdrop-dim']).toBe('0%')
    await separate.click()
    await expect.poll(async () => (await preferences(page)).customBackdrop.dark).toBeUndefined()
    await expect
      .poll(async () => (await variables(page))['--backdrop-image'])
      .toContain(`__backgrounds/${ids.lineart}.webp`)
    // Dark without its own picture dims the light one by 30%.
    await expect.poll(async () => (await variables(page))['--backdrop-dim']).toBe('30%')
    await themes.getByRole('radio', { name: '淺色', exact: true }).click()

    // 6
    await answerWith(app, files.gradient)
    await page.getByRole('button', { name: '選擇圖片…', exact: true }).first().click()
    await expect.poll(async () => (await preferences(page)).customBackdrop.light).toBe(ids.gradient)
    await expect
      .poll(() => backgrounds(app))
      .toEqual([`${ids.gradient}.webp`, `${ids.gradient}.json`, `${ids.gradient}.png`].sort())
    await page.screenshot({ path: test.info().outputPath('settings-custom-light.png') })
    await page.getByRole('button', { name: '移除自訂背景', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).not.toBe('custom')
    await expect.poll(async () => (await preferences(page)).customBackdrop.light).toBeUndefined()
    await expect.poll(() => backgrounds(app)).toEqual([])

    // 7
    const kept7 = await page.evaluate(
      async () =>
        (
          await window.yuki.preferences({
            customBackdrop: { light: '../../escape', fit: 'zoom', blur: 99, dim: -3 },
          } as never)
        ).customBackdrop,
    )
    evidence.invalid = kept7
    expect(kept7).toEqual({ fit: 'fill', blur: 20, dim: 0 })
  } finally {
    await app.close()
  }
})

// WCAG contrast between two sRGB colours.
const contrast = (a: number[], b: number[]) => {
  const luminance = (rgb: number[]) => {
    const [r, g, bl] = rgb.map((value) => {
      const c = value / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

test('text on the glass stays legible over a high-contrast picture of ones own', async () => {
  test.setTimeout(240000)
  const rig = await yukiFixture(),
    app = await rig.launch('custom-backdrop')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await contentSize(app, page, 1100, 760)
    const lineart = await picture(page, 'lineart')
    const file = join(rig.root, 'lineart.png')
    await writeFile(file, lineart)
    // 8: from the chat's own menu, over its empty space.
    await answerWith(app, file)
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (this: Electron.Menu) {
        this.items.find((item) => item.label === '更換背景…')!.click()
      }
    })
    const log = page.locator('[role="log"]').first()
    const box = (await log.boundingBox())!
    await page.mouse.click(box.x + 12, box.y + box.height / 2, { button: 'right' })
    await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
    expect((await preferences(page)).customBackdrop.light).toBe(sha(lineart))

    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
    })
    await composer.fill('邊緣應該把後面的內容彎過去，文字仍然要看得清楚。')
    const measured: Record<string, unknown> = {}
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.yuki.preferences({ theme }), theme)
      await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
      await page.waitForTimeout(800)
      await page.screenshot({ path: test.info().outputPath(`chat-lineart-${theme}.png`) })
      // 9: the text's colour against everything the glass shows behind it, the text hidden.
      const colour = await composer.evaluate((element) => getComputedStyle(element).color)
      await composer.evaluate((element) => {
        element.style.color = 'transparent'
        element.style.caretColor = 'transparent'
      })
      await page.waitForTimeout(100)
      const area = (await composer.boundingBox())!
      const shot = await page.screenshot({ clip: area })
      await composer.evaluate((element) => {
        element.style.color = ''
        element.style.caretColor = ''
      })
      const pixels = await page.evaluate(async (data) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = new OffscreenCanvas(image.width, image.height),
          context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const all = context.getImageData(0, 0, image.width, image.height).data,
          list: number[][] = []
        for (let k = 0; k < all.length; k += 4) list.push([all[k]!, all[k + 1]!, all[k + 2]!])
        return list
      }, shot.toString('base64'))
      const text = colour
        .match(/\d+(\.\d+)?/g)!
        .slice(0, 3)
        .map(Number)
      const ratios = pixels.map((pixel) => contrast(text, pixel)).sort((a, b) => a - b)
      // The worst 1% of what lies behind the text.
      const worst = ratios[Math.floor(ratios.length * 0.01)]!
      measured[theme] = { text, worst, median: ratios[Math.floor(ratios.length / 2)] }
      expect(worst, theme).toBeGreaterThanOrEqual(4.5)
    }
    evidence.legibility = measured
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
