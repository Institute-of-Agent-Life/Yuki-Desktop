import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// 全局透明磨砂与统一顶部淡出任务书 (2026-11-12), failure cases 1–9, and focus rings no container cuts.
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('global-frost.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

const fixture = 'http://127.0.0.1:4178/renderer-regressions.html?case=showcase'
const pages = ['桌面對話', '工作', '檔案與成果', 'Yuki 的電腦', '這台電腦', '關於 Yuki'] as const

async function open(page: Page, height = 760) {
  await page.setViewportSize({ width: 1200, height })
  await page.goto(fixture)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.addStyleTag({ content: 'body { background: transparent !important }' })
  // The system's material is what lies under the page: here a wallpaper on the root itself.
  await page.evaluate(() => {
    const wall = document.createElement('style')
    wall.id = 'wallpaper'
    document.head.append(wall)
  })
}

async function look(page: Page, look: { material: string; theme: string; wall: string }) {
  await page.evaluate(({ material, theme, wall }) => {
    const root = document.documentElement
    root.dataset.material = material
    root.dataset.opaque = String(material === 'none')
    root.dataset.theme = theme
    root.dataset.backdrop = 'plain'
    document.getElementById('wallpaper')!.textContent = `html { background: ${wall} !important }`
  }, look)
  await page.waitForTimeout(250)
}

async function go(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: '側邊欄', exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page
    .getByRole('navigation', { name: '主要導覽', exact: true })
    .getByRole('button', { name, exact: true })
    .click()
  await page.waitForTimeout(400)
}

async function luma(page: Page, point: { x: number; y: number }) {
  const shot = await page.screenshot({ clip: { ...point, width: 1, height: 1 } })
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const context = new OffscreenCanvas(1, 1).getContext('2d')!
    context.drawImage(image, 0, 0)
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }, shot.toString('base64'))
}

// Points on each surface clear of text, cards and glass.
const surfaces = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect()
    const corner = (rect: DOMRect | undefined) =>
      rect && rect.width > 60 && { x: Math.round(rect.right - 30), y: Math.round(rect.bottom - 30) }
    const sidebar = box('nav[aria-label="主要導覽"]'),
      settings = box('section[aria-label="設定"]')
    return {
      sidebar: sidebar &&
        sidebar.width > 60 && {
          x: Math.round(sidebar.left + sidebar.width / 2),
          y: Math.round(sidebar.top + sidebar.height * 0.6),
        },
      main: corner(box('section[aria-label="設定"]') ? undefined : box('[data-region="content"]')),
      inspector: corner(box('[data-region="inspector"]')),
      settingsPane: corner(settings),
      settingsCategories: settings &&
        settings.width > 60 && {
          x: Math.round(settings.left + 100),
          y: Math.round(settings.bottom - 30),
        },
    }
  })

async function measure(page: Page, theme: string, material: string) {
  const dark = 'rgb(30 30 30)',
    light = 'rgb(225 225 225)',
    grey = 'rgb(128 128 128)'
  await look(page, { material, theme, wall: dark })
  const points = Object.entries(await surfaces(page)).filter(
    (entry): entry is [string, { x: number; y: number }] => !!entry[1],
  )
  const result: Record<string, { ratio: number; onGrey: number }> = {}
  const on: Record<string, Record<string, number>> = { dark: {}, light: {}, grey: {} }
  for (const [wall, colour] of [
    ['dark', dark],
    ['light', light],
    ['grey', grey],
  ] as const) {
    await look(page, { material, theme, wall: colour })
    for (const [name, point] of points) on[wall]![name] = await luma(page, point)
  }
  for (const [name] of points)
    result[name] = {
      ratio: (on.light![name]! - on.dark![name]!) / (225 - 30),
      onGrey: on.grey![name]!,
    }
  return result
}

