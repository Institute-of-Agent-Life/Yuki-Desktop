import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { picture } from '../fixtures/pictures'
import { contentSize } from '../fixtures/visual'

/*
 * The shapes of macOS 26: every control a capsule (or a circle, where it is as wide as it is
 * tall), every container a large rounded rectangle. On every page and popup, light and dark, over a
 * picture of one's own and over the plain page, fails when:
 *   1. a control (a button of any kind, a select, a text or search field, a tab, a radio, a
 *      segmented control and its chosen segment, a badge or any other filled thing under 40pt tall)
 *      has corners smaller than half its height (a clickable row or card 40pt or taller is a
 *      container);
 *   2. a container (anything 40pt or taller drawn with a fill, an edge, frost or glass: a settings
 *      group, a Work row or card, an inspector card, an empty state, a file's preview, a frost
 *      block, a popover, a menu, a dialog) has corners smaller than the smallest container radius
 *      (`--r-container-s`, 18pt) or half its height.
 * Not counted, each for its reason: what fills the window or a whole column of it (the window's
 * own corners are the system's); the floating sidebar, whose corner is concentric with the
 * window's (`--r-pane`); a check box (macOS draws a rounded square); the scroll edge's fade under
 * the toolbar (an effect with no outline); hairlines; pictures and media themselves (the
 * content, inside a rounded frame).
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(test.info().outputPath('shapes.json'), JSON.stringify(evidence, null, 2) + '\n')
})

async function square(page: Page, name: string) {
  await page.waitForTimeout(700)
  const found = await page.evaluate(() => {
    const smallest = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--r-container-s'),
    )
    const controls =
      'button:not([role="switch"]), select, input:not([type="checkbox"], [type="radio"], [type="range"], [type="file"], [type="hidden"], [type="color"]), [role="tab"], [role="radio"], [role="tablist"], [role="radiogroup"], [data-glass="segment"]'
    const drawn = (node: Element) => {
      const style = getComputedStyle(node)
      const alpha = (colour: string) => {
        if (colour === 'transparent') return 0
        const values = colour.match(/[\d.]+/g)!.map(Number)
        return colour.includes('/') || colour.startsWith('rgba') ? values.at(-1)! : 1
      }
      return (
        alpha(style.backgroundColor) > 0.02 ||
        style.backgroundImage !== 'none' ||
        (style.borderTopStyle !== 'none' &&
          parseFloat(style.borderTopWidth) > 0 &&
          alpha(style.borderTopColor) > 0.02 &&
          style.borderBottomStyle !== 'none') ||
        style.backdropFilter !== 'none'
      )
    }
    const out: string[] = []
    for (const node of document.querySelectorAll<HTMLElement>('body *')) {
      if (!node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
      if (node.closest('[inert], svg, [data-edge-fade]')) continue
      if (['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'svg', 'PRE', 'CODE'].includes(node.tagName))
        continue
      if (node.matches('input[type="checkbox"], [role="switch"] *, [data-region="sidebar"]'))
        continue
      const r = node.getBoundingClientRect()
      if (r.width < 6 || r.height < 6) continue
      if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue
      // What fills the window or a whole column of it.
      if (r.height >= innerHeight - 60 || r.width >= innerWidth - 60) continue
      const control = node.matches(controls)
      if (!control && !drawn(node)) continue
      // A control drawn by nothing of its own (a row's link, a bare icon) has no shape to show.
      if (control && !drawn(node) && !node.matches('[role="tablist"], [role="radiogroup"]'))
        continue
      if (node.matches('[role="tablist"], [role="radiogroup"]') && !drawn(node)) continue
      const radius = Math.min(
        ...['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(
          (corner) =>
            parseFloat(getComputedStyle(node)[`border${corner}Radius` as 'borderTopLeftRadius']) ||
            0,
        ),
      )
      const capsule = r.height / 2 - 0.5
      // (A control 40pt or taller is a row or a card: a container.)
      const least = r.height < 40 ? capsule : Math.min(smallest, capsule)
      if (radius < least)
        out.push(
          `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]?.slice(0, 40)} "${(node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)} r${radius}<${Math.ceil(least)}`,
        )
    }
    return out
  })
  evidence[name] = found
  return found.map((line) => `${name}: ${line}`)
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
async function theme(page: Page, name: '淺色' | '深色') {
  await settings(page, '外觀')
  await page
    .getByRole('radiogroup', { name: '主題', exact: true })
    .getByRole('radio', { name, exact: true })
    .click()
}

async function picked(app: ElectronApplication, page: Page) {
  const path = test.info().outputPath('berries.png')
  await writeFile(path, await picture(page, 'berries'))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, path)
  await settings(page, '外觀')
  await page.getByRole('button', { name: '加入圖片…', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
}

test('every control is a capsule and every container a large rounded rectangle', async () => {
  test.setTimeout(900000)
  await mkdir(test.info().outputPath(), { recursive: true })
  const rig = await yukiFixture({ character: true, computer: process.platform !== 'win32' }),
    app = await rig.launch('shapes')
  let success = false
  try {
    const page = await app.firstWindow()
    await contentSize(app, page, 1100, 760)
    await pairUI(page, rig.base, await rig.code())
    for (let i = 0; i < 3; i++) await fetch(`${rig.base}/__test/work`, { method: 'POST' })
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    const found: string[] = []
    for (const backdrop of ['picture', 'plain'] as const) {
      if (backdrop === 'picture') await picked(app, page)
      else {
        await settings(page, '外觀')
        await page
          .getByRole('radiogroup', { name: '對話背景', exact: true })
          .getByRole('radio', { name: '無', exact: true })
          .click()
      }
      for (const shade of ['淺色', '深色'] as const) {
        await theme(page, shade)
        const scan = async (name: string) => {
          const where = `${backdrop} ${shade} ${name}`
          found.push(...(await square(page, where)))
          await page.screenshot({ path: test.info().outputPath(`${where}.png`) })
        }
        for (const tab of ['一般', '外觀', '通知', '更新', '連線', '平台', '裝置', '這台電腦'])
          await settings(page, tab).then(() => scan(`settings ${tab}`))
        await nav(page, '桌面對話')
        await scan('chat')
        await page.getByRole('button', { name: '搜尋已載入內容', exact: true }).click()
        await scan('search')
        await page.keyboard.press('Escape')
        await page.locator('[aria-haspopup="menu"]').first().click()
        await scan('role menu')
        await page.keyboard.press('Escape')
        await nav(page, '工作')
        await scan('works')
        await page
          .locator('[data-region="content"] button')
          .filter({ hasText: 'Desktop reference work' })
          .first()
          .click()
        await scan('work detail')
        await page.getByRole('button', { name: '取消工作', exact: true }).first().click()
        await scan('cancel dialog')
        await page.keyboard.press('Escape')
        const close = page.locator('[data-region="inspector"]').getByLabel('關閉詳情').first()
        if (await close.isVisible()) await close.click()
        await nav(page, '檔案與成果')
        await scan('files')
        await nav(page, '這台電腦')
        await scan('this computer')
        await nav(page, /^關於/)
        await scan('about')
        const arrange = page.getByRole('tab', { name: '安排', exact: true })
        if (await arrange.count()) await arrange.click()
        await scan('about arrangements')
      }
    }
    evidence.found = found
    expect(found).toEqual([])
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
