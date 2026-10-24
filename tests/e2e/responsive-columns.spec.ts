import { activeCharacterName } from '../fixtures/active-character'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { captureViewport, contentSize } from '../fixtures/visual'

const sidebar = (page: Page) => page.getByRole('separator', { name: '調整側邊欄', exact: true })
const inspector = (page: Page) => page.getByRole('separator', { name: '調整檢視器', exact: true })
async function drag(page: Page, handle: Locator, dx: number) {
  const bounds = await handle.boundingBox()
  expect(bounds).not.toBeNull()
  const x = bounds!.x + bounds!.width / 2,
    y = bounds!.y + 150
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 8 })
  await page.mouse.up()
}
test('real clamped columns move four visible pixels per key and stop an unfinished drag when its pane closes', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture(),
    app = await rig.launch('responsive-keys')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await contentSize(app, page, 1440, 900)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.focus())
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFocused()),
      )
      .toBe(true)
    await page.evaluate(() => {
      const records: unknown[] = []
      ;(window as Window & { __yukiColumnProbe?: unknown[] }).__yukiColumnProbe = records
      for (const kind of [
        'pointerdown',
        'pointermove',
        'gotpointercapture',
        'lostpointercapture',
        'pointerup',
        'pointercancel',
        'blur',
        'resize',
      ]) {
        window.addEventListener(
          kind,
          (event) => {
            if (records.length >= 100) return
            const target = event.target
            records.push({
              kind,
              at: performance.now(),
              width: innerWidth,
              windowTarget: target === window,
              target:
                target instanceof Element
                  ? (target.getAttribute('aria-label') ?? target.tagName)
                  : '',
              connected: target instanceof Element ? target.isConnected : undefined,
            })
          },
          true,
        )
      }
    })
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await drag(page, inspector(page), -400)
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '560')
    await drag(page, sidebar(page), 400)
    await expect(sidebar(page)).toHaveAttribute('aria-valuenow', '320')
    await contentSize(app, page, 1180, 800)
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '334')
    await inspector(page).focus()
    await page.keyboard.press('ArrowRight')
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '330')
    await expect
      .poll(async () => (await page.locator('[data-region="content"]').boundingBox())!.width)
      .toBe(524)
    await page.keyboard.press('ArrowLeft')
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '334')
    await page.keyboard.press('ArrowLeft')
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '334')
    await contentSize(app, page, 1440, 900)
    await sidebar(page).dblclick()
    await inspector(page).dblclick()
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '380')
    const bounds = (await inspector(page).boundingBox())!,
      x = bounds.x + bounds.width / 2,
      y = bounds.y + 150
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 12, y, { steps: 4 })
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '392')
    await page.keyboard.press('Escape')
    await expect(inspector(page)).toHaveCount(0)
    await page.mouse.move(x - 100, y, { steps: 4 })
    await page.mouse.up()
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '392')
    await page.screenshot({ path: test.info().outputPath('stopped-column-drag.png') })
    success = true
  } finally {
    const page = await app.firstWindow().catch(() => undefined)
    if (page) {
      const records = await page
        .evaluate(
          () => (window as Window & { __yukiColumnProbe?: unknown[] }).__yukiColumnProbe ?? [],
        )
        .catch(() => [])
      await writeFile(
        test.info().outputPath('column-pointer-events.json'),
        JSON.stringify(records, null, 2),
      )
    }
    await app.close()
    await rig.close(success)
  }
})

test('native large work area uses automatic 440 and retains manual choices and reset through restart', async () => {
  test.setTimeout(90000)
  const rig = await yukiFixture()
  let app = await rig.launch('responsive-large'),
    success = false
  try {
    const displays = await app.evaluate(({ screen }) =>
      screen.getAllDisplays().map(({ workArea, scaleFactor }) => ({ workArea, scaleFactor })),
    )
    const large = displays.find(({ workArea }) => workArea.width >= 1920 && workArea.height >= 900)
    await writeFile(
      test.info().outputPath('native-work-areas.json'),
      JSON.stringify(displays, null, 2),
    )
    if (!large) {
      success = true
      test.skip(
        true,
        'No native work area fits the 1920 × 900 acceptance window; VM sizing is verified separately.',
      )
    }
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await app.evaluate(
      ({ BrowserWindow }, area) => BrowserWindow.getAllWindows()[0]!.setPosition(area.x, area.y),
      large!.workArea,
    )
    await contentSize(app, page, 1920, 900)
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '440')
    await inspector(page).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '444')
    await contentSize(app, page, 1440, 900)
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '444')
    await contentSize(app, page, 1920, 900)
    await inspector(page).dblclick()
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '440')
    await contentSize(app, page, 1440, 900)
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '380')
    await contentSize(app, page, 1920, 900)
    const dpr = await page.evaluate(() => devicePixelRatio),
      theme = await page.locator('html').getAttribute('data-theme')
    await page.screenshot({
      path: test
        .info()
        .outputPath(`${process.platform}-${dpr}x-${theme}-columns-auto-1920x900.png`),
    })
    await app.close()
    app = await rig.launch('responsive-large')
    page = await app.firstWindow()
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1920)
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(inspector(page)).toHaveAttribute('aria-valuenow', '440')
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('small emulated viewport survives capture and keeps actual settings controls usable without changing native minimums', async () => {
  test.setTimeout(60000)
  const rig = await yukiFixture(),
    app = await rig.launch('responsive-short')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await contentSize(app, page, 1100, 760)
    const minimum = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.getMinimumSize(),
    )
    expect(await contentSize(app, page, 960, 492)).toBe('electron-device-emulation')
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const frame = await captureViewport(
      app,
      page,
      test.info().outputPath('settings-960x492-emulated.png'),
    )
    const dpr = await page.evaluate(() => devicePixelRatio)
    expect([frame.readUInt32BE(16), frame.readUInt32BE(20)]).toEqual([960 * dpr, 492 * dpr])
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([960, 492])
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize()),
    ).toEqual(minimum)
    await page.getByRole('radio', { name: '深色', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(
      page.getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` }),
    ).toBeInViewport({
      ratio: 1,
    })
    await contentSize(app, page, 1100, 760)
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('browser VM independently exercises the large breakpoint and explicit reset through real controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1200 })
  await page.goto('http://127.0.0.1:4178/components.html')
  await page.getByRole('button', { name: '檢視器', exact: true }).click()
  await expect(inspector(page)).toHaveAttribute('aria-valuenow', '440')
  await inspector(page).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(inspector(page)).toHaveAttribute('aria-valuenow', '444')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(inspector(page)).toHaveAttribute('aria-valuenow', '444')
  await inspector(page).dblclick()
  await expect(inspector(page)).toHaveAttribute('aria-valuenow', '380')
  await page.setViewportSize({ width: 1920, height: 1200 })
  await expect(inspector(page)).toHaveAttribute('aria-valuenow', '440')
  await writeFile(
    test.info().outputPath('browser-vm.json'),
    JSON.stringify(
      {
        verification: 'browser-vm',
        viewport: page.viewportSize(),
        dpr: await page.evaluate(() => devicePixelRatio),
      },
      null,
      2,
    ),
  )
  await page.screenshot({ path: test.info().outputPath('browser-vm-columns-1920x1200.png') })
})