test('the frost shows through every page in light and dark, and only where the system has one', async ({
  page,
}) => {
  test.setTimeout(120000)
  await open(page)
  const seen: Record<string, unknown> = {}
  const check = async (where: string) => {
    for (const theme of ['light', 'dark']) {
      const frosted = await measure(page, theme, 'vibrancy')
      seen[`${where}-${theme}`] = frosted
      for (const [surface, { ratio, onGrey }] of Object.entries(frosted)) {
        // 1: the wallpaper comes through; 2: a wash of the page's own colour stays over it.
        expect(ratio, `${where} ${surface} ${theme}`).toBeGreaterThanOrEqual(0.4)
        expect(ratio, `${where} ${surface} ${theme}`).toBeLessThanOrEqual(0.9)
        // 3: light pages lighten what lies beneath, dark ones darken it.
        if (theme === 'light') expect(onGrey, `${where} ${surface}`).toBeGreaterThan(136)
        else expect(onGrey, `${where} ${surface}`).toBeLessThan(120)
      }
      // 5: with no system material, or asked to be opaque, nothing shows through.
      const solid = await measure(page, theme, 'none')
      seen[`${where}-${theme}-solid`] = solid
      for (const [surface, { ratio }] of Object.entries(solid))
        expect(Math.abs(ratio), `${where} ${surface} ${theme} solid`).toBeLessThanOrEqual(0.02)
    }
  }
  for (const name of pages) {
    await go(page, name)
    await check(name)
  }
  await page.getByRole('button', { name: '詳情', exact: true }).click()
  await page.waitForTimeout(400)
  await check('詳情')
  await look(page, {
    material: 'vibrancy',
    theme: 'light',
    wall: 'linear-gradient(90deg,#e0503a,#3a6be0)',
  })
  await page.screenshot({ path: test.info().outputPath('frost-inspector.png') })
  await go(page, '設定')
  await check('設定')
  await page.screenshot({ path: test.info().outputPath('frost-settings.png') })
  evidence.surfaces = seen
})

test('conversation backdrops lay only their pattern over the frost', async ({ page }) => {
  await open(page)
  const chat = (backdrop: string, material: string) =>
    page.evaluate(
      ([backdrop, material]) => {
        const root = document.documentElement
        root.dataset.backdrop = backdrop
        root.dataset.material = material
        root.dataset.opaque = String(material === 'none')
        const element = document.querySelector('[role="log"]')!.parentElement!
        const style = getComputedStyle(element)
        const context = new OffscreenCanvas(1, 1).getContext('2d')!
        context.fillStyle = style.backgroundColor
        context.fillRect(0, 0, 1, 1)
        return {
          base: context.getImageData(0, 0, 1, 1).data[3]! / 255,
          pattern: (style.backgroundImage.match(/gradient/g) ?? []).length,
        }
      },
      [backdrop, material],
    )
  // 4: 「無」 draws nothing at all; the others draw their pattern and no solid sheet.
  expect(await chat('plain', 'vibrancy')).toEqual({ base: 0, pattern: 0 })
  for (const backdrop of ['lens', 'aurora', 'sunset', 'grid']) {
    const drawn = await chat(backdrop, 'vibrancy')
    expect(drawn.base, backdrop).toBe(0)
    expect(drawn.pattern, backdrop).toBeGreaterThan(0)
  }
})

