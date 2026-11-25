import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'
import { picture, type Picture } from '../fixtures/pictures'
import { contrast, throughGlass } from '../fixtures/legibility'

/*
 * The composer's send button is glass of its own, nested in the composer's: at rest (nothing to
 * send, not pressed) the Dock's clear glass, a circle with its own lens and rim and its arrow in
 * the main ink; with something to send (or pressed) tinted glass in the accent, the tint seen
 * through the glass, so the lens and rim still show.
 *
 * Fails when: at rest it is a solid coat (its middle shows the same colour over a dark and a light
 * picture, or the accent's blue), or shows no circle of its own (no rim: nested in the composer's
 * glass, a backdrop filter sees nothing behind it); or with something to send it is a coat (less
 * than 0.4 of what lies behind still shows), not blue, without its rim, or its arrow under 4.5:1.
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('send-glass.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

async function choose(app: ElectronApplication, page: Page, kind: Picture, first: boolean) {
  const path = test.info().outputPath(`${kind}.png`)
  await writeFile(path, await picture(page, kind))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, path)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '外觀', exact: true }).click()
  await page
    .getByRole('radiogroup', { name: '主題', exact: true })
    .getByRole('radio', { name: '淺色', exact: true })
    .click()
  if (first)
    await page
      .getByRole('radiogroup', { name: '對話背景', exact: true })
      .getByRole('radio', { name: '自訂圖片', exact: true })
      .click()
  else await page.getByRole('button', { name: '選擇圖片…', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(1500)
}

/**
 * The send button's pixels: the mean colour of a ring between its arrow and its rim; the brightest
 * of its top's outermost two points and the darkest of its left side's (its rim, by the Dock's law:
 * bright at the top, mixed toward black at the sides); and its arrow's colour.
 */
async function sample(page: Page, name: string) {
  const send = page.getByRole('button', { name: '送出', exact: true })
  await page.mouse.move(5, 5)
  await page.waitForTimeout(800)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  const box = (await send.boundingBox())!
  // (On Windows the first capture of a region after the page has changed can come back half
  // drawn: one is taken and dropped first.)
  await page.screenshot({ clip: box })
  const shot = await page.screenshot({ clip: box })
  await writeFile(test.info().outputPath(`${name}.png`), shot)
  const arrow = await page
    .locator('[data-glass="send"]')
    .evaluate((element) => getComputedStyle(element).color)
  const pixels = await page.evaluate(
    async ({ data, width }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const canvas = new OffscreenCanvas(image.width, image.height),
        context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, image.width, image.height).data
      const scale = image.width / width,
        at = (x: number, y: number) => {
          const k = (y * image.width + x) * 4
          return 0.2126 * pixels[k]! + 0.7152 * pixels[k + 1]! + 0.0722 * pixels[k + 2]!
        }
      const sum = [0, 0, 0]
      let count = 0
      const cx = image.width / 2,
        cy = image.height / 2,
        r = image.width / 2
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
          // Between the arrow and the rim.
          if (d < 0.55 || d > 0.8) continue
          const k = (y * image.width + x) * 4
          for (const c of [0, 1, 2]) sum[c] = sum[c]! + pixels[k + c]!
          count++
        }
      const edge = Math.max(1, Math.round(2 * scale)),
        middle = Math.floor(image.width / 2)
      let top = 0,
        side = 255
      for (let y = 0; y < edge; y++)
        for (let x = middle - edge; x <= middle + edge; x++) top = Math.max(top, at(x, y))
      for (let x = 0; x < edge; x++)
        for (let y = middle - edge; y <= middle + edge; y++) side = Math.min(side, at(x, y))
      return { ring: sum.map((value) => Math.round(value / count)), top, side }
    },
    { data: shot.toString('base64'), width: box.width },
  )
  return {
    ...pixels,
    arrow: arrow
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number),
  }
}

test('the send button is glass of its own: clear at rest, tinted through the glass with something to send', async () => {
  test.setTimeout(300000)
  await mkdir(test.info().outputPath(), { recursive: true })
  const rig = await yukiFixture(),
    app = await rig.launch('send-glass')
  let success = false
  try {
    const page = await app.firstWindow()
    await contentSize(app, page, 1100, 760)
    await pairUI(page, rig.base, await rig.code())
    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
    })
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    test.skip(
      !(await throughGlass(page)).glass,
      'Without transparency there is no glass: the send button is a plain control.',
    )
    // The circle of glass over the send button (Composer.tsx).
    const send = page.locator('[data-glass="send"]')
    const seen: Record<string, Awaited<ReturnType<typeof sample>>> = {}
    // Two greys the light glass shows as such (appearance.ts): level 170 and 235.
    for (const [index, level] of [170, 235].entries()) {
      await choose(app, page, `level-${level}`, index === 0)
      await composer.fill('')
      seen[`rest ${level}`] = await sample(page, `rest-${level}`)
      await composer.fill('送出前')
      seen[`active ${level}`] = await sample(page, `active-${level}`)
      if (index === 0) {
        // Its own lens and rim: glass of its own, over the composer's.
        await expect(send).toHaveAttribute('data-refracting', 'true')
        expect(await send.evaluate((node) => getComputedStyle(node).backdropFilter)).toMatch(
          /url\(/,
        )
      }
    }
    evidence.seen = seen
    const luma = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    const [rest170, rest235, active170, active235] = [
      seen['rest 170']!,
      seen['rest 235']!,
      seen['active 170']!,
      seen['active 235']!,
    ]
    // At rest: what lies behind shows through (the Dock's tone of 170 and 235 lie 45 levels
    // apart), no blue is laid on it, and it is a circle of its own: its rim is bright at the top
    // and darker at the sides than its middle.
    const restShift = luma(rest235.ring) - luma(rest170.ring)
    expect.soft(restShift, 'at rest it follows the backdrop').toBeGreaterThan(25)
    expect.soft(rest170.ring[2]! - rest170.ring[0]!, 'at rest it is not blue').toBeLessThan(12)
    for (const [name, rest] of [
      ['170', rest170],
      ['235', rest235],
    ] as const) {
      expect
        .soft(rest.top - luma(rest.ring), `at rest over ${name}: its top rim`)
        .toBeGreaterThan(12)
      expect
        .soft(luma(rest.ring) - rest.side, `at rest over ${name}: its side rim`)
        .toBeGreaterThan(8)
    }
    // With something to send: blue through the glass, not a coat: what lies behind still shows
    // through at least 0.4 of how it does at rest, its rim still shows at the top, and its arrow
    // keeps 4.5:1 on it.
    expect
      .soft(active170.ring[2]! - active170.ring[0]!, 'active it is tinted blue')
      .toBeGreaterThan(20)
    expect
      .soft(
        (luma(active235.ring) - luma(active170.ring)) / restShift,
        'active it keeps what lies behind',
      )
      .toBeGreaterThanOrEqual(0.4)
    for (const [name, active] of [
      ['170', active170],
      ['235', active235],
    ] as const) {
      expect
        .soft(active.top - luma(active.ring), `active over ${name}: its top rim`)
        .toBeGreaterThan(8)
      expect
        .soft(contrast(active.arrow, active.ring), `active over ${name}: its arrow`)
        .toBeGreaterThanOrEqual(4.5)
    }
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
