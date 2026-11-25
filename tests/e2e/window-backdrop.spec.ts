import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { dockGlass } from '../fixtures/dock-glass'
import { contentSize } from '../fixtures/visual'
import { legible, throughGlass } from '../fixtures/legibility'
import { picture, type Picture } from '../fixtures/pictures'

/*
 * A picture of one's own is the window's backdrop, drawn once behind every page and shown sharp
 * between the glass; content lies on blocks of its frost (materials.css), the controls on the
 * Dock's glass. On every page (the conversation, Work and a work's detail, Files and results, a
 * computer, this computer, About, Settings) and at either display scale:
 *
 * Fails when:
 *   1. the picture is drawn more than once, or by anything but the window (a page's own layer);
 *   2. a page lies on a pane of glass of its own (glass over most of the window);
 *   3. any text lies on the bare picture: under it neither glass, frost, a fill nor media;
 *   4. a block's frost is not the picture's frost where the window has it: offset from it by
 *      more than 2px, or matching it better scaled (the blurred copy laid out at another size),
 *      at rest, after the wheel scrolls a page to its middle and back, and after a resize;
 *   5. a piece of the Dock's glass draws nothing (the frame equals the frame with every backdrop
 *      filter off: its backdrop read empty);
 *   6. the gap around the floating sidebar (macOS) is not the picture (a strip treated otherwise);
 *   7. a huge pane (the sidebar, short side over 200pt) draws a rim, or the composer draws none;
 *   8. main text reads under 4.5:1, or quiet and coloured text under 3:1, on its frost (the worst
 *      1% of the pixels under it).
 * Where the window is opaque (CI's macOS reduces transparency) the picture is not shown and only
 * 1 and 2 hold; without GPU compositing (CI's Linux) content's frost is a fill, and 4 and 8 do not
 * apply. Line art and the sidebar keep their measured floors (custom-backdrop.spec.ts,
 * sidebar-legibility.spec.ts).
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('window-backdrop.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

const frostSelector =
  '[data-frost], [data-frost-children] > :not([data-frost-children], [data-glass], dialog, [popover])'

/** Opens the sidebar where a small screen has folded it away over the page. */
async function sidebarShown(page: Page) {
  const toggle = page.locator('[data-region="toolbar"] [data-toggle="sidebar"]')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(page.locator('[data-region="sidebar"]')).toHaveAttribute('data-pane-open', 'true')
}
async function nav(page: Page, label: string) {
  if (await page.locator('#settings-panel').count())
    await page.getByRole('button', { name: '返回', exact: true }).click()
  await sidebarShown(page)
  await page.locator('[data-region="sidebar"]').getByText(label, { exact: true }).first().click()
}
async function settings(page: Page, tab: string) {
  if (!(await page.locator('#settings-panel').count())) await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: tab, exact: true }).click()
}

/** Until nothing scrolls or animates. */
async function settle(page: Page) {
  await page.waitForTimeout(600)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = '',
          still = 0
        const deadline = performance.now() + 5000
        const tick = () => {
          const now = [...document.querySelectorAll('*')]
            .map((node) => node.scrollTop)
            .filter(Boolean)
            .join()
          still = now === last ? still + 1 : 0
          last = now
          const moving = document.getAnimations().some((a) => a.playState === 'running')
          if ((still > 4 && !moving) || performance.now() > deadline) resolve()
          else requestAnimationFrame(tick)
        }
        tick()
      }),
  )
  await page.waitForTimeout(200)
}