test('every page runs up under the toolbar and frosts into its edge the same way', async ({
  page,
}) => {
  test.setTimeout(90000)
  await open(page, 420)
  await look(page, { material: 'vibrancy', theme: 'light', wall: 'rgb(200 200 210)' })
  const state = (container: string) =>
    page.evaluate((container) => {
      const root = document.querySelector(container)!
      const toolbar = root.querySelector(':scope [data-region="toolbar"], :scope > header')!
      const layers = [...root.querySelectorAll<HTMLElement>('[data-edge-fade]')].filter(
        (layer) => layer.closest(container) === root,
      )
      const top = root.getBoundingClientRect().top
      const scroller = [...root.querySelectorAll<HTMLElement>('*')].find((element) => {
        const style = getComputedStyle(element)
        return (
          ['auto', 'scroll'].includes(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 1 &&
          element.getBoundingClientRect().top <= top + 1 &&
          element.offsetParent !== null
        )
      })
      // The first thing a person would read, wherever it lies.
      const walker = document.createTreeWalker(
        root.querySelector('[data-region="content"]') ?? root.querySelector('#settings-panel')!,
        NodeFilter.SHOW_TEXT,
      )
      let first: number | undefined
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const rect = range.getBoundingClientRect()
        if (rect.height > 0) {
          first = rect.top
          break
        }
      }
      return {
        layers: layers.map((layer) => ({
          name: layer.dataset.edgeFade,
          opacity: getComputedStyle(layer).opacity,
          filter: getComputedStyle(layer).backdropFilter,
        })),
        toolbarBottom: toolbar.getBoundingClientRect().bottom,
        first,
        scrolls: !!scroller,
      }
    }, container)
  const scroll = (container: string, by: number) =>
    page.evaluate(
      ([container, by]) => {
        const root = document.querySelector(container as string)!
        const top = root.getBoundingClientRect().top
        const scroller = [...root.querySelectorAll<HTMLElement>('*')].find((element) => {
          const style = getComputedStyle(element)
          return (
            ['auto', 'scroll'].includes(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 1 &&
            element.getBoundingClientRect().top <= top + 1 &&
            element.offsetParent !== null
          )
        })!
        scroller.scrollTop = by as number
      },
      [container, by],
    )
  const main = 'section[data-region="main"]'
  const reference = (await state(main)).layers
  expect(reference.map((layer) => layer.name)).toEqual(['upper', 'lower'])
  const seen: Record<string, unknown> = {}
  for (const name of pages.slice(1)) {
    await go(page, name)
    const resting = await state(main)
    seen[name] = { resting }
    // 8: nothing starts under the toolbar.
    expect(resting.first, name).toBeDefined()
    expect(resting.first!, name).toBeGreaterThanOrEqual(resting.toolbarBottom - 0.5)
    // 7: the same two layers as the conversation, hidden until something scrolls under them.
    expect(
      resting.layers.map(({ name, filter }) => ({ name, filter })),
      name,
    ).toEqual(reference.map(({ name, filter }) => ({ name, filter })))
    expect(
      resting.layers.map((layer) => layer.opacity),
      name,
    ).toEqual(['0', '0'])
    if (!resting.scrolls) continue
    await scroll(main, 40)
    await expect
      .poll(async () => (await state(main)).layers.map((l) => l.opacity))
      .toEqual(['1', '1'])
    await page.screenshot({ path: test.info().outputPath(`edge-${name}.png`) })
    await scroll(main, 0)
    await expect
      .poll(async () => (await state(main)).layers.map((l) => l.opacity))
      .toEqual(['0', '0'])
  }
  expect(
    Object.entries(seen)
      .filter(([, value]) => (value as { resting: { scrolls: boolean } }).resting.scrolls)
      .map(([name]) => name),
  ).toEqual(expect.arrayContaining(['工作', '關於 Yuki']))
  await go(page, '設定')
  const settings = 'section[aria-label="設定"]'
  const resting = await state(settings)
  seen['設定'] = { resting }
  expect(resting.first!).toBeGreaterThanOrEqual(resting.toolbarBottom - 0.5)
  expect(resting.layers.map(({ name, filter }) => ({ name, filter }))).toEqual(
    reference.map(({ name, filter }) => ({ name, filter })),
  )
  expect(resting.scrolls).toBe(true)
  await scroll(settings, 40)
  await expect
    .poll(async () => (await state(settings)).layers.map((l) => l.opacity))
    .toEqual(['1', '1'])
  await page.screenshot({ path: test.info().outputPath('edge-settings.png') })
  evidence.edges = seen
})

test('the computer keeps its toolbar still when switching displays, with its state beside the controls', async ({
  page,
}) => {
  await open(page)
  await go(page, 'Yuki 的電腦')
  const group = page.getByRole('group', { name: '電腦狀態與控制', exact: true })
  const displays = group.getByRole('radiogroup', { name: '顯示器', exact: true })
  await expect(displays).toBeVisible()
  const layout = () =>
    page.evaluate(() => {
      const group = document.querySelector('[aria-label="電腦狀態與控制"]')!
      const toolbar = document.querySelector('section[data-region="main"] [data-region="toolbar"]')!
      const radios = group.querySelector('[role="radiogroup"]')!.getBoundingClientRect()
      const status = [...group.querySelectorAll('span')].find((span) =>
        span.textContent?.includes('控制：'),
      )
      const button = [...group.querySelectorAll('button')].find(
        (button) => !button.closest('[role="radiogroup"]'),
      )!
      return {
        radiosTop: radios.top,
        toolbarHeight: toolbar.getBoundingClientRect().height,
        status: status && status.getBoundingClientRect().toJSON(),
        button: button.getBoundingClientRect().toJSON(),
      }
    })
  const sandbox = await layout()
  // 9: the state lies on the right, just left of the controls, on their line.
  expect(sandbox.status).toBeDefined()
  expect(sandbox.status!.right).toBeLessThanOrEqual(sandbox.button.left)
  expect(sandbox.status!.left).toBeGreaterThan(sandbox.radiosTop === 0 ? 0 : 400)
  expect(
    Math.abs(
      sandbox.status!.top +
        sandbox.status!.height / 2 -
        (sandbox.button.top + sandbox.button.height / 2),
    ),
  ).toBeLessThan(4)
  await displays.getByRole('radio', { name: 'QQ 登入', exact: true }).click()
  await page.waitForTimeout(300)
  const qq = await layout()
  await displays.getByRole('radio', { name: 'Yuki 的沙箱', exact: true }).click()
  await page.waitForTimeout(300)
  const back = await layout()
  evidence.computer = { sandbox, qq, back }
  for (const other of [qq, back]) {
    expect(Math.abs(other.radiosTop - sandbox.radiosTop)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(other.toolbarHeight - sandbox.toolbarHeight)).toBeLessThanOrEqual(0.5)
  }
  await page.screenshot({ path: test.info().outputPath('computer-toolbar.png') })
})

// Where the focused element's ring is cut by a container that cannot scroll to reveal it.
const cut = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    if (!element || element === document.body) return null
    const style = getComputedStyle(element)
    if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0) return null
    const grow = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset)
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const describe = (node: Element) =>
      `${node.tagName.toLowerCase()}.${[...node.classList].join('.')}[${(node.getAttribute('aria-label') ?? node.textContent ?? '').trim().slice(0, 24)}]`
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const own = getComputedStyle(parent)
      const x = own.overflowX !== 'visible',
        y = own.overflowY !== 'visible'
      if (!x && !y) continue
      const outer = parent.getBoundingClientRect()
      const box = {
        left: outer.left + parent.clientLeft,
        top: outer.top + parent.clientTop,
        right: outer.left + parent.clientLeft + parent.clientWidth,
        bottom: outer.top + parent.clientTop + parent.clientHeight,
      }
      const sides = [
        y && rect.top - grow < box.top - 0.5 && parent.scrollTop <= 0 && 'top',
        y &&
          rect.bottom + grow > box.bottom + 0.5 &&
          parent.scrollTop + parent.clientHeight >= parent.scrollHeight - 1 &&
          'bottom',
        x && rect.left - grow < box.left - 0.5 && parent.scrollLeft <= 0 && 'left',
        x &&
          rect.right + grow > box.right + 0.5 &&
          parent.scrollLeft + parent.clientWidth >= parent.scrollWidth - 1 &&
          'right',
      ].filter(Boolean)
      if (sides.length) return { element: describe(element), container: describe(parent), sides }
    }
    return null
  })

