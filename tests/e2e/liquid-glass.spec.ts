import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

const regressions = 'http://127.0.0.1:4178/renderer-regressions.html'
const gallery = 'http://127.0.0.1:4178/components.html'
const evidence: Record<string, unknown> = {}

test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('liquid-glass.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

// Light map alpha along each edge, plus 3px inside the lit edge where the bezel carries light.
function rimLight(pane: Locator) {
  return pane.evaluate(async (element) => {
    const style = getComputedStyle(element)
    const image = new Image()
    image.src = style.getPropertyValue('--rim').match(/url\("?(.*?)"?\)$/)![1]!
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    // Layout size, so a pane still growing in is measured at its own scale.
    const scale = image.width / (element as HTMLElement).offsetWidth
    // Conversation glass bleeds past its bubble; other panes fill their own box.
    const bleed = ['bubble', 'work-card'].includes(element.dataset.glass ?? '')
    const inline = bleed ? parseFloat(style.paddingInlineStart) * scale : 0
    const bottom = image.height - (bleed ? parseFloat(style.paddingBottom) * scale : 0)
    const alpha = (x: number, y: number) =>
      Math.max(
        ...[-1, 0, 1].flatMap((dx) =>
          [-1, 0, 1].map(
            (dy) =>
              context.getImageData(Math.round(x + dx), Math.round(y + dy), 1, 1).data[3]! / 255,
          ),
        ),
      )
    return {
      top: alpha(image.width / 2, 1),
      inside:
        context.getImageData(Math.round(image.width / 2), Math.round(3 * scale) + 1, 1, 1)
          .data[3]! / 255,
      bottom: alpha(image.width / 2, bottom - 2),
      left: alpha(inline + 1, bottom / 2),
      right: alpha(image.width - inline - 2, bottom / 2),
    }
  })
}

async function expectLiquidGlass(name: string, pane: Locator) {
  // 1: refracting glass with the calmed backdrop.
  await expect(pane).toHaveAttribute('data-refracting', 'true', { timeout: 5000 })
  const filter = await pane.evaluate((element) => getComputedStyle(element).backdropFilter)
  expect(filter).toMatch(/url\(/)
  // 3–4: lit from the upper left, with light carried into the bezel.
  const rim = await rimLight(pane)
  evidence[name] = { filter, rim }
  // An evenly lit outline measures about 1 on both ratios.
  expect(rim.bottom).toBeLessThan(rim.top * 0.6)
  expect(rim.right).toBeLessThan(rim.left * 0.75)
  expect(rim.inside).toBeGreaterThan(0.05)
}

// 2: transparency off turns every pane into solid material.
async function expectSolid(page: Page, pane: Locator) {
  await page.evaluate(() => (document.documentElement.dataset.opaque = 'true'))
  await expect(pane).not.toHaveAttribute('data-refracting', 'true')
  expect(await pane.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe('none')
  const alpha = await pane.evaluate((element) => {
    const sample = document.createElement('canvas').getContext('2d')!
    sample.fillStyle = getComputedStyle(element).backgroundColor
    sample.fillRect(0, 0, 1, 1)
    return sample.getImageData(0, 0, 1, 1).data[3]! / 255
  })
  expect(alpha).toBe(1)
  await page.evaluate(() => delete document.documentElement.dataset.opaque)
}

async function brightness(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
) {
  const shot = await page.screenshot({ clip })
  return page.evaluate(async (bytes) => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + bytes
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, image.width, image.height).data
    let sum = 0
    for (let k = 0; k < data.length; k += 4) sum += data[k]! + data[k + 1]! + data[k + 2]!
    return sum / (data.length / 4) / 3
  }, shot.toString('base64'))
}

test('every floating conversation pane is lit, calmed liquid glass that follows the pointer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto(`${regressions}?case=conversation-glass`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() =>
    (
      window as unknown as { regression: { connection(state: 'online'): void } }
    ).regression.connection('online'),
  )
  const composer = page.locator('[data-region="composer"]')
  const panes = {
    composer,
    bubble: page.locator('article[data-event-id="34"] [data-glass="bubble"]'),
    'work-card': page.locator('[data-glass="work-card"]').first(),
  }
  for (const [name, pane] of Object.entries(panes)) {
    await expectLiquidGlass(name, pane)
    expect(await pane.evaluate((element) => getComputedStyle(element).backdropFilter)).toMatch(
      /contrast\(/,
    )
  }
  await page.screenshot({ path: test.info().outputPath('conversation-light.png') })

  // 5: the rim nearest the pointer catches more light.
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  const box = (await composer.boundingBox())!
  const edge = { x: box.x + 60, y: box.y, width: 24, height: 3 }
  await page.mouse.move(5, 5)
  await page.waitForTimeout(100)
  const far = await brightness(page, edge)
  await page.mouse.move(edge.x + 12, edge.y - 4)
  await page.waitForTimeout(100)
  const near = await brightness(page, edge)
  evidence.pointer = { far, near }
  expect(near).toBeGreaterThan(far + 3)
  await page.screenshot({ path: test.info().outputPath('conversation-dark-lit.png') })

  // 7: the calmed backdrop under the composer has less contrast than without calming.
  const under = { x: box.x + 4, y: box.y + 2, width: box.width - 8, height: 4 }
  const spread = async () => {
    const shot = await page.screenshot({ clip: under })
    return page.evaluate(async (bytes) => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + bytes
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, image.width, image.height).data
      const values: number[] = []
      for (let k = 0; k < data.length; k += 4) values.push(data[k]! + data[k + 1]! + data[k + 2]!)
      values.sort((a, b) => a - b)
      return values[Math.floor(values.length * 0.98)]! - values[Math.floor(values.length * 0.02)]!
    }, shot.toString('base64'))
  }
  await page.mouse.move(5, 5)
  const calmed = await spread()
  await page.evaluate(() => document.documentElement.style.setProperty('--glass-calm', 'none'))
  const raw = await spread()
  await page.evaluate(() => document.documentElement.style.removeProperty('--glass-calm'))
  evidence.calm = { calmed, raw }
  expect(calmed).toBeLessThan(raw)

  for (const pane of Object.values(panes)) await expectSolid(page, pane)
})