/** 1-3: the picture's layers, glass over most of the window, and text on the bare picture. */
function structure(page: Page) {
  return page.evaluate(() => {
    const area = innerWidth * innerHeight
    const layers = [document.documentElement, ...document.querySelectorAll('*')]
      .filter((node) =>
        [getComputedStyle(node).backgroundImage, getComputedStyle(node, '::before').backgroundImage]
          .join(' ')
          .includes('__backgrounds/'),
      )
      // The picker's own swatch of the picture (Settings → Appearance) is not a layer.
      .filter((node) => !node.closest('[role="radiogroup"]'))
      .map((node) => node.tagName.toLowerCase())
    const panes = [...document.querySelectorAll('*')]
      .filter((node) => {
        const filter = getComputedStyle(node).backdropFilter
        const r = node.getBoundingClientRect()
        return filter && filter !== 'none' && (r.width * r.height) / area > 0.4
      })
      .map((node) => node.getAttribute('data-glass') ?? node.tagName)
    // What backs text: glass, frost, a fill of its own (not the window's) or media.
    const backs = (node: Element) => {
      const style = getComputedStyle(node),
        r = node.getBoundingClientRect()
      const whole = r.width >= innerWidth - 2 && r.height >= innerHeight - 2
      if (style.backdropFilter && style.backdropFilter !== 'none') return true
      if (['IMG', 'VIDEO', 'CANVAS', 'IFRAME'].includes(node.tagName)) return true
      if (whole) return false
      if (/url\(/.test(style.backgroundImage)) return true
      // rgb(…), rgba(…), color(srgb … / a) or oklab(… / a): its alpha, the last of four numbers.
      const colour = style.backgroundColor
      if (colour === 'transparent') return false
      const values = colour.match(/[\d.]+/g)!.map(Number)
      const alpha = colour.includes('/') || colour.startsWith('rgba') ? values.at(-1)! : 1
      return alpha >= 0.6
    }
    // Every element is hit, so that a frost layer under its text (a bubble's) is found.
    const probe = document.createElement('style')
    probe.textContent = '* { pointer-events: auto !important }'
    document.head.append(probe)
    const bare: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const value = text.textContent?.trim(),
        parent = text.parentElement!
      if (!value || parent.closest('svg, [aria-hidden="true"], option, select, textarea, input'))
        continue
      if (!parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
      if (parent.closest('[inert]')) continue
      const range = document.createRange()
      range.selectNodeContents(text)
      for (const r of range.getClientRects()) {
        if (r.width < 3 || r.height < 3) continue
        const x = r.x + r.width / 2,
          y = r.y + r.height / 2
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue
        const stack = document.elementsFromPoint(x, y)
        // Under something else (a menu over it): not what is read there.
        if (stack[0] && !parent.contains(stack[0]) && !stack[0].contains(parent)) continue
        const from = stack.indexOf(parent)
        if (!(from >= 0 ? stack.slice(from) : stack).some(backs)) bare.push(value.slice(0, 40))
      }
    }
    probe.remove()
    return { layers, panes, bare }
  })
}

/** A frame of the window, as PNG data. */
async function frame(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  return (await page.screenshot({ animations: 'disabled', caret: 'hide' })).toString('base64')
}
async function withStyle<T>(page: Page, css: string, run: () => Promise<T>) {
  await page.evaluate((css) => {
    const style = document.createElement('style')
    style.dataset.backdropProbe = ''
    style.textContent = css
    document.head.append(style)
  }, css)
  try {
    return await run()
  } finally {
    await page.evaluate(() => document.querySelector('style[data-backdrop-probe]')?.remove())
  }
}

/**
 * 4: every block of frost at least 120×44, wholly in the window and clear of the glass and the edge fades, what it
 * holds hidden, against the picture's frost laid out as the window lays it (centred at
 * `--backdrop-frost-size`), both blurred 3px: the offset within 24px at which it matches best,
 * and how well the frost scaled by ½, ¾, 4⁄3 or 2 about the block matches.
 */
async function registration(page: Page) {
  const shown = await withStyle(
    page,
    `:is(${frostSelector}) :not(${frostSelector}), [data-bubble-copy], [data-liquid-outline] { visibility: hidden !important }
     :is(${frostSelector}) :is(${frostSelector}) { visibility: visible !important }`,
    () => frame(page),
  )
  return page.evaluate(
    async ({ shown, frostSelector }) => {
      const root = getComputedStyle(document.documentElement)
      const url = (name: string) => /url\("?([^")]+)/.exec(root.getPropertyValue(name))![1]!
      const [fw, fh] = root
        .getPropertyValue('--backdrop-frost-size')
        .match(/[\d.]+/g)!
        .map(Number)
      const image = await createImageBitmap(
        new Blob([Uint8Array.from(atob(shown), (c) => c.charCodeAt(0))], { type: 'image/png' }),
      )
      const scale = image.width / innerWidth
      const blurred = (draw: (context: OffscreenCanvasRenderingContext2D) => void) => {
        const canvas = new OffscreenCanvas(image.width, image.height),
          context = canvas.getContext('2d')!
        context.filter = `blur(${3 * scale}px)`
        draw(context)
        return context.getImageData(0, 0, image.width, image.height).data
      }
      const seen = blurred((context) => context.drawImage(image, 0, 0))
      const references: Record<string, Uint8ClampedArray> = {}
      for (const look of ['light', 'dark']) {
        const frost = new Image()
        frost.src = url(`--backdrop-frost-${look}`)
        await frost.decode()
        references[look] = blurred((context) =>
          context.drawImage(
            frost,
            ((innerWidth - fw!) / 2) * scale,
            ((innerHeight - fh!) / 2) * scale,
            fw! * scale,
            fh! * scale,
          ),
        )
      }
      const over = [
        ...document.querySelectorAll(
          '[data-region="composer"], [data-region="toolbar"] [data-glass], [data-edge-fade], [data-glass="sidebar"], [data-glass="card"], [data-glass="sheet"]',
        ),
      ]
        .map((node) => node.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
      const blocks = [...document.querySelectorAll<HTMLElement>(`${frostSelector}, [data-surface]`)]
        .filter(
          (node) =>
            node.checkVisibility() && getComputedStyle(node).backgroundImage.includes('blob:'),
        )
        // A bubble's frost reaches past it while it drops in; the bubble is what it shows.
        .map((node) => ({
          node,
          r: (node.matches('[data-surface]') ? node.parentElement! : node).getBoundingClientRect(),
        }))
        .filter(
          ({ r }) =>
            // A small one (a short bubble) holds too little of the picture to place it by; the
            // larger ones of the same layer are placed.
            r.width >= 120 &&
            r.height >= 44 &&
            r.x >= 0 &&
            r.y >= 0 &&
            r.right <= innerWidth &&
            r.bottom <= innerHeight &&
            over.every(
              (o) => r.bottom < o.top || r.top > o.bottom || r.right < o.left || r.left > o.right,
            ),
        )
      const luma = (data: Uint8ClampedArray, k: number) =>
        0.2126 * data[k]! + 0.7152 * data[k + 1]! + 0.0722 * data[k + 2]!
      const mean = (values: number[]) =>
        values.reduce((sum, value) => sum + value, 0) / values.length
      const results = []
      for (const { node, r } of blocks) {
        const owner = node.matches('[data-surface]') ? node.parentElement! : node
        const reference = references[owner.dataset.appearance ?? 'light']!
        // Inside it, clear of its rounded corners, every 2 CSS px.
        const step = 2 * scale,
          inset = Math.max(8, parseFloat(getComputedStyle(node).borderTopLeftRadius) * 0.6)
        const xs: number[] = [],
          ys: number[] = []
        for (let x = (r.x + inset) * scale; x < (r.right - inset) * scale; x += step)
          xs.push(Math.round(x))
        for (let y = (r.y + inset) * scale; y < (r.bottom - inset) * scale; y += step)
          ys.push(Math.round(y))
        const a: number[] = []
        for (const y of ys) for (const x of xs) a.push(luma(seen, (y * image.width + x) * 4))
        const ma = mean(a)
        const match = (b: number[]) => {
          const mb = mean(b)
          let ab = 0,
            aa = 0,
            bb = 0
          for (let i = 0; i < a.length; i++) {
            const p = a[i]! - ma,
              q = b[i]! - mb
            ab += p * q
            aa += p * p
            bb += q * q
          }
          return { score: ab / (Math.sqrt(aa * bb) + 1e-9), spread: Math.sqrt(bb / b.length) }
        }
        const cx = (r.x + r.width / 2) * scale,
          cy = (r.y + r.height / 2) * scale
        const sample = (dx: number, dy: number, zoom = 1) => {
          const b: number[] = []
          for (const y of ys)
            for (const x of xs) {
              const px = Math.round(cx + (x - cx) / zoom + dx * scale),
                py = Math.round(cy + (y - cy) / zoom + dy * scale)
              b.push(
                luma(
                  reference,
                  (Math.min(image.height - 1, Math.max(0, py)) * image.width +
                    Math.min(image.width - 1, Math.max(0, px))) *
                    4,
                ),
              )
            }
          return b
        }
        const zero = match(sample(0, 0))
        // A frost over a flat stretch of the picture has nothing to place it by.
        if (zero.spread < 2.5) continue
        let best = { score: -2, dx: 0, dy: 0 }
        for (let dy = -24; dy <= 24; dy += 2)
          for (let dx = -24; dx <= 24; dx += 2) {
            const { score } = match(sample(dx, dy))
            if (score > best.score) best = { score, dx, dy }
          }
        const round = (value: number) => Math.round(value * 100) / 100
        results.push({
          block: `${node.tagName.toLowerCase()} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`,
          zero: round(zero.score),
          best: { ...best, score: round(best.score) },
          zoomed: [0.5, 0.75, 4 / 3, 2].map((zoom) => ({
            zoom: round(zoom),
            score: round(match(sample(0, 0, zoom)).score),
          })),
        })
      }
      return results
    },
    { shown, frostSelector },
  )
}

