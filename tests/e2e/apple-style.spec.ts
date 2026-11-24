import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'
import { legible } from '../fixtures/legibility'
import { closeUps } from '../fixtures/edges'
import { picture } from '../fixtures/pictures'

/*
 * Apple's design language, phases 3, 4 and 6 (docs/reports/2026-11-23-liquid-glass §15 and
 * hig-audit.md), with the window's structure after macOS 26: the real app, an isolated profile and
 * the real backend. Failure cases, written before the change:
 *   1. tokens: no concentric radii (`--r-window`, `--inset`, `--r-pane`), no control heights
 *      (24 / 28 / 36), the old unused `--radius-*` still defined, a spacing or radius token defined
 *      and never used, or a stylesheet still writing a radius as a bare length;
 *   2. controls: a regular button is not a 24pt rounded rectangle (radius 6), a dialog's buttons
 *      are not 28pt capsules, the welcome's one action not a 36pt capsule; a field or a segmented
 *      control is not 24pt with radius 6; a switch is not 40×22; a Han label keeps extra tracking;
 *   3. the window: the main area is a floating card (a margin, a corner of its own, a shadow)
 *      rather than reaching the window's edges; on macOS the sidebar is not an inset glass pane
 *      whose corner is the window's less its inset; on Windows and Linux it is not flush with the
 *      window and divided by a hairline; the inspector floats as a card;
 *   4. settings: its categories are not the same sidebar; Back is not a chevron; its groups have a
 *      border or are not grouped inset lists (radius 10, rows of at least 40pt, separators
 *      starting at the text);
 *   5. pages: the welcome, the connection form or any page still lies on a card of its own;
 *   6. the content layer: a bubble or a work card is still glass (a lit rim, a lens, a shadow), or
 *      not frosted (no blur behind a translucent tint: one's own the accent's, another's neutral);
 *      a new profile's conversation still shows the light pattern; over the plain page or any
 *      pattern, light or dark, a message's text falls below 4.5:1 (its sender and time below 3:1)
 *      against the worst 1% of what lies behind it;
 *   7. a picture of one's own does not reach the window's edges under the sidebar;
 *   8. icons: a sidebar, toolbar or settings icon is drawn thinner than 2 (SF Symbols' Regular);
 *   9. on macOS the application menu shows no SF Symbols (and elsewhere it shows any);
 *  10. the font chain lacks the platform's own: SF / PingFang on macOS, Segoe UI Variable on
 *      Windows, system-ui, Inter, Noto Sans and Noto Sans CJK on Linux;
 *  11. a message that could not be sent says so inside its bubble, where the danger colour and the
 *      check link are lost on the tint, rather than below it as Messages says "Not Delivered"; or
 *      what is said there falls below 4.5:1.
 * Screenshots of every page, light and dark, are written first, so the run before the change
 * leaves the "before" pictures as well (assertions are soft).
 */
const evidence: Record<string, unknown> = {}
const output = (name: string) => test.info().outputPath(name)

async function shot(page: Page, name: string) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: output(`${name}.png`) })
}
// The page reads its preferences when it starts: written from outside, it is reloaded to show them,
// at the size it had (a reload ends the emulated size a small screen needs).
async function themed(app: ElectronApplication, page: Page, theme: 'light' | 'dark') {
  if ((await page.locator(`html[data-theme="${theme}"]`).count()) === 1) return
  await page.evaluate((theme) => window.yuki.preferences({ theme }), theme)
  await page.reload()
  await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
  // A native window within the screen's work area (emulating a larger one does not survive the
  // reload, and the composer would lie below a small screen).
  const area = await app.evaluate(
    ({ BrowserWindow, screen }) =>
      screen.getDisplayMatching(BrowserWindow.getAllWindows()[0]!.getBounds()).workArea,
  )
  await contentSize(app, page, Math.min(1100, area.width), Math.min(760, area.height - 40))
}
async function appearance(page: Page, theme: 'light' | 'dark') {
  await page.getByRole('tab', { name: '外觀', exact: true }).click()
  await page
    .getByRole('radiogroup', { name: '主題', exact: true })
    .getByRole('radio', { name: theme === 'dark' ? '深色' : '淺色', exact: true })
    .click()
  await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
}
const box = (element: Locator) =>
  element.evaluate(
    (node) => {
      const { x, y, width, height } = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        x,
        y,
        width,
        height,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        shadow: style.boxShadow,
        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderLeftWidth],
        letterSpacing: style.letterSpacing,
      }
    },
    undefined,
    { timeout: 5000 },
  )
