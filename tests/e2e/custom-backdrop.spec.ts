import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { contentSize } from '../fixtures/visual'
import { picture } from '../fixtures/pictures'

/*
 * A custom chat background (docs/reports/2026-11-23-liquid-glass §12, phase 5). Failure cases,
 * written before the feature:
 *   1. Appearance offers no picture of one's own, or choosing one does not make it the backdrop;
 *   2. the picture is not kept by the app: the original is not copied, the same picture is kept
 *      twice, or the copy shown is not a smaller one (at most twice the screen's long side);
 *   3. no average colour is kept at import, to fill where the picture is not drawn;
 *   4. fit, blur and dim do not reach the page: fill/fit/tile are not cover/contain/repeat, a blur
 *      is drawn live rather than from a blurred copy, the dim is not laid over it;
 *   5. light and dark cannot have pictures of their own, or dark without one does not dim;
 *   6. a removed picture's files stay behind;
 *   7. the chat's own menu cannot change the background.
 * Several pictures kept side by side, and values outside the allowed ones: saved-backdrops.spec.ts.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('custom-backdrop.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

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
    await page.getByRole('button', { name: '加入圖片…', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).toBe(`custom:${ids.lineart}`)
    expect((await preferences(page)).customBackdrops).toEqual([
      { light: ids.lineart, fit: 'fill', blur: 0, dim: 0 },
    ])
    await expect(pictures.getByRole('radio', { name: '自訂圖片 1', exact: true })).toBeChecked()
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
      average: string
    }
    expect(table).toEqual({ average: expect.stringMatching(/^#[0-9a-f]{6}$/) })
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
    await expect.poll(async () => (await preferences(page)).customBackdrops[0]!.blur).toBe(20)
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
    await expect.poll(async () => (await preferences(page)).customBackdrops[0]!.dim).toBe(60)
    await expect.poll(async () => (await variables(page))['--backdrop-dim']).toBe('60%')
    await page.keyboard.press('Home')
    await blur.focus()
    await page.keyboard.press('Home')
    await expect
      .poll(async () => (await preferences(page)).customBackdrops[0])
      .toMatchObject({
        blur: 0,
        dim: 0,
      })

    // 5
    const separate = page.getByRole('switch', { name: '淺色與深色分別設定', exact: true })
    await separate.click()
    await answerWith(app, files.gradient)
    await page.getByRole('button', { name: '選擇深色圖片…', exact: true }).click()
    await expect
      .poll(async () => (await preferences(page)).customBackdrops[0]!.dark)
      .toBe(ids.gradient)
    await themes.getByRole('radio', { name: '深色', exact: true }).click()
    await expect
      .poll(async () => (await variables(page))['--backdrop-image'])
      .toContain(`__backgrounds/${ids.gradient}.webp`)
    await expect.poll(async () => (await variables(page))['--backdrop-dim']).toBe('0%')
    await separate.click()
    await expect
      .poll(async () => (await preferences(page)).customBackdrops[0]!.dark)
      .toBeUndefined()
    await expect
      .poll(async () => (await variables(page))['--backdrop-image'])
      .toContain(`__backgrounds/${ids.lineart}.webp`)
    // Dark without its own picture dims the light one by 30%.
    await expect.poll(async () => (await variables(page))['--backdrop-dim']).toBe('30%')
    await themes.getByRole('radio', { name: '淺色', exact: true }).click()

    // 6
    await page.screenshot({ path: test.info().outputPath('settings-custom-light.png') })
    await page.getByRole('button', { name: '移除自訂背景', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).toBe('plain')
    expect((await preferences(page)).customBackdrops).toEqual([])
    await expect.poll(() => backgrounds(app)).toEqual([])
  } finally {
    await app.close()
  }
})

test('the chat menu sets a picture of ones own as the backdrop', async () => {
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
    // 7: from the chat's own menu, over its empty space.
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
    expect((await preferences(page)).backdrop).toBe(`custom:${sha(lineart)}`)
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.yuki.preferences({ theme }), theme)
      await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
      await page.waitForTimeout(800)
      await log.evaluate((element) => (element.scrollTop = 0))
      await page.screenshot({ path: test.info().outputPath(`chat-lineart-${theme}.png`) })
    }
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