/** The mean difference (levels) between two frames within each box (CSS pixels). */
function difference(
  page: Page,
  frames: [string, string],
  boxes: { x: number; y: number; w: number; h: number }[],
) {
  return page.evaluate(
    async ({ frames, boxes }) => {
      const read = async (png: string) => {
        const image = await createImageBitmap(
          new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: 'image/png' }),
        )
        const canvas = new OffscreenCanvas(image.width, image.height),
          context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return { data: context.getImageData(0, 0, image.width, image.height).data, image }
      }
      const a = await read(frames[0]),
        b = await read(frames[1])
      const width = a.image.width,
        scale = width / innerWidth
      return boxes.map((box) => {
        let sum = 0,
          n = 0
        for (let y = Math.ceil(box.y * scale); y < (box.y + box.h) * scale; y += 2)
          for (let x = Math.ceil(box.x * scale); x < (box.x + box.w) * scale; x += 2) {
            const k = (y * width + x) * 4
            for (let c = 0; c < 3; c++) sum += Math.abs(a.data[k + c]! - b.data[k + c]!)
            n += 3
          }
        return Math.round((sum / n) * 100) / 100
      })
    },
    { frames, boxes },
  )
}

/** 5: how much each piece of the Dock's glass changes the frame (mean levels). */
async function glassDraws(page: Page) {
  const pieces = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-glass]')]
      .filter((node) => ['sidebar', 'toolbar', 'composer', 'send'].includes(node.dataset.glass!))
      // Glass (a flush sidebar off macOS is a fill).
      .filter((node) => getComputedStyle(node).backdropFilter !== 'none')
      // Shown: not a sidebar folded away over the page.
      .filter(
        (node) =>
          node.checkVisibility() &&
          !node.closest('[inert], [data-pane-open="false"]') &&
          node.dataset.paneOpen !== 'false',
      )
      .map((node) => {
        const r = node.getBoundingClientRect()
        return {
          kind: node.dataset.glass!,
          x: r.x + 4,
          y: r.y + 4,
          w: r.width - 8,
          h: r.height - 8,
        }
      })
      .filter(
        (box) =>
          box.w > 8 &&
          box.h > 8 &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.w <= innerWidth &&
          box.y + box.h <= innerHeight,
      ),
  )
  const hide = '[data-glass] * { visibility: hidden !important }'
  const on = await withStyle(page, hide, () => frame(page))
  const off = await withStyle(
    page,
    `${hide} [data-glass] { backdrop-filter: none !important }`,
    () => frame(page),
  )
  const changes = await difference(page, [on, off], pieces)
  return pieces.map((piece, i) => ({ kind: piece.kind, change: changes[i]! }))
}