const px = (value: string) => parseFloat(value)

// The window's corners as the system draws them, enlarged 6x: on macOS the window's own image with
// its transparent corners (screencapture of its window id), elsewhere a capture of the display.
async function windowCorners(app: ElectronApplication, name: string) {
  const captured = await app.evaluate(
    async ({ BrowserWindow, desktopCapturer, nativeImage, screen }, file) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const bounds = window.getBounds(),
        display = screen.getDisplayMatching(bounds)
      const corners = (image: Electron.NativeImage, width: number, height: number) => {
        const scale = image.getSize().width / width
        const crop = (top: number) =>
          image
            .crop({
              x: 0,
              y: Math.round(top * scale),
              width: Math.round(40 * scale),
              height: Math.round(40 * scale),
            })
            .resize({ width: 240, height: 240, quality: 'good' })
            .toPNG()
            .toString('base64')
        return { upperLeft: crop(0), lowerLeft: crop(height - 40) }
      }
      if (process.platform === 'darwin') {
        const { execFileSync } = process.getBuiltinModule('node:child_process')
        const id = window.getMediaSourceId().split(':')[1]!
        // A runner without screen recording permission captures nothing: no close-up then.
        try {
          execFileSync('/usr/sbin/screencapture', ['-x', '-o', `-l${id}`, file])
        } catch {
          return null
        }
        const image = nativeImage.createFromPath(file)
        if (image.isEmpty()) return null
        return corners(image, bounds.width, bounds.height)
      }
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: display.size.width * display.scaleFactor,
          height: display.size.height * display.scaleFactor,
        },
      })
      const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
      if (!source || source.thumbnail.isEmpty()) return null
      // Cropped from the display as though it were the window grown by 8px on each side.
      const scaled = source.thumbnail.crop({
        x: Math.round(
          ((bounds.x - display.bounds.x - 8) * source.thumbnail.getSize().width) /
            display.size.width,
        ),
        y: Math.round(
          ((bounds.y - display.bounds.y - 8) * source.thumbnail.getSize().width) /
            display.size.width,
        ),
        width: Math.round(
          ((bounds.width + 16) * source.thumbnail.getSize().width) / display.size.width,
        ),
        height: Math.round(
          ((bounds.height + 16) * source.thumbnail.getSize().width) / display.size.width,
        ),
      })
      return corners(scaled, bounds.width + 16, bounds.height + 16)
    },
    test.info().outputPath(`${name}-window.png`),
  )
  if (!captured) return
  await writeFile(
    output(`${name}-corner-upper-left-6x.png`),
    Buffer.from(captured.upperLeft, 'base64'),
  )
  await writeFile(
    output(`${name}-corner-lower-left-6x.png`),
    Buffer.from(captured.lowerLeft, 'base64'),
  )
}

