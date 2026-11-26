import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { picture } from '../fixtures/pictures'

/*
 * Several pictures of one's own, kept side by side in Appearance → 對話背景. Failure cases,
 * written before the feature:
 *   1. adding a picture replaces the one kept before rather than keeping both, or the new one is
 *      not the backdrop at once; adding the same picture again keeps it twice;
 *   2. choosing a kept picture's thumbnail does not make it the backdrop;
 *   3. each does not keep its own settings: a fit, blur, dim or dark picture set on one shows on
 *      the other;
 *   4. after a restart the pictures, their settings or which one is chosen are lost;
 *   5. removing a picture leaves its files on disk (original, copy, average, blurred copies), or
 *      takes another's; removing the chosen one does not fall back to the default backdrop;
 *   6. an entry that is not a kept picture, or settings outside the allowed values, are kept;
 *   7. a profile from before keeps its single picture (`customBackdrop`) apart: it is not the first
 *      kept picture, chosen if it was, with its settings, or the old field stays.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('saved-backdrops.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

const answerWith = (app: ElectronApplication, path: string) =>
  app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, path)
const folder = async (app: ElectronApplication) =>
  join(await app.evaluate(({ app }) => app.getPath('userData')), 'backgrounds')
const files = async (app: ElectronApplication) =>
  (await readdir(await folder(app)).catch(() => [] as string[])).sort()
const preferences = (page: Page) =>
  page.evaluate(async () => (await window.yuki.boot()).preferences)
const variable = (page: Page, name: string) =>
  page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    name,
  )
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function appearance(page: Page) {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '外觀', exact: true }).click()
  await page
    .getByRole('radiogroup', { name: '主題', exact: true })
    .getByRole('radio', { name: '淺色', exact: true })
    .click()
}

test('several pictures of ones own are kept, chosen, set apart, removed and kept across a restart', async () => {
  test.setTimeout(240000)
  const root = await mkdtemp(join(tmpdir(), 'yuki-saved-backdrops-'))
  const desktop = await isolatedDesktop(root)
  let app = await desktop.launch('profile')
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    const lineart = await picture(page, 'lineart'),
      gradient = await picture(page, 'gradient')
    const paths = { lineart: join(root, 'lineart.png'), gradient: join(root, 'gradient.png') }
    await writeFile(paths.lineart, lineart)
    await writeFile(paths.gradient, gradient)
    const ids = { lineart: sha(lineart), gradient: sha(gradient) }
    await appearance(page)
    let pictures = page.getByRole('radiogroup', { name: '對話背景', exact: true })

    // 1: the first picture, from the picker's own tile.
    await answerWith(app, paths.lineart)
    await page.getByRole('button', { name: '加入圖片…', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).toBe(`custom:${ids.lineart}`)
    await expect(pictures.getByRole('radio', { name: '自訂圖片 1', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
    // A quick fit and dim change must compose even before the first save returns.
    const dim = page.getByRole('slider', { name: '變暗', exact: true })
    await dim.focus()
    await page
      .getByRole('radiogroup', { name: '顯示方式', exact: true })
      .getByRole('radio', { name: '並排', exact: true })
      .evaluate((button) => {
        ;(button as HTMLButtonElement).click()
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
        )
      })
    await expect
      .poll(async () => (await preferences(page)).customBackdrops)
      .toEqual([{ light: ids.lineart, fit: 'tile', blur: 0, dim: 60 }])

    // Import and selection are separate IPC calls. A theme save between them must leave
    // the newly stored picture available for selection.
    const staged = await page.evaluate(
      async (bytes) => {
        const original = Uint8Array.from(bytes)
        const image = await createImageBitmap(new Blob([original]))
        const canvas = new OffscreenCanvas(image.width, image.height)
        canvas.getContext('2d')!.drawImage(image, 0, 0)
        const copy = new Uint8Array(
          await (await canvas.convertToBlob({ type: 'image/webp' })).arrayBuffer(),
        )
        const result = await window.yuki.backgrounds.store(original, copy, { average: '#808080' })
        await window.yuki.preferences({ theme: 'light' })
        return result
      },
      [...gradient],
    )
    expect(staged).toMatchObject({ ok: true, value: ids.gradient })
    expect(await files(app)).toContain(`${ids.gradient}.webp`)

    // 1: a second, from 「選擇圖片…」, kept beside the first and chosen.
    await answerWith(app, paths.gradient)
    await page.getByRole('button', { name: '選擇圖片…', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).toBe(`custom:${ids.gradient}`)
    expect((await preferences(page)).customBackdrops).toEqual([
      { light: ids.lineart, fit: 'tile', blur: 0, dim: 60 },
      { light: ids.gradient, fit: 'fill', blur: 0, dim: 0 },
    ])
    await expect(pictures.getByRole('radio', { name: '自訂圖片 2', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect.poll(() => variable(page, '--backdrop-image')).toContain(`${ids.gradient}.webp`)
    expect(await variable(page, '--backdrop-size')).toBe('cover')
    expect(await variable(page, '--backdrop-dim')).toBe('0%')
    // The same picture again is the one kept, chosen.
    await answerWith(app, paths.lineart)
    await page.getByRole('button', { name: '選擇圖片…', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).toBe(`custom:${ids.lineart}`)
    expect((await preferences(page)).customBackdrops).toHaveLength(2)
    await pictures.getByRole('radio', { name: '自訂圖片 2', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).toBe(`custom:${ids.gradient}`)
    await expect(pictures.getByRole('radio', { name: '自訂圖片 2', exact: true })).toBeChecked()
    // 3: the second's blur and dark picture are its own.
    const blur = page.getByRole('slider', { name: '背景模糊', exact: true })
    await blur.press('End')
    await expect.poll(async () => (await preferences(page)).customBackdrops[1]!.blur).toBe(20)
    await page.getByRole('switch', { name: '淺色與深色分別設定', exact: true }).click()
    await answerWith(app, paths.lineart)
    await page.getByRole('button', { name: '選擇深色圖片…', exact: true }).click()
    const both = [
      { light: ids.lineart, fit: 'tile', blur: 0, dim: 60 },
      { light: ids.gradient, dark: ids.lineart, fit: 'fill', blur: 20, dim: 0 },
    ]
    await expect.poll(async () => (await preferences(page)).customBackdrops).toEqual(both)
    await expect
      .poll(() => variable(page, '--backdrop-image'))
      .toContain(`${ids.gradient}-blur20.webp`)
    await page.screenshot({ path: test.info().outputPath('two-kept.png') })

    // 2: back to the first, at once, with its own settings.
    await pictures.getByRole('radio', { name: '自訂圖片 1', exact: true }).click()
    await expect.poll(() => variable(page, '--backdrop-image')).toContain(`${ids.lineart}.webp`)
    expect(await variable(page, '--backdrop-size')).toBe('auto')
    expect(await variable(page, '--backdrop-dim')).toBe('60%')
    await expect(page.getByRole('slider', { name: '背景模糊', exact: true })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    await expect(
      page.getByRole('switch', { name: '淺色與深色分別設定', exact: true }),
    ).toHaveAttribute('aria-checked', 'false')
    const kept = await files(app)
    evidence.kept = kept
    expect(kept).toEqual(
      [
        `${ids.lineart}.png`,
        `${ids.lineart}.webp`,
        `${ids.lineart}.json`,
        `${ids.lineart}-blur20.webp`,
        `${ids.gradient}.png`,
        `${ids.gradient}.webp`,
        `${ids.gradient}.json`,
        `${ids.gradient}-blur20.webp`,
      ].sort(),
    )

    // 4
    await app.close()
    app = await desktop.launch('profile')
    page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    expect(await preferences(page)).toMatchObject({
      backdrop: `custom:${ids.lineart}`,
      customBackdrops: both,
    })
    await expect.poll(() => variable(page, '--backdrop-image')).toContain(`${ids.lineart}.webp`)
    await appearance(page)
    pictures = page.getByRole('radiogroup', { name: '對話背景', exact: true })

    // 5: the second, from its thumbnail's own remove control.
    await pictures.getByRole('radio', { name: '自訂圖片 2', exact: true }).hover()
    await page.getByRole('button', { name: '移除自訂圖片 2', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).customBackdrops).toEqual([both[0]])
    expect((await preferences(page)).backdrop).toBe(`custom:${ids.lineart}`)
    // The first keeps its own files; the second's own (its original and copies) are gone, and
    // the blurred copy of the first's picture made only for the second's blur.
    await expect
      .poll(() => files(app))
      .toEqual([`${ids.lineart}.png`, `${ids.lineart}.webp`, `${ids.lineart}.json`].sort())
    // The chosen one, removed: the default backdrop again, and nothing left on disk.
    await page.getByRole('button', { name: '移除自訂背景', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).toBe('plain')
    expect((await preferences(page)).customBackdrops).toEqual([])
    await expect.poll(() => files(app)).toEqual([])
    await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'plain')

    // 6
    const invalid = await page.evaluate(
      async (id) =>
        (
          await window.yuki.preferences({
            backdrop: 'custom:../../escape',
            customBackdrops: [
              { light: '../../escape', fit: 'fill', blur: 0, dim: 0 },
              { light: id, fit: 'zoom', blur: 99, dim: -3 },
            ],
          } as never)
        ).customBackdrops,
      ids.lineart,
    )
    evidence.invalid = invalid
    // The picture's files are gone: nothing names a picture that is not kept.
    expect(invalid).toEqual([])
    expect((await preferences(page)).backdrop).toBe('plain')
  } finally {
    await app.close()
  }
})

test('a single picture of ones own from before becomes the first kept, chosen as it was', async () => {
  test.setTimeout(180000)
  const root = await mkdtemp(join(tmpdir(), 'yuki-saved-backdrops-migration-'))
  const desktop = await isolatedDesktop(root)
  let app = await desktop.launch('profile')
  try {
    let page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
    const lineart = await picture(page, 'lineart'),
      path = join(root, 'lineart.png')
    await writeFile(path, lineart)
    const id = sha(lineart)
    // The picture's files, as the app keeps them.
    await appearance(page)
    await answerWith(app, path)
    await page.getByRole('button', { name: '加入圖片…', exact: true }).click()
    await expect.poll(async () => (await preferences(page)).backdrop).toBe(`custom:${id}`)
    const data = await app.evaluate(({ app }) => app.getPath('userData'))
    await app.close()
    // The preference as it was kept before several pictures could be.
    const before = {
      keepInTray: false,
      theme: 'light',
      backdrop: 'custom',
      customBackdrop: { light: id, dark: id, fit: 'tile', blur: 0, dim: 30 },
    }
    const db = new Database(join(data, 'desktop.sqlite3'))
    db.prepare("UPDATE preferences SET value=? WHERE key='appearance'").run(JSON.stringify(before))
    db.close()
    app = await desktop.launch('profile')
    page = await app.firstWindow()
    const migrated = await preferences(page)
    evidence.migrated = migrated
    expect(migrated).toMatchObject({
      backdrop: `custom:${id}`,
      customBackdrops: [{ light: id, dark: id, fit: 'tile', blur: 0, dim: 30 }],
    })
    expect(migrated).not.toHaveProperty('customBackdrop')
    await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
    await expect.poll(() => variable(page, '--backdrop-image')).toContain(`${id}.webp`)
    expect(await variable(page, '--backdrop-dim')).toBe('30%')
    // Kept as such once anything is saved again; the old field is not written back.
    await page.evaluate(() => window.yuki.preferences({ theme: 'light' }))
    await app.close()
    const after = new Database(join(data, 'desktop.sqlite3'), { readonly: true })
    const row = after.prepare("SELECT value FROM preferences WHERE key='appearance'").get() as {
      value: string
    }
    after.close()
    const saved = JSON.parse(row.value) as Record<string, unknown>
    evidence.stored = saved
    expect(saved).not.toHaveProperty('customBackdrop')
    expect(saved.customBackdrops).toEqual([{ light: id, dark: id, fit: 'tile', blur: 0, dim: 30 }])
    // Not migrated: a profile that chose a pattern keeps it, its old picture kept but not chosen.
    const db2 = new Database(join(data, 'desktop.sqlite3'))
    db2
      .prepare("UPDATE preferences SET value=? WHERE key='appearance'")
      .run(JSON.stringify({ ...before, backdrop: 'aurora' }))
    db2.close()
    app = await desktop.launch('profile')
    page = await app.firstWindow()
    expect(await preferences(page)).toMatchObject({
      backdrop: 'aurora',
      customBackdrops: [{ light: id, dark: id, fit: 'tile', blur: 0, dim: 30 }],
    })
  } finally {
    await app.close()
  }
})