/** 6: the strip between the window's edge and the floating sidebar, against the picture alone. */
async function gap(page: Page) {
  const strip = await page.evaluate(() => {
    const r = document.querySelector('[data-region="sidebar"]')!.getBoundingClientRect()
    return { x: 1, y: Math.round(r.y + 80), w: Math.max(1, Math.floor(r.x) - 2), h: 300 }
  })
  const shown = await frame(page)
  const alone = await withStyle(
    page,
    // The window's own layer, the picture, alone (App.module.css draws it on the app).
    'body * { visibility: hidden !important } main:has([data-region]) { visibility: visible !important } main:has([data-region]) * { visibility: hidden !important }',
    () => frame(page),
  )
  return (await difference(page, [shown, alone], [strip]))[0]!
}

async function choose(
  app: ElectronApplication,
  page: Page,
  kind: Picture,
  theme: 'light' | 'dark',
) {
  const path = test.info().outputPath(`${kind}.png`)
  await writeFile(path, await picture(page, kind))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, path)
  await settings(page, '外觀')
  await page
    .getByRole('radiogroup', { name: '主題', exact: true })
    .getByRole('radio', { name: theme === 'dark' ? '深色' : '淺色', exact: true })
    .click()
  await page
    .getByRole('radiogroup', { name: '對話背景', exact: true })
    .getByRole('radio', { name: '自訂圖片', exact: true })
    .click()
  await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
}