test('a conversation from another platform ends in a glass notice, not a frosted slab', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto(`${regressions}?case=conversation-glass&readonly=1`)
  const notice = page.locator('[data-floating-footer]')
  await expect(notice.getByText(/這是你在 QQ/)).toBeVisible()
  await expectLiquidGlass('readonly', notice)
  await page.screenshot({ path: test.info().outputPath('readonly-notice.png') })
  await expectSolid(page, notice)
})

test('dialogs, the command palette, pairing and controls share the glass without long tasks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.goto(gallery)
  await page.evaluate(() => {
    const long: number[] = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) long.push(entry.duration)
    }).observe({ type: 'longtask' })
    ;(window as unknown as { longTasks: number[] }).longTasks = long
  })
  await page.getByRole('button', { name: '開啟對話框', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expectLiquidGlass('dialog', dialog)
  // 8: opening the pane builds its lens without a long task.
  const long = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks)
  evidence.dialogLongTasks = long
  expect(long.filter((duration) => duration > 100)).toEqual([])
  await page.screenshot({ path: test.info().outputPath('dialog.png') })
  await expectSolid(page, dialog)
  await page.keyboard.press('Escape')
  for (const kind of ['toggle', 'segment', 'slider'])
    await expectLiquidGlass(kind, page.locator(`[data-glass="${kind}"]`).first())

  await page.goto(`${regressions}?case=palette`)
  const palette = page.locator('dialog[data-glass="sheet"]')
  await expectLiquidGlass('palette', palette)
  await page.screenshot({ path: test.info().outputPath('palette.png') })
  await expectSolid(page, palette)

  await page.goto('http://127.0.0.1:4178/pairing-regressions.html')
  const card = page.locator('[data-glass="card"]')
  await expectLiquidGlass('pairing', card)
  await page.screenshot({ path: test.info().outputPath('pairing.png') })
  await expectSolid(page, card)
})

test('the sidebar keeps its native material with a rim lit from the upper left', async ({
  page,
}) => {
  await page.goto(`${regressions}?case=settings-transition`)
  const sidebar = page.locator('[data-glass="sidebar"]')
  await expect(sidebar).toBeVisible()
  // 9: the same light direction as every refracting pane.
  expect(
    await sidebar.evaluate((element) => getComputedStyle(element, '::before').backgroundImage),
  ).toMatch(/^linear-gradient\(154deg/)
})

test('only panes over moving content disperse, and blue buttons are tinted glass lit like the rest', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto(`${regressions}?case=conversation-glass`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  // Dispersion costs one extra bend, spent only where an edge can cross a moving backdrop.
  const bends = (pane: Locator) =>
    pane.evaluate((element) => {
      const id = getComputedStyle(element).backdropFilter.match(/url\("?#([^")]+)/)![1]!
      return document.getElementById(id)!.querySelectorAll('feDisplacementMap').length
    })
  const composer = page.locator('[data-region="composer"]')
  await expect(composer).toHaveAttribute('data-refracting', 'true')
  const bubble = page.locator('article[data-event-id="34"] [data-glass="bubble"]')
  await expect(bubble).toHaveAttribute('data-refracting', 'true')
  evidence.bends = { composer: await bends(composer), bubble: await bends(bubble) }
  expect(await bends(composer)).toBe(2)
  expect(await bends(bubble)).toBe(1)

  await page.goto(gallery)
  const primary = page.getByRole('button', { name: '開啟對話框', exact: true })
  const rim = (button: Locator) =>
    button.evaluate((node) => ({
      sheen: getComputedStyle(node).backgroundImage,
      edge: getComputedStyle(node, '::before').backgroundImage,
      shown: getComputedStyle(node, '::before').display,
    }))
  const lit = await rim(primary)
  evidence.tinted = lit
  expect(lit.sheen).toMatch(/^linear-gradient/)
  expect(lit.edge).toMatch(/radial-gradient.*linear-gradient\(154deg/)
  // The rim nearest the pointer catches more light, as on clear glass.
  const box = (await primary.boundingBox())!
  const edge = { x: box.x + box.width - 14, y: box.y, width: 8, height: 2 }
  await page.mouse.move(5, 5)
  await page.waitForTimeout(100)
  const far = await brightness(page, edge)
  await page.mouse.move(edge.x + 4, edge.y - 6)
  await page.waitForTimeout(100)
  const near = await brightness(page, edge)
  evidence.tintedPointer = { far, near }
  expect(near).toBeGreaterThan(far + 3)
  expect((await rim(page.getByRole('button', { name: '停用', exact: true }))).shown).toBe('none')
})