async function sweep(page: Page, where: string, found: unknown[]) {
  await page.mouse.click(1, 1)
  const seen = new Set<string>()
  for (let step = 0; step < 90; step++) {
    await page.keyboard.press('Tab')
    const key = await page.evaluate(() => {
      const element = document.activeElement!
      return `${element.tagName}:${element.getAttribute('aria-label') ?? element.textContent?.slice(0, 30)}:${Math.round(element.getBoundingClientRect().top)}`
    })
    if (seen.has(key)) break
    seen.add(key)
    const problem = await cut(page)
    if (problem) found.push({ where, ...problem })
  }
}

test('no focus ring is cut by the container it lies in', async ({ page }) => {
  test.setTimeout(180000)
  await open(page)
  await page.evaluate(() => {
    const root = document.documentElement
    root.dataset.material = 'vibrancy'
    root.dataset.opaque = 'false'
  })
  const found: unknown[] = []
  for (const name of pages) {
    await go(page, name)
    await sweep(page, name, found)
  }
  // The sheet a person writes their note in when handing the computer back.
  await go(page, 'Yuki 的電腦')
  await page.getByRole('button', { name: '交回給 Yuki', exact: true }).click()
  const note = page.getByRole('dialog').getByRole('textbox', { name: '說明', exact: true })
  await expect(note).toBeVisible()
  await page.waitForTimeout(600)
  await note.focus()
  const sheet = await cut(page)
  if (sheet) found.push({ where: '交回', ...sheet })
  await page.screenshot({ path: test.info().outputPath('return-sheet-focus.png') })
  await page.keyboard.press('Escape')
  await go(page, '設定')
  const tabs = page.getByRole('tablist', { name: '設定分類', exact: true }).getByRole('tab')
  for (const label of (await tabs.allInnerTexts()).map((text) => text.trim())) {
    // A tab that leads out of settings is left behind: settings is opened afresh.
    if (!(await tabs.first().isVisible())) {
      await open(page)
      await go(page, '設定')
    }
    await tabs.filter({ hasText: label }).first().click()
    await page.waitForTimeout(200)
    await sweep(page, `設定 ${label}`, found)
  }
  evidence.cutRings = found
  expect(found).toEqual([])
})