const pages: [string, (page: Page) => Promise<void>, string?][] = [
  ['conversation', (page) => nav(page, '桌面對話'), '[role="log"]'],
  ['works', (page) => nav(page, '工作'), '[data-region="content"] [data-frost-children]'],
  [
    'work detail',
    async (page) => {
      await nav(page, '工作')
      await page
        .locator('[data-region="content"] button')
        .filter({ hasText: 'Desktop reference work' })
        .first()
        .click()
    },
  ],
  [
    'files',
    async (page) => {
      // The work's detail closed first: on a narrow window it lies over the toolbar.
      const close = page.locator('[data-region="inspector"]').getByLabel('關閉詳情').first()
      if (await close.isVisible()) await close.click()
      await nav(page, '檔案與成果')
    },
  ],
  ['computer', (page) => nav(page, '初始角色 的電腦')],
  ['this computer', (page) => nav(page, '這台電腦')],
  ['about', (page) => nav(page, '關於 初始角色'), '[data-region="content"] *'],
  ['settings', (page) => settings(page, '一般')],
  ['appearance', (page) => settings(page, '外觀'), '#settings-panel'],
  [
    'this computer settings',
    async (page) => {
      await settings(page, '這台電腦')
      await page.evaluate(() =>
        document
          .querySelectorAll<HTMLDetailsElement>('#settings-panel details')
          .forEach((node) => (node.open = true)),
      )
    },
  ],
]

// Main text 4.5:1, quiet and coloured text 3:1, on frost.
const reading: [(page: Page) => Promise<void>, string, number][] = [
  [
    (page) => nav(page, '工作'),
    '[data-region="content"] button >> text=Desktop reference work',
    4.5,
  ],
  [(page) => nav(page, '工作'), '[data-region="content"] button time', 3],
  [(page) => nav(page, '工作'), '[data-region="content"] button >> text=等你回覆', 3],
  [(page) => nav(page, '關於 初始角色'), '[data-region="content"] h1', 4.5],
  [(page) => settings(page, '一般'), '#settings-panel h2', 4.5],
  [(page) => settings(page, '一般'), '#settings-panel [data-settings-row] small', 3],
]

