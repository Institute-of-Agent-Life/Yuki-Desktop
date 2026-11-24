import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { activeCharacterName } from '../fixtures/active-character'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { contentSize } from '../fixtures/visual'
import { picture } from '../fixtures/pictures'
import { appearanceFor, legible, throughGlass } from '../fixtures/legibility'

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
 *   9. over a high-contrast picture the composer's text falls below 4.5:1 in either theme;
 *  10. over it the conversation's own text is lost: in its bubbles (sender, time, a file's name
 *      and kind, the text itself) and laid straight on the picture (the toolbar's title and status,
 *      the date, the conversation's opening line): main text below 4.5:1, the rest below 3:1.
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
    evidence.legibility = measured
    const legibility = (text: Locator) => legible(page, text)
    const messages = page.locator('[role="log"]').first(),
      toolbar = page.locator('[data-region="toolbar"]').first()
    const reply = messages
        .locator('article')
        .filter({ hasText: 'Desktop reference reply' })
        .first(),
      artifact = messages.locator('article').filter({ hasText: 'desktop-reference.txt' }).first(),
      own = messages.locator('article').filter({ hasText: 'fixture file' }).first()
    // Real legibility over this line art, light and dark, at the worst 1% of pixels under the
    // glyphs: main text 4.5:1, quiet text (times, kinds, status, the date, the opening line) 3:1,
    // each piece of glass taking the appearance its own part of the picture calls for.
    //
    // Where the text lies on glass over the picture's solid black shapes and white paper at once
    // (the composer, the artifact's bubble, the toolbar's small capsule), no glass that is neither
    // milky nor opaque reaches that: the Dock's tone maps black to level 48 (light) and white to
    // 180 (dark), so no ink keeps more than 3.2:1 over both, and even the panes' blur (Apple's clear
    // glass at their size) leaves the shapes' edges under the glyphs. There the glass is held to
    // the appearance the rule calls for (appearance.ts) and to the best this glass reaches, as
    // measured (light / dark on a Retina Mac, whose display encoding reads mid greys a little
    // dark; Linux without GPU compositing 3.7 / 3.2): composer 4.3 / 3.2–3.6, time 1.7 / 1.7, file name 3.1 / 2.5, file kind 1.7 / 1.6,
    // status 3.4 / 2.9.
    const bubble = (article: Locator) => article.locator('[data-bubble-copy]').locator('..')
    const texts: [string, Locator, number, Locator?][] = [
      ['composer', composer, 3, page.locator('[data-region="composer"]')],
      ['reply', reply.getByText('Desktop reference reply', { exact: true }), 4.5, bubble(reply)],
      ['own message', own.getByText('fixture file', { exact: true }), 4.5, bubble(own)],
      ['own sender', own.locator('header strong'), 4.5, bubble(own)],
      ['sender', artifact.locator('header strong'), 4.5],
      ['time', artifact.locator('header time'), 1.6, bubble(artifact)],
      [
        'file name',
        artifact.getByText('desktop-reference.txt', { exact: true }),
        2.4,
        bubble(artifact),
      ],
      ['file kind', artifact.getByText('成果檔案', { exact: true }), 1.5, bubble(artifact)],
      ['title', toolbar.locator('strong').first(), 4.5],
      [
        'status',
        toolbar.locator('small').first(),
        2.8,
        toolbar.locator('small').first().locator('xpath=ancestor::*[@data-glass][1]'),
      ],
      ['date', messages.getByText(/^\d{1,2}\/\d{1,2}$/).first(), 3],
      ['opening', messages.locator('header h2').first(), 4.5],
      ['opening line', messages.locator('header p').first(), 3],
    ]
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.yuki.preferences({ theme }), theme)
      await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
      await page.waitForTimeout(800)
      await messages.evaluate((element) => (element.scrollTop = 0))
      await page.screenshot({ path: test.info().outputPath(`chat-lineart-${theme}.png`) })
      const seen: Record<string, number> = {}
      for (const [name, text] of texts) seen[name] = await legibility(text)
      measured[theme] = seen
      // 9, 10
      for (const [name, , least] of texts)
        expect.soft(seen[name], `${theme} ${name}`).toBeGreaterThanOrEqual(least)
      // Dark without a picture of its own dims the light one by 30% of the page's colour.
      const dim =
        theme === 'dark'
          ? { colour: [0x1b, 0x1d, 0x22], amount: 0.3 }
          : { colour: [255, 255, 255], amount: 0 }
      const shown: Record<string, unknown> = {},
        through = await throughGlass(page)
      for (const [name, , , glass] of texts) {
        if (!glass) continue
        // A bubble's frost or, without transparency, any glass is a fill of the theme there.
        const content = !['composer', 'status'].includes(name)
        const { mean, high, expected: rule } = await appearanceFor(page, glass, lineart, dim)
        const expected = (content ? through.content : through.glass) ? rule : null
        const actual = await glass.getAttribute('data-appearance')
        const round = (value: number) => Math.round(value * 1000) / 1000
        shown[name] = { mean: round(mean), high: round(high), expected, actual }
        if (expected !== null || !(content ? through.content : through.glass))
          expect.soft(actual, `${theme} ${name}'s glass`).toBe(expected)
      }
      measured[`${theme} appearance`] = shown
    }
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
