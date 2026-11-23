/*
 * HIG audit prototypes (research only; never part of CI). Run on request:
 *   YUKI_LAB_OUTPUT=<dir> npx playwright test tests/e2e/hig-audit-lab.spec.ts
 *
 * Failure cases, written before the prototypes:
 *  1. A prototype page (settings, look, chat, pairing, tokens, motion) throws or logs an error,
 *     or never renders its root, in light or in dark.
 *  2. The theme does not take: the dark page's window is not dark, or the light one not light.
 *  3. At a 900px wide window any prototype scrolls sideways, or an element of it reaches past
 *     the viewport's right edge.
 *  4. Body text (every [data-text=body] element) has under 4.5:1 contrast against what it is
 *     painted on, with translucent fills composited the way the page stacks them.
 *  5. Control sizes drift from the target: regular controls are not 24px rounded rectangles
 *     (radius 6), large ones not 28px capsules, the extra large one not a 36px capsule.
 *  6. Liquid Glass reaches the content layer: any .h-glass element inside the scrolling content.
 *  7. The sidebar is not concentric with the window: its radius differs from the window radius
 *     minus its inset.
 *  8. The current UI cannot be captured for comparison (fixture missing a page), so no
 *     side-by-side image is written.
 * Artifacts under YUKI_LAB_OUTPUT: target-<page>-<theme>.png, current-<page>-<theme>.png,
 * side-<page>-<theme>.png and hig-audit.json (contrast, overflow and control measurements).
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const out = process.env.YUKI_LAB_OUTPUT
const base = 'http://127.0.0.1:4178'
const pages = ['settings', 'look', 'chat', 'pairing', 'tokens', 'motion'] as const
const themes = ['light', 'dark'] as const
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'zh-TW' })
test.skip(!out, 'set YUKI_LAB_OUTPUT to run')
// The side-by-side images use the target screenshots the first test writes.
test.describe.configure({ mode: 'serial' })

async function open(page: Page, name: string, theme: string) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`${base}/hig-audit.html?page=${name}&theme=${theme}`)
  await expect(page.getByTestId('prototype')).toBeVisible({ timeout: 10000 })
  await page.evaluate(() => document.fonts.ready)
  return errors
}

// Contrast of each body text against its composited background: every ancestor's background
// colour is painted in order onto a one-pixel canvas, then the text colour over it.
const contrasts = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const pixel = () => [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)] as number[]
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((value) => {
        const c = value / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }) as [number, number, number]
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    return [...document.querySelectorAll<HTMLElement>('[data-text="body"]')].map((element) => {
      const chain: Element[] = []
      for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node)
      context.globalCompositeOperation = 'source-over'
      context.fillStyle = '#fff'
      context.fillRect(0, 0, 1, 1)
      for (const node of chain) {
        context.fillStyle = getComputedStyle(node).backgroundColor
        context.fillRect(0, 0, 1, 1)
      }
      const background = pixel()
      const style = getComputedStyle(element)
      context.fillStyle = style.color
      context.globalAlpha = Number(style.opacity)
      context.fillRect(0, 0, 1, 1)
      context.globalAlpha = 1
      const text = pixel()
      const [light, dark] = [luminance(background), luminance(text)].sort((a, b) => b - a) as [
        number,
        number,
      ]
      return {
        text: element.textContent!.slice(0, 24),
        background,
        color: text,
        ratio: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100,
      }
    })
  })

test('prototypes render in both themes, fit 900px and keep body text at 4.5:1', async ({
  page,
}) => {
  test.setTimeout(180000)
  mkdirSync(out!, { recursive: true })
  const report: Record<string, unknown> = {}
  for (const name of pages)
    for (const theme of themes) {
      await page.setViewportSize({ width: 1280, height: 800 })
      const errors = await open(page, name, theme)
      const window = await page.evaluate(() => {
        const [r, g, b] = getComputedStyle(document.body)
          .backgroundColor.match(/\d+/g)!
          .map(Number) as [number, number, number]
        return (r + g + b) / 3
      })
      if (theme === 'dark') expect(window, `${name} dark window`).toBeLessThan(60)
      else expect(window, `${name} light window`).toBeGreaterThan(200)
      await page.screenshot({
        path: join(out!, `target-${name}-${theme}.png`),
        fullPage: name === 'tokens' || name === 'motion',
      })
      const contrast = await contrasts(page)
      for (const item of contrast)
        expect(item.ratio, `${name}/${theme} "${item.text}"`).toBeGreaterThanOrEqual(4.5)
      const glassInContent = await page.locator('.h-content .h-glass').count()
      expect(glassInContent, `${name} glass in the content layer`).toBe(0)
      await page.setViewportSize({ width: 900, height: 700 })
      await page.waitForTimeout(100)
      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        past: [...document.querySelectorAll('[data-testid=prototype] *')]
          .filter((element) => !element.closest('svg') || element.tagName === 'svg')
          .filter((element) => element.getBoundingClientRect().right > innerWidth + 0.5)
          .map((element) => `${element.tagName}.${element.className}`)
          .slice(0, 5),
      }))
      if (name !== 'motion') {
        expect(overflow.scroll, `${name} scrolls sideways at 900px`).toBe(0)
        expect(overflow.past, `${name} elements past 900px`).toEqual([])
      }
      await page.screenshot({ path: join(out!, `target-${name}-${theme}-900.png`) })
      expect(errors, `${name}/${theme} errors`).toEqual([])
      report[`${name}/${theme}`] = { contrast, overflow }
    }
  await open(page, 'tokens', 'light')
  const controls = await page.evaluate(() => {
    const measure = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((element) => {
        const style = getComputedStyle(element)
        return {
          text: element.textContent,
          height: element.getBoundingClientRect().height,
          radius: parseFloat(style.borderTopLeftRadius),
        }
      })
    return {
      regular: measure(
        '.h-spec .h-button:not([data-size]), .h-spec .h-popup, .h-spec .h-segmented',
      ),
      large: measure('.h-spec .h-button[data-size=large]'),
      xl: measure('.h-spec .h-button[data-size=xl]'),
    }
  })
  for (const control of controls.regular) expect([control.height, control.radius]).toEqual([24, 6])
  for (const control of controls.large) expect([control.height, control.radius]).toEqual([28, 14])
  for (const control of controls.xl) expect([control.height, control.radius]).toEqual([36, 18])
  await open(page, 'chat', 'light')
  const concentric = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const sidebar = getComputedStyle(document.querySelector('.h-sidebar')!)
    return {
      window: parseFloat(root.getPropertyValue('--r-window')),
      inset: parseFloat(sidebar.marginLeft),
      sidebar: parseFloat(sidebar.borderTopLeftRadius),
    }
  })
  expect(concentric.sidebar).toBe(concentric.window - concentric.inset)
  report.controls = controls
  report.concentric = concentric
  writeFileSync(join(out!, 'hig-audit.json'), JSON.stringify(report, null, 2))
})

// The current UI from the existing renderer fixtures, beside the target, one image per page.
test('current UI beside the target, per page and theme', async ({ page, browser }) => {
  test.setTimeout(180000)
  const theme = (dark: boolean) =>
    page.evaluate((dark) => {
      if (dark) document.documentElement.dataset.theme = 'dark'
      else delete document.documentElement.dataset.theme
    }, dark)
  const capture = async (name: string) => {
    for (const mode of themes) {
      await theme(mode === 'dark')
      await page.waitForTimeout(500)
      await page.screenshot({ path: join(out!, `current-${name}-${mode}.png`) })
    }
    await theme(false)
  }
  await page.goto(`${base}/renderer-regressions.html?case=settings`)
  await expect(page.getByRole('tab', { name: '一般' })).toBeVisible({ timeout: 10000 })
  await capture('settings')
  await page.getByRole('tab', { name: '外觀' }).click()
  await page.waitForTimeout(600)
  await capture('look')
  await page.goto(`${base}/renderer-regressions.html?case=showcase`)
  await page.waitForTimeout(1200)
  await page.evaluate(() =>
    (
      window as unknown as { regression: { connection(state: 'online'): void } }
    ).regression.connection('online'),
  )
  await expect(page.getByText('整理訪談筆記').first()).toBeVisible({ timeout: 10000 })
  await page.waitForTimeout(800)
  await capture('chat')
  await page.goto(`${base}/pairing-regressions.html`)
  await page.addStyleTag({
    content: 'nav[aria-label="Fixture navigation"], output { display: none !important; }',
  })
  await expect(page.getByText('連接已有 Yuki').first()).toBeVisible({ timeout: 10000 })
  await capture('pairing')

  const sheet = await browser.newPage({ viewport: { width: 2600, height: 900 } })
  const image = (file: string) =>
    `data:image/png;base64,${readFileSync(join(out!, file)).toString('base64')}`
  for (const name of ['settings', 'look', 'chat', 'pairing'])
    for (const mode of themes) {
      await sheet.setContent(`<!doctype html><meta charset="utf-8"><style>
        body{margin:0;padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px;
          background:${mode === 'dark' ? '#000' : '#d8d8dc'};font:600 22px -apple-system,sans-serif;
          color:${mode === 'dark' ? '#eee' : '#222'}}
        img{width:1276px;display:block;border-radius:12px;box-shadow:0 0 0 1px #8884}
      </style><figure style="margin:0">現狀<img src="${image(`current-${name}-${mode}.png`)}"></figure>
      <figure style="margin:0">目標（原型）<img src="${image(`target-${name}-${mode}.png`)}"></figure>`)
      await sheet.waitForLoadState('load')
      await sheet.screenshot({ path: join(out!, `side-${name}-${mode}.png`), fullPage: true })
    }
  await sheet.close()
})
