import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { pairUI, yukiFixture } from '../fixtures/backend'

// 液态玻璃组件统一任务书 (2026-11-12), step 5, failure cases 18–19, in the real window: whether each
// glass's filter does anything where it lies. Over 3px stripes, a glass is captured from the screen
// as it is and again with its filter taken off; if the two match, the filter did nothing there.
// Probes with the same blur check an area declared to scroll, the sidebar and one really scrolled.

const stripes = 'repeating-linear-gradient(90deg, #000 0 3px, #fff 3px 6px)'

async function capture(app: ElectronApplication, element: Locator, file: string) {
  const box = (await element.boundingBox())!
  const origin = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getContentBounds(),
  )
  const rect = [
    Math.round(origin.x + box.x + 4),
    Math.round(origin.y + box.y + 4),
    Math.max(8, Math.round(box.width - 8)),
    Math.max(8, Math.round(box.height - 8)),
  ]
  await promisify(execFile)('/usr/sbin/screencapture', ['-x', `-R${rect.join(',')}`, file], {
    timeout: 20000,
  })
  return app.evaluate(({ nativeImage }, file) => {
    const image = nativeImage.createFromPath(file),
      bitmap = image.toBitmap({ scaleFactor: 1 })
    const luma: number[] = []
    for (let k = 0; k < bitmap.length; k += 4)
      luma.push(0.0722 * bitmap[k]! + 0.7152 * bitmap[k + 1]! + 0.2126 * bitmap[k + 2]!)
    return luma
  }, file)
}

// How much the glass's own filter changes what is seen through it (0–255 per pixel).
async function effect(app: ElectronApplication, page: Page, element: Locator, name: string) {
  const on = await capture(app, element, test.info().outputPath(`${name}-on.png`))
  await element.evaluate((node: HTMLElement) =>
    node.style.setProperty('backdrop-filter', 'none', 'important'),
  )
  await page.waitForTimeout(250)
  const off = await capture(app, element, test.info().outputPath(`${name}-off.png`))
  await element.evaluate((node: HTMLElement) => node.style.removeProperty('backdrop-filter'))
  await page.waitForTimeout(150)
  const length = Math.min(on.length, off.length)
  let sum = 0
  for (let index = 0; index < length; index++) sum += Math.abs(on[index]! - off[index]!)
  return sum / length
}

async function probe(page: Page, host: string, name: string) {
  await page.evaluate(
    ({ host, name, stripes }) => {
      const parent = document.querySelector<HTMLElement>(host)!
      const ground = document.createElement('div')
      ground.style.cssText = `position:relative;flex-shrink:0;height:64px;width:220px;margin:8px;background:${stripes}`
      const glass = document.createElement('div')
      glass.dataset.probe = name
      glass.style.cssText = 'position:absolute;inset:12px;backdrop-filter:blur(8px) var(--seal,)'
      ground.append(glass)
      parent.prepend(ground)
    },
    { host, name, stripes },
  )
  return page.locator(`[data-probe="${name}"]`)
}

test('every glass in the real window bends what lies behind it', async () => {
  test.skip(process.platform !== 'darwin', 'Requires the macOS compositor')
  test.setTimeout(240000)
  const rig = await yukiFixture()
  const app = await rig.launch('native-glass')
  const effects: Record<string, number> = {}
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0]!
      main.setBounds({ x: 120, y: 120, width: 1100, height: 720 })
      main.moveTop()
      main.focus()
    })
    await page.addStyleTag({
      content: `[data-region="content"] > *, nav[aria-label="主要導覽"], #settings-panel { background-image: ${stripes} !important }`,
    })
    await page.waitForTimeout(800)

    // Real glass in the conversation: the composer and the toolbar's capsules.
    const composer = page.locator('[data-region="composer"]')
    await expect(composer).toHaveAttribute('data-refracting', 'true')
    effects.composer = await effect(app, page, composer, 'composer')
    effects.capsule = await effect(
      app,
      page,
      page.locator('[data-region="toolbar"] [data-glass="toolbar"]').first(),
      'capsule',
    )
    // Probes: at body level, in the conversation's content (declared to scroll, not scrolling),
    // and in the sidebar.
    effects.probeBody = await effect(app, page, await probe(page, 'body', 'body'), 'probe-body')
    effects.probeContent = await effect(
      app,
      page,
      await probe(page, '[data-region="content"]', 'content'),
      'probe-content',
    )
    effects.probeSidebar = await effect(
      app,
      page,
      await probe(page, 'nav[aria-label="主要導覽"]', 'sidebar'),
      'probe-sidebar',
    )

    // Panes in the top layer: the command palette and the Yuki menu.
    await page.getByRole('button', { name: '搜尋已載入內容', exact: true }).click()
    const palette = page.locator('dialog[open][data-glass="sheet"]')
    await expect(palette).toHaveAttribute('data-refracting', 'true')
    await page.waitForTimeout(800)
    effects.palette = await effect(app, page, palette, 'palette')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'Yuki', exact: true })
    await expect(menu).toHaveAttribute('data-refracting', 'true')
    await page.waitForTimeout(800)
    effects.menu = await effect(app, page, menu, 'menu')
    await page.keyboard.press('Escape')

    // A settings page scrolled down: a probe in an area that really scrolls.
    await page.keyboard.press('Meta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const pane = page.locator('#settings-panel')
    const scrolled = await probe(page, '#settings-panel', 'scrolled')
    await pane.evaluate((node) => {
      const above = document.createElement('div'),
        below = document.createElement('div')
      above.style.height = '300px'
      below.style.height = '1600px'
      node.prepend(above)
      node.append(below)
      node.scrollTop = 240
    })
    await page.waitForTimeout(300)
    effects.probeScrolled = await effect(app, page, scrolled, 'probe-scrolled')
    // 18: every glass, wherever it lies (in an area declared to scroll, one really scrolling, or
    // the top layer), changes what is seen through it.
    for (const [name, value] of Object.entries(effects)) expect(value, name).toBeGreaterThan(10)
    success = true
  } finally {
    await writeFile(test.info().outputPath('native-glass.json'), JSON.stringify(effects, null, 2))
    await app.close()
    await rig.close(success)
  }
})
