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
  await expect(pane).toHaveAttribute('data-refracting', 'true')
  const filter = await pane.evaluate((element) => getComputedStyle(element).backdropFilter)
  expect(filter).toMatch(/url\(/)
  // 3–4, as revised by the 苹果式打光 task book: lit from the upper left with a softer glow on the
  // far edge, in a thin line rather than a band.
  const rim = await rimLight(pane)
  evidence[name] = { filter, rim }
  // An evenly lit outline measures about 1 on both ratios.
  expect(rim.bottom).toBeLessThan(rim.top)
  expect(rim.bottom).toBeGreaterThanOrEqual(rim.top * 0.35)
  expect(rim.right).toBeLessThan(rim.left * 0.75)
  expect(rim.inside).toBeLessThan(rim.top * 0.4)
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
  await expectLiquidGlass('composer', composer)
  expect(await composer.evaluate((element) => getComputedStyle(element).backdropFilter)).toMatch(
    /contrast\(/,
  )
  // Q1 of the 液态玻璃组件统一 task book: bubbles and work cards are content, with no lens.
  for (const content of [
    page.locator('article[data-event-id="34"] [data-glass="bubble"]'),
    page.locator('[data-glass="work-card"]').first(),
  ])
    await expect(content).toHaveCSS('backdrop-filter', 'none')
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

  await expectSolid(page, composer)
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
  // 1, as revised by the 液态玻璃组件统一 task book: a control is glass while it is held.
  for (const [kind, control] of [
    ['toggle', page.getByRole('switch').first()],
    [
      'segment',
      page.locator('[data-glass="segment"]').first().locator('..').locator('button').first(),
    ],
    ['slider', page.getByRole('slider').first()],
  ] as const) {
    const box = (await control.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await expectLiquidGlass(kind, page.locator(`[data-glass="${kind}"]`).first())
    await page.mouse.up()
  }

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
  // 9: the same light direction as every refracting pane; with no light map of its own the
  // native sidebar draws that rim, which refracting glass never does.
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
  // Dispersion costs a red and a blue bend, spent only where an edge can cross a moving backdrop.
  const bends = (pane: Locator) =>
    pane.evaluate((element) => {
      const id = getComputedStyle(element).backdropFilter.match(/url\("?#([^")]+)/)![1]!
      return document.getElementById(id)!.querySelectorAll('feDisplacementMap').length
    })
  const composer = page.locator('[data-region="composer"]')
  await expect(composer).toHaveAttribute('data-refracting', 'true')
  const bubble = page.locator('article[data-event-id="34"] [data-glass="bubble"]')
  evidence.bends = { composer: await bends(composer) }
  expect(await bends(composer)).toBe(3)
  // Content bends nothing at all (Q1 of the 液态玻璃组件统一 task book).
  await expect(bubble).toHaveCSS('backdrop-filter', 'none')

  await page.goto(gallery)
  const primary = page.getByRole('button', { name: '開啟對話框', exact: true })
  const rim = (button: Locator) =>
    button.evaluate((node) => ({
      fill: getComputedStyle(node).backgroundImage,
      edge: getComputedStyle(node, '::before').backgroundImage,
      shown: getComputedStyle(node, '::before').display,
    }))
  const lit = await rim(primary)
  evidence.tinted = lit
  // One flat fill: depth comes from the rim light, never from a gradient in the colour.
  expect(lit.fill).toBe('none')
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
  // Any character's accent, in either theme, leaves white text at least 4.5:1 on the fill.
  const contrast = await page.evaluate(async () => {
    const accents = [
      '#3a6bd6',
      '#7fa4ff',
      '#2e8b57',
      '#6fd39a',
      '#c93c78',
      '#ff8fbf',
      '#b8860b',
      '#ffd166',
      '#0e9aa7',
      '#5fe0e8',
      '#7b4fd6',
      '#b79cff',
    ]
    const button = [...document.querySelectorAll('button')].find(
      (node) => node.textContent === '開啟對話框',
    )!
    const probe = document.createElement('span')
    button.append(probe)
    const canvas = document.createElement('canvas').getContext('2d')!
    const luminance = (css: string) => {
      canvas.fillStyle = '#000'
      canvas.fillStyle = css
      canvas.fillRect(0, 0, 1, 1)
      const [r, g, b] = [...canvas.getImageData(0, 0, 1, 1).data].map((value) => {
        const v = value / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const ratios: Record<string, number> = {}
    for (const accent of accents) {
      document.documentElement.style.setProperty('--accent', accent)
      probe.style.color = 'var(--tinted)'
      const fill = luminance(getComputedStyle(probe).color),
        text = luminance(getComputedStyle(button).color)
      ratios[accent] = (Math.max(fill, text) + 0.05) / (Math.min(fill, text) + 0.05)
    }
    probe.remove()
    document.documentElement.style.removeProperty('--accent')
    return ratios
  })
  evidence.tintedContrast = contrast
  for (const ratio of Object.values(contrast)) expect(ratio).toBeGreaterThanOrEqual(4.5)
})
