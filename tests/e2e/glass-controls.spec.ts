import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { throughGlass } from '../fixtures/frost'
import { picture } from '../fixtures/pictures'
import { contentSize } from '../fixtures/visual'

/*
 * Controls are glass, not flat coats (macOS 26): over a picture of one's own, on every page and in
 * every popup, light and dark, a control shows what lies behind it. Fails when a button of any
 * kind, a select, the chosen segment of a segmented control or any other control has an opaque,
 * even fill: with its ink hidden its face is flat (a spread of a level or less) where what lies
 * behind it there (measured with it hidden) varies (a spread of at least 12 levels: the small
 * glass's lens and blur can smooth a spread of 6–8 down to 1–3); or, over what varies little
 * (content's frost), its face is flat and 60 levels or more from what lies behind (the glass's own
 * tone, and a tint laid through it, move it at most about 45). A toggle's
 * knob is the system's own white and is not counted. Where the window is opaque (no picture is
 * shown) the scan does not apply. Without GPU compositing a frosted content row itself is an
 * opaque fill. Controls over that row are still checked wherever the background varies.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('glass-controls.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

const controls =
  'button:not([role="switch"]), [role="button"], select, [role="tab"][aria-selected="true"], [role="radio"][aria-checked="true"], [data-glass="segment"]'

/** The controls in sight whose face is an even coat over a backdrop that varies. */
async function coats(page: Page, name: string) {
  await page.waitForTimeout(700)
  const found = await page.evaluate((selector) => {
    const list = [...document.querySelectorAll<HTMLElement>(selector)].filter((node) => {
      if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
      if (node.closest('[inert], [aria-hidden="true"]:not([data-glass])')) return false
      const r = node.getBoundingClientRect()
      return (
        r.width >= 16 &&
        r.height >= 14 &&
        r.x >= 0 &&
        r.y >= 0 &&
        r.right <= innerWidth &&
        r.bottom <= innerHeight &&
        document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).includes(node)
      )
    })
    return list.map((node, index) => {
      node.dataset.scan = String(index)
      const r = node.getBoundingClientRect(),
        radius = Math.min(parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0, r.height / 2)
      return {
        index,
        isFrost: node.matches(
          '[data-frost], [data-frost-children] > :not([data-frost-children], [data-glass], dialog, [popover])',
        ),
        fallbackFrost:
          document.documentElement.dataset.gpuCompositing === 'false' &&
          !!node.closest(
            '[data-frost], [data-frost-children] > :not([data-frost-children], [data-glass], dialog, [popover])',
          ),
        label: (node.getAttribute('aria-label') ?? node.textContent ?? node.tagName)
          .trim()
          .slice(0, 30),
        tag: node.tagName.toLowerCase(),
        className: String(node.className).slice(0, 80),
        box: {
          x: r.x + Math.max(3, radius),
          y: r.y + 3,
          w: r.width - 2 * Math.max(3, radius),
          h: r.height - 6,
        },
      }
    })
  }, controls)
  const shot = async (css: string) => {
    const style = await page.addStyleTag({ content: css })
    await page.waitForTimeout(150)
    const png = (await page.screenshot({ animations: 'disabled', caret: 'hide' })).toString(
      'base64',
    )
    await style.evaluate((node) => (node as HTMLElement).remove())
    return png
  }
  const ink =
    '* { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; -webkit-text-fill-color: transparent !important } svg, img, [role="img"] { visibility: hidden !important }'
  const face = await shot(ink),
    behind = await shot(`${ink} [data-scan] { visibility: hidden !important }`)
  const result = await page.evaluate(
    async ({ face, behind, found }) => {
      const read = async (data: string) => {
        const image = await createImageBitmap(
          new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/png' }),
        )
        const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!
        context.drawImage(image, 0, 0)
        return {
          data: context.getImageData(0, 0, image.width, image.height).data,
          width: image.width,
        }
      }
      const [a, b] = [await read(face), await read(behind)]
      const scale = a.width / innerWidth
      const spread = (image: typeof a, box: (typeof found)[number]['box']) => {
        const values: number[] = []
        for (let y = Math.ceil(box.y * scale); y < (box.y + box.h) * scale; y++)
          for (let x = Math.ceil(box.x * scale); x < (box.x + box.w) * scale; x++) {
            const k = (y * image.width + x) * 4
            values.push(
              0.2126 * image.data[k]! + 0.7152 * image.data[k + 1]! + 0.0722 * image.data[k + 2]!,
            )
          }
        if (values.length < 8) return undefined
        values.sort((p, q) => p - q)
        // The spread between the 5th and 95th percentile (a coat's edge pixels do not count), and
        // the mean.
        return {
          spread:
            values[Math.floor(values.length * 0.95)]! - values[Math.floor(values.length * 0.05)]!,
          mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        }
      }
      for (const node of document.querySelectorAll<HTMLElement>('[data-scan]'))
        delete node.dataset.scan
      return found.flatMap((control) => {
        if (control.box.w < 4 || control.box.h < 4) return []
        const own = spread(a, control.box),
          under = spread(b, control.box)
        if (own === undefined || under === undefined) return []
        return [
          {
            ...control,
            face: Math.round(own.spread),
            behind: Math.round(under.spread),
            shift: Math.round(own.mean - under.mean),
          },
        ]
      })
    },
    { face, behind, found },
  )
  const flat = result.filter(
    (control) =>
      control.face <= 1 &&
      (control.fallbackFrost
        ? control.behind >= 12 && !control.isFrost
        : control.behind >= 12 || Math.abs(control.shift) >= 60),
  )
  evidence[name] = { measured: result.length, controls: result, flat }
  return flat.map((control) => `${name}: ${control.tag} "${control.label}" (${control.className})`)
}

