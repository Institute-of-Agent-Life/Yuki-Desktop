import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'

test('records native connected window material boundaries without changing product styles', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('formal-corner-evidence')
  let success = false
  const observations: unknown[] = []
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    async function capture(name: string) {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      )
      observations.push({
        name,
        native: await app.evaluate(({ BrowserWindow, screen }) => {
          const win = BrowserWindow.getAllWindows()[0]!
          return {
            bounds: win.getBounds(),
            content: win.getContentBounds(),
            display: screen.getDisplayMatching(win.getBounds()),
            maximized: win.isMaximized(),
          }
        }),
        dom: await page.evaluate(() => {
          const rect = (element: Element) => {
            const bounds = element.getBoundingClientRect()
            return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
          }
          return {
            viewport: [innerWidth, innerHeight, devicePixelRatio],
            root: Object.fromEntries(
              ['background-color', 'border-radius', 'overflow'].map((key) => [
                key,
                getComputedStyle(document.documentElement).getPropertyValue(key),
              ]),
            ),
            surfaces: Array.from(
              document.querySelectorAll<HTMLElement>(
                '#root > *, [data-glass], [data-region], [role="complementary"]',
              ),
            )
              .filter((element) => element.getBoundingClientRect().width)
              .map((element) => {
                const style = getComputedStyle(element),
                  before = getComputedStyle(element, '::before'),
                  after = getComputedStyle(element, '::after')
                return {
                  tag: element.tagName,
                  class: element.className,
                  region: element.dataset.region,
                  glass: element.dataset.glass,
                  rect: rect(element),
                  position: style.position,
                  borderRadius: style.borderRadius,
                  overflow: style.overflow,
                  background: style.backgroundColor,
                  offsetParent: element.offsetParent?.className,
                  before: {
                    position: before.position,
                    width: before.width,
                    height: before.height,
                    borderRadius: before.borderRadius,
                    background: before.backgroundImage,
                  },
                  after: {
                    position: after.position,
                    width: after.width,
                    height: after.height,
                    borderRadius: after.borderRadius,
                    background: after.backgroundImage,
                  },
                }
              }),
          }
        }),
      })
      await page.screenshot({ path: test.info().outputPath(`${name}.png`), animations: 'disabled' })
      const temporary = await page.addStyleTag({
        content: '#root > main::after { display: none !important; }',
      })
      await expect
        .poll(() =>
          page
            .locator('#root > main')
            .evaluate((element) => getComputedStyle(element, '::after').display),
        )
        .toBe('none')
      await page.screenshot({
        path: test.info().outputPath(`${name}-no-app-frame.png`),
        animations: 'disabled',
      })
      await temporary.evaluate((element) => element.parentNode?.removeChild(element))
      await expect
        .poll(() =>
          page
            .locator('#root > main')
            .evaluate((element) => getComputedStyle(element, '::after').display),
        )
        .not.toBe('none')
    }
    expect((await fetch(`${rig.base}/__test/work`, { method: 'POST' })).status).toBe(200)
    for (const [theme, label] of [
      ['light', '淺色'],
      ['dark', '深色'],
    ] as const) {
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('radio', { name: label, exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await capture(`${theme}-connected-settings`)
      await page.keyboard.press('ControlOrMeta+1')
      await expect(page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })).toBeVisible()
      await capture(`${theme}-connected-chat`)
      await page.keyboard.press('ControlOrMeta+2')
      await page.getByRole('button', { name: /Desktop reference work/ }).click()
      await capture(`${theme}-connected-work-inspector`)
    }
    await writeFile(
      test.info().outputPath('material-observations.json'),
      JSON.stringify(observations, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