test('the app in the shape of macOS 26: tokens, controls, window, settings, pages and icons', async () => {
  test.setTimeout(300000)
  await mkdir(test.info().outputPath(), { recursive: true })
  const rig = await yukiFixture(),
    app = await rig.launch('apple-style')
  let success = false
  try {
    const page = await app.firstWindow()
    await contentSize(app, page, 1100, 760)
    const platform = await page.evaluate(async () => (await window.yuki.boot()).platform)
    evidence.platform = platform

    // Screenshots, light and dark: the welcome and the connection form.
    for (const theme of ['light', 'dark'] as const) {
      await themed(app, page, theme)
      await expect(page.getByRole('button', { name: '連接已有 Yuki', exact: true })).toBeVisible()
      await shot(page, `welcome-${theme}`)
      await windowCorners(app, `welcome-${theme}`)
    }
    await themed(app, page, 'light')
    // 5, 2: the welcome lies on the window, its one action a 36pt capsule.
    const start = page.getByRole('button', { name: '連接已有 Yuki', exact: true })
    expect.soft(await page.locator('[data-glass="card"]').count(), 'welcome card').toBe(0)
    const welcome = await box(page.locator('[data-page="welcome"]').first()).catch(() => null)
    evidence.welcome = welcome
    expect.soft(welcome, 'the welcome page').not.toBeNull()
    if (welcome) {
      expect.soft(welcome.background, 'welcome background').toBe('rgba(0, 0, 0, 0)')
      expect.soft(welcome.shadow, 'welcome shadow').toBe('none')
    }
    const action = await box(start)
    evidence.welcomeAction = action
    expect.soft(action.height, 'welcome action').toBe(36)
    expect.soft(px(action.radius), 'a capsule').toBeGreaterThanOrEqual(18)
    const input = page
      .getByLabel('配對連結、綁定碼或完整回覆', { exact: true })
      .filter({ visible: true })
    for (const theme of ['dark', 'light'] as const) {
      await themed(app, page, theme)
      await start.click()
      await expect(input).toBeVisible()
      await shot(page, `connection-${theme}`)
    }
    expect.soft(await page.locator('[data-glass="card"]').count(), 'connection card').toBe(0)
    const connection = await box(page.locator('[data-page="connection"] > *').first()).catch(
      () => null,
    )
    evidence.connection = connection
    expect.soft(connection, 'the connection page').not.toBeNull()
    expect.soft(connection?.background, 'connection page').toBe('rgba(0, 0, 0, 0)')
    expect.soft(connection?.shadow, 'connection shadow').toBe('none')

    await pairUI(page, rig.base, await rig.code())
    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
    })
    for (const text of [
      '幫我整理一下這週的訪談筆記，重點放在使用者對新版工作流程的回饋。',
      'Liquid Glass is for the controls; the conversation is content.',
    ]) {
      await composer.fill(text)
      await page.getByRole('button', { name: '送出', exact: true }).click()
      await expect(page.getByText(text, { exact: true })).toBeVisible()
    }
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    await contentSize(app, page, 1100, 760)
    for (const theme of ['light', 'dark'] as const) {
      await themed(app, page, theme)
      await shot(page, `chat-${theme}`)
      await windowCorners(app, `chat-${theme}`)
    }
    await themed(app, page, 'light')

    // 3: the main area reaches the window's edges; the sidebar floats inset (macOS) or is flush.
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    const main = await box(page.locator('[data-region="main"]'))
    const sidebar = await box(page.locator('[data-region="sidebar"]'))
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement)
      return Object.fromEntries(
        [
          '--r-window',
          '--inset',
          '--r-pane',
          '--r-control',
          '--r-group',
          '--h-regular',
          '--h-large',
          '--h-xl',
          '--radius-sm',
          '--font-ui',
        ].map((name) => [name, style.getPropertyValue(name).trim()]),
      )
    })
    evidence.layout = { viewport, main, sidebar, tokens }
    expect.soft(main.margin, 'main margin').toEqual(['0px', '0px', '0px', '0px'])
    expect.soft(main.radius, 'main corner').toBe('0px')
    expect.soft(main.shadow, 'main shadow').toBe('none')
    expect.soft(main.x + main.width, 'main reaches the right edge').toBeCloseTo(viewport.width, 0)
    expect.soft([main.y, main.height], 'main runs top to bottom').toEqual([0, viewport.height])
    // A window narrower than 1100pt folds the sidebar into a pane that opens over the page
    // (geometry.ts); the inset, concentric pane is the docked one.
    const overlay = await page
      .locator('[data-region="sidebar"]')
      .evaluate((node) => node.className.includes('_sidebarOverlay_'))
    evidence.overlaySidebar = overlay
    if (overlay)
      expect.soft(sidebar.margin, 'an overlay sidebar').toEqual(['0px', '0px', '0px', '0px'])
    else if (platform === 'darwin') {
      const inset = px(tokens['--inset']!),
        corner = px(tokens['--r-window']!)
      expect.soft(inset, 'inset').toBeGreaterThan(0)
      expect.soft(sidebar.margin.map(px), 'sidebar inset').toEqual([inset, inset, inset, inset])
      expect.soft(px(sidebar.radius), 'sidebar corner').toBeCloseTo(corner - inset, 1)
    } else {
      expect.soft(sidebar.margin, 'flush sidebar').toEqual(['0px', '0px', '0px', '0px'])
      expect.soft(sidebar.radius, 'flush sidebar corner').toBe('0px')
      expect.soft(px(sidebar.borders[1]!), 'sidebar hairline').toBeGreaterThan(0)
    }

    // 1: tokens.
    expect.soft(tokens['--r-control'], 'control radius').toBe('6px')
    expect.soft(tokens['--r-group'], 'group radius').toBe('10px')
    expect
      .soft([tokens['--h-regular'], tokens['--h-large'], tokens['--h-xl']])
      .toEqual(['24px', '28px', '36px'])
    expect.soft(tokens['--radius-sm'], 'the old unused radii').toBe('')
    // Read from each rule's own text: a shorthand holding var() has no longhand values to read.
    const usage = await page.evaluate(() => {
      const texts: string[] = []
      const walk = (list: CSSRuleList) => {
        for (const rule of list) {
          if (rule instanceof CSSStyleRule) texts.push(rule.cssText)
          else if ('cssRules' in rule && rule.cssRules) walk(rule.cssRules as CSSRuleList)
        }
      }
      for (const sheet of document.styleSheets) walk(sheet.cssRules)
      const defined = new Set<string>(),
        used = new Set<string>(),
        bare: string[] = []
      for (const text of texts) {
        for (const match of text.matchAll(/[{;]\s*(--[\w-]+)\s*:/g)) defined.add(match[1]!)
        for (const match of text.matchAll(/var\((--[\w-]+)/g)) used.add(match[1]!)
        for (const match of text.matchAll(
          /(?:^|[{;\s])(border(?:-[a-z]+)*-radius)\s*:\s*([^;}]+)/g,
        ))
          if (!/var\(--(r|glass)-|^0(px)?$|^50%$|^inherit$/.test(match[2]!.trim()))
            bare.push(
              `${text.slice(0, text.indexOf('{')).trim()} { ${match[1]}: ${match[2]!.trim()} }`,
            )
      }
      const tokens = [...defined].filter((name) => /^--(space-|r-|h-)/.test(name))
      return { unused: tokens.filter((name) => !used.has(name)), bare }
    })
    evidence.usage = usage
    expect.soft(usage.unused, 'tokens defined and never used').toEqual([])
    expect.soft(usage.bare, 'radii written as bare lengths').toEqual([])

    // 6: the content layer is not glass, but frosted: a blur behind a translucent tint (over a
    // pattern; over the plain page there is nothing to soften, and the tint lies alone).
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    await page.evaluate(() => (document.documentElement.dataset.backdrop = 'aurora'))
    const bubbles = await page.locator('article[data-event-id]').evaluateAll((articles) =>
      articles
        .filter((article) =>
          article.querySelector('[data-surface="bubble"], [data-glass="bubble"]'),
        )
        .map((article) => {
          const surface = article.querySelector<HTMLElement>('[data-surface], [data-glass]')!
          const style = getComputedStyle(surface)
          return {
            own: article.matches('[class*="_ownMessage_"]'),
            glass: surface.dataset.glass ?? null,
            rim: getComputedStyle(surface, '::before').content,
            lift: getComputedStyle(surface.parentElement!).boxShadow,
            filter: style.backdropFilter,
            fill: style.backgroundColor,
          }
        }),
    )
    evidence.bubbles = bubbles
    expect.soft(bubbles.length).toBeGreaterThan(0)
    // Without transparency (the system's Reduce Transparency, as on CI's Macs) or without GPU
    // compositing (CI's Linux and Windows) the bubbles are solid.
    const opaque = await page.evaluate(() =>
      document.documentElement.matches('[data-opaque="true"], [data-gpu-compositing="false"]'),
    )
    // The fourth component of rgb()/rgba()/color(), 1 when there is none.
    const alphaOf = (colour: string) => Number(colour.match(/[\d.]+/g)![3] ?? 1)
    for (const bubble of bubbles) {
      expect.soft(bubble.glass, 'a bubble is content, not glass').toBeNull()
      expect.soft(bubble.rim, 'no lit rim').toBe('none')
      expect.soft(bubble.lift, 'no shadow').toBe('none')
      expect.soft(bubble.filter, 'no lens').not.toMatch(/yuki-glass-/)
      if (opaque) {
        expect.soft(bubble.filter, 'opaque: no blur').toBe('none')
        expect.soft(alphaOf(bubble.fill), 'opaque: a solid fill').toBe(1)
      } else {
        expect.soft(bubble.filter, 'frosted').toMatch(/blur\(/)
        expect.soft(alphaOf(bubble.fill), 'a translucent tint').toBeLessThan(1)
      }
    }
    const ownFill = bubbles.find((bubble) => bubble.own)?.fill,
      otherFill = bubbles.find((bubble) => !bubble.own)?.fill
    expect.soft(ownFill, "one's own tint is the accent's, not the neutral one").not.toBe(otherFill)
    await page.evaluate(() => (document.documentElement.dataset.backdrop = 'plain'))
    const preferences = await page.evaluate(async () => (await window.yuki.boot()).preferences)
    expect.soft(preferences.backdrop, 'a new conversation shows no pattern').toBe('plain')

    // 8: icons.
    const strokes = await page
      .locator('[data-region="sidebar"] svg.lucide, [data-region="toolbar"] svg.lucide')
      .evaluateAll((icons) => [...new Set(icons.map((icon) => icon.getAttribute('stroke-width')))])
    evidence.strokes = strokes
    expect.soft(strokes, 'icon strokes').toEqual(['2'])

    // 10: fonts.
    const fonts = tokens['--font-ui']!
    if (platform === 'darwin')
      expect.soft(fonts).toMatch(/^-apple-system, BlinkMacSystemFont, 'PingFang/)
    if (platform === 'win32') expect.soft(fonts).toMatch(/'Segoe UI Variable Text'.*'Segoe UI'/)
    expect
      .soft(fonts, 'Linux: system-ui, Inter, Noto Sans, Noto Sans CJK')
      .toMatch(/system-ui, Inter, 'Noto Sans', 'Noto Sans CJK/)

    // 9: the application menu.
    const icons = await app.evaluate(({ Menu }) => {
      const count = (items: Electron.MenuItem[]): number =>
        items.reduce(
          (sum, item) => sum + (item.icon ? 1 : 0) + (item.submenu ? count(item.submenu.items) : 0),
          0,
        )
      return count(Menu.getApplicationMenu()?.items ?? [])
    })
    evidence.menuIcons = icons
    if (platform === 'darwin') expect.soft(icons, 'SF Symbols in the menu').toBeGreaterThan(8)
    else expect.soft(icons, 'no SF Symbols off macOS').toBe(0)

    // 4, 2: settings.
    await page.keyboard.press('ControlOrMeta+,')
    await expect(page.getByRole('region', { name: '設定', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: '一般', exact: true }).click()
    for (const theme of ['light', 'dark'] as const) {
      await appearance(page, theme)
      await page.getByRole('tab', { name: '一般', exact: true }).click()
      await shot(page, `settings-${theme}`)
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await shot(page, `settings-look-${theme}`)
    }
    await appearance(page, 'light')
    const categories = await box(page.getByRole('tablist', { name: '設定分類' }))
    evidence.settingsSidebar = categories
    if (platform === 'darwin') {
      expect.soft(px(categories.radius), 'settings sidebar corner').toBeGreaterThan(0)
      expect.soft(categories.margin.map(px)[3], 'settings sidebar inset').toBeGreaterThan(0)
    } else expect.soft(categories.radius).toBe('0px')
    const back = page.getByRole('button', { name: '返回', exact: true })
    expect.soft((await back.textContent())?.trim(), 'Back is a chevron').toBe('')
    expect.soft(await back.locator('svg.lucide-chevron-left').count(), 'chevron').toBe(1)
    const segmented = await box(page.getByRole('radiogroup', { name: '主題', exact: true }))
    expect.soft([segmented.height, segmented.radius], 'segmented').toEqual([24, '6px'])
    await page.getByRole('tab', { name: '一般', exact: true }).click()
    const groups = await page.locator('[data-settings-group]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node),
          rows = [...node.querySelectorAll<HTMLElement>('[data-settings-row]')]
        return {
          border: style.borderTopWidth,
          radius: style.borderTopLeftRadius,
          rows: rows.map((row) => row.getBoundingClientRect().height),
          separator: rows[1]
            ? {
                content: getComputedStyle(rows[1], '::before').content,
                left: getComputedStyle(rows[1], '::before').left,
              }
            : null,
        }
      }),
    )
    evidence.groups = groups
    expect.soft(groups.length, 'grouped lists').toBeGreaterThan(1)
    for (const group of groups) {
      expect.soft(group.border, 'no border').toBe('0px')
      expect.soft(group.radius, 'group corner').toBe('10px')
      for (const row of group.rows) expect.soft(row).toBeGreaterThanOrEqual(40)
      if (group.separator) expect.soft(group.separator.left, 'separator at the text').toBe('12px')
    }
    const language = await box(page.locator('[data-settings-row] select').first())
    expect.soft([language.height, language.radius], 'field').toEqual([24, '6px'])
    const toggle = await box(page.getByRole('switch').first())
    expect.soft([toggle.width, toggle.height], 'switch').toEqual([40, 22])

    // 2: a regular button, and a dialog's.
    await page.getByRole('tab', { name: '連線', exact: true }).click()
    const logout = page.getByRole('button', { name: '登出…', exact: true })
    const regular = await box(logout)
    evidence.regular = regular
    expect.soft([regular.height, regular.radius], 'regular button').toEqual([24, '6px'])
    expect.soft(regular.letterSpacing, 'no added tracking').toBe('normal')
    for (const theme of ['light', 'dark'] as const) {
      await appearance(page, theme)
      await page.getByRole('tab', { name: '連線', exact: true }).click()
      await logout.click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await shot(page, `dialog-${theme}`)
      const buttons = await page
        .getByRole('dialog')
        .locator('footer button')
        .evaluateAll((nodes) =>
          nodes.map((node) => [
            node.getBoundingClientRect().height,
            getComputedStyle(node).borderTopLeftRadius,
          ]),
        )
      evidence[`dialog-${theme}`] = buttons
      for (const [height, radius] of buttons) {
        expect.soft(height, 'dialog button').toBe(28)
        expect.soft(px(radius as string), 'a capsule').toBeGreaterThanOrEqual(14)
      }
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
    }

    // 7: a picture of one's own reaches the window's edges, under the sidebar.
    await appearance(page, 'light')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const layer = await page.evaluate(() => {
      document.documentElement.dataset.backdrop = 'custom'
      const chat = document
        .querySelector('[role="log"]')!
        .closest<HTMLElement>('[class*="_chat_"]')!
      const style = getComputedStyle(chat, '::before')
      return { position: style.position, inset: [style.top, style.left] }
    })
    evidence.customLayer = layer
    expect.soft(layer.position, 'the picture lies under the whole window').toBe('fixed')
    await page.evaluate(() => (document.documentElement.dataset.backdrop = 'plain'))

    // 6: a message's text over the plain page and every pattern, light and dark.
    const reply = page
        .locator('article[data-event-id]')
        .filter({ hasText: 'Desktop reference reply' })
        .first(),
      own = page.locator('article[data-event-id]').filter({ hasText: 'fixture file' }).first()
    const texts: [string, Locator, number][] = [
      ['reply', reply.getByText('Desktop reference reply', { exact: true }), 4.5],
      ['reply time', reply.locator('header time'), 3],
      ['own message', own.getByText('fixture file', { exact: true }), 4.5],
      ['own sender', own.locator('header strong'), 3],
      ['own time', own.locator('header time'), 3],
    ]
    const legibility: Record<string, Record<string, number>> = {}
    evidence.legibility = legibility
    for (const theme of ['light', 'dark'] as const) {
      await themed(app, page, theme)
      await expect(reply).toBeVisible()
      for (const backdrop of ['plain', 'lens', 'aurora', 'sunset', 'grid']) {
        await page.evaluate(
          (backdrop) => (document.documentElement.dataset.backdrop = backdrop),
          backdrop,
        )
        await page.waitForTimeout(300)
        if (backdrop === 'plain' || backdrop === 'aurora')
          await shot(page, `bubbles-${backdrop}-${theme}`)
        const seen: Record<string, number> = {}
        for (const [name, text] of texts) seen[name] = await legible(page, text)
        legibility[`${theme} ${backdrop}`] = seen
        for (const [name, , least] of texts)
          expect.soft(seen[name], `${theme} ${backdrop} ${name}`).toBeGreaterThanOrEqual(least)
      }
    }
    await page.evaluate(() => (document.documentElement.dataset.backdrop = 'plain'))
    await themed(app, page, 'light')
    await closeUps(page, page.locator('[data-region="composer"]'), 'composer-light')

    // The chat over a picture of one's own (line art drawn for the test), light and dark.
    const lineart = test.info().outputPath('lineart.png')
    await writeFile(lineart, await picture(page, 'lineart'))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
    }, lineart)
    for (const theme of ['light', 'dark'] as const) {
      await page.keyboard.press('ControlOrMeta+,')
      await appearance(page, theme)
      if (theme === 'light')
        await page
          .getByRole('radiogroup', { name: '對話背景', exact: true })
          .getByRole('radio', { name: '自訂圖片', exact: true })
          .click()
      await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await expect(reply).toBeVisible()
      await shot(page, `chat-custom-${theme}`)
      await closeUps(page, page.locator('[data-region="composer"]'), `composer-custom-${theme}`)
    }
    await page.keyboard.press('ControlOrMeta+,')
    await appearance(page, 'light')
    await page
      .getByRole('radiogroup', { name: '對話背景', exact: true })
      .getByRole('radio', { name: '無', exact: true })
      .click()
    await page.getByRole('button', { name: '返回', exact: true }).click()

    // 11: a message sent while the server is away waits, and says so below its bubble.
    await rig.stop()
    const waiting = '伺服器離線時送出的訊息'
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` })
      .fill(waiting)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const pending = page.locator('article').filter({ hasText: waiting }).last()
    const note = pending.locator('[data-message-note]')
    await expect(note).toBeVisible({ timeout: 20000 })
    await shot(page, 'chat-unsent-light')
    expect
      .soft(await note.evaluate((node) => !!node.closest('[data-bubble-copy]')), 'below the bubble')
      .toBe(false)
    const notes: Record<string, number> = {}
    for (const text of await note.locator('span, button').filter({ hasText: /\S/ }).all())
      notes[(await text.textContent())!.trim()] = await legible(page, text)
    evidence.unsent = notes
    expect.soft(Object.keys(notes).length, 'a note').toBeGreaterThan(0)
    for (const [text, ratio] of Object.entries(notes))
      expect.soft(ratio, `the note: ${text}`).toBeGreaterThanOrEqual(4.5)
    await rig.restart()
    success = true
  } finally {
    await writeFile(output('apple-style.json'), JSON.stringify(evidence, null, 2) + '\n')
    await app.close()
    await rig.close(success)
  }
})