async function nav(page: Page, label: string | RegExp) {
  if (await page.locator('#settings-panel').count())
    await page.getByRole('button', { name: '返回', exact: true }).click()
  const toggle = page.locator('[data-region="toolbar"] [data-toggle="sidebar"]')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await page
    .locator('[data-region="sidebar"]')
    .getByText(label, { exact: typeof label === 'string' })
    .first()
    .click()
}
async function settings(page: Page, tab: string) {
  if (!(await page.locator('#settings-panel').count())) await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: tab, exact: true }).click()
}

async function choose(app: ElectronApplication, page: Page) {
  const path = test.info().outputPath('berries.png')
  await writeFile(path, await picture(page, 'berries'))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, path)
  await settings(page, '外觀')
  await page.getByRole('button', { name: '加入圖片…', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
}

test('every control is glass over a picture of ones own, on every page and popup', async () => {
  test.setTimeout(600000)
  await mkdir(test.info().outputPath(), { recursive: true })
  const rig = await yukiFixture({ character: true, computer: process.platform !== 'win32' }),
    app = await rig.launch('glass-controls')
  let success = false
  try {
    const page = await app.firstWindow()
    await contentSize(app, page, 1100, 760)
    await pairUI(page, rig.base, await rig.code())
    for (let i = 0; i < 3; i++) await fetch(`${rig.base}/__test/work`, { method: 'POST' })
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    await choose(app, page)
    test.skip(!(await throughGlass(page)).glass, 'Without transparency no picture is shown.')
    const flat: string[] = []
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.yuki.preferences({ theme }), theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const scan = async (name: string) => {
        flat.push(...(await coats(page, `${name} ${theme}`)))
        await page.screenshot({ path: test.info().outputPath(`${name}-${theme}.png`) })
      }
      for (const tab of ['一般', '外觀', '通知', '更新', '連線', '平台', '裝置', '這台電腦']) {
        await settings(page, tab)
        await scan(`settings ${tab}`)
      }
      await nav(page, '桌面對話')
      await scan('chat')
      await page.getByRole('button', { name: '搜尋已載入內容', exact: true }).click()
      await scan('search')
      await page.keyboard.press('Escape')
      await nav(page, '工作')
      await scan('works')
      await page
        .locator('[data-region="content"] button')
        .filter({ hasText: 'Desktop reference work' })
        .first()
        .click()
      await scan('work detail')
      const close = page.locator('[data-region="inspector"]').getByLabel('關閉詳情').first()
      if (await close.isVisible()) await close.click()
      await nav(page, '檔案與成果')
      await scan('files')
      await nav(page, '這台電腦')
      await scan('this computer')
      await nav(page, /^關於/)
      await scan('about')
    }
    evidence.flat = flat
    expect(flat).toEqual([])
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