for (const [scale, kind, theme] of [
  [1, 'berries', 'light'],
  [2, 'forest', 'dark'],
] as const) {
  test(`${kind} in the ${theme} theme at ${scale}x: every page on the one picture, its content on frost in place`, async () => {
    test.setTimeout(600000)
    await mkdir(test.info().outputPath(), { recursive: true })
    // The computer fixture's display needs a POSIX temporary directory.
    const rig = await yukiFixture({ character: true, computer: process.platform !== 'win32' }),
      app = await rig.launch(`window-backdrop-${scale}`, [`--force-device-scale-factor=${scale}`])
    let success = false
    try {
      const page = await app.firstWindow()
      await contentSize(app, page, 1100, 760)
      await pairUI(page, rig.base, await rig.code())
      const post = (path: string) => fetch(`${rig.base}${path}`, { method: 'POST' })
      await post('/__test/history?count=30')
      for (let i = 0; i < 6; i++) await post('/__test/work')
      await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
      await choose(app, page, kind, theme)
      const through = await throughGlass(page)
      // Its frost is made once the picture has been read (materials/backdrop.ts).
      if (through.glass)
        await expect
          .poll(
            () =>
              page.evaluate(() =>
                getComputedStyle(document.documentElement).getPropertyValue(
                  '--backdrop-frost-dark',
                ),
              ),
            { timeout: 20000 },
          )
          .toContain('blob:')
      const record: Record<string, unknown> = {}
      evidence[`${kind} ${theme} ${scale}x`] = record

      const check = async (name: string) => {
        await settle(page)
        await page.screenshot({ path: test.info().outputPath(`${kind}-${scale}x-${name}.png`) })
        const { layers, panes, bare } = await structure(page)
        const seen: Record<string, unknown> = { layers, panes, bare }
        record[name] = seen
        expect.soft(layers, `${name}: the picture is drawn once, by the window`).toEqual(['main'])
        expect.soft(panes, `${name}: no glass over most of the window`).toEqual([])
        // Without transparency the picture is not shown: there is no picture to be bare on.
        if (!through.glass) return
        expect.soft(bare, `${name}: no text on the bare picture`).toEqual([])
        const draws = await glassDraws(page)
        seen.draws = draws
        for (const piece of draws)
          expect.soft(piece.change, `${name}: the ${piece.kind} glass draws`).toBeGreaterThan(1.2)
        if (!through.content) return
        const blocks = await registration(page)
        seen.blocks = blocks
        for (const block of blocks) {
          // Off by more than 2px only where that matches well, and clearly better than in place.
          if (block.best.score >= 0.6 && block.best.score - block.zero > 0.05)
            expect
              .soft(
                Math.max(Math.abs(block.best.dx), Math.abs(block.best.dy)),
                `${name}: ${block.block} in place`,
              )
              .toBeLessThanOrEqual(2)
          for (const zoomed of block.zoomed)
            expect
              .soft(zoomed.score, `${name}: ${block.block} at its own scale (vs ${zoomed.zoom}x)`)
              .toBeLessThanOrEqual(Math.max(block.zero + 0.08, 0.6))
        }
      }

      for (const [name, open, scroller] of pages) {
        await open(page)
        await check(name)
        if (!scroller) continue
        // To the middle with the wheel, and back.
        const box = await page.evaluate((selector) => {
          const node = [...document.querySelectorAll<HTMLElement>(selector)].find(
            (candidate) =>
              candidate.scrollHeight > candidate.clientHeight + 80 &&
              /(auto|scroll)/.test(getComputedStyle(candidate).overflowY),
          )
          if (!node) return null
          const r = node.getBoundingClientRect()
          return {
            x: r.x + r.width / 2,
            y: r.y + r.height / 2,
            distance: (node.scrollHeight - node.clientHeight) / 2 - node.scrollTop,
          }
        }, scroller)
        if (!box) continue
        await page.mouse.move(box.x, box.y)
        await page.mouse.wheel(0, box.distance / 2)
        await page.mouse.wheel(0, box.distance / 2)
        await check(`${name} scrolled`)
        await page.mouse.wheel(0, -box.distance)
        await check(`${name} scrolled back`)
      }

      // The floating sidebar's gap shows the picture, and the sidebar draws no rim; the
      // composer, a pane of ordinary size, does.
      await nav(page, '桌面對話')
      await settle(page)
      const floats = await page.evaluate(
        () => document.querySelector('[data-region="sidebar"]')!.getBoundingClientRect().x > 2,
      )
      if (through.glass && floats) {
        const strip = await gap(page)
        record.gap = strip
        expect.soft(strip, 'the gap around the sidebar is the picture').toBeLessThan(3)
        const sidebar = await dockGlass(page.locator('[data-glass="sidebar"]').first()),
          composer = await dockGlass(page.locator('[data-glass="composer"]').first())
        record.rims = { sidebar: sidebar.rim, composer: composer.rim }
        expect.soft(sidebar.rim?.edge ?? 0, 'a huge pane draws no rim').toBe(0)
        expect.soft(composer.rim?.edge ?? 0, 'the composer draws its rim').toBeGreaterThan(0)
      }

      if (through.content)
        for (const [open, selector, floor] of reading) {
          await open(page)
          await settle(page)
          const ratio = await legible(page, page.locator(selector).first())
          record[selector] = ratio
          expect.soft(ratio, selector).toBeGreaterThanOrEqual(floor)
        }

      // At another size the frost is laid out again with the picture.
      await nav(page, '工作')
      await contentSize(app, page, 960, 680)
      await check('resized')
      success = true
    } finally {
      await app.close()
      await rig.close(success)
    }
  })
}
