import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'
import { legible } from '../fixtures/legibility'
import { picture, type Picture } from '../fixtures/pictures'

/*
 * Glass that carries text takes the appearance the picture under it needs, as iOS 26's glass
 * does (materials/appearance.ts): the composer, the toolbar's capsules, the sidebar and each
 * bubble turn to the dark glass with white ink over a dark part of a picture of one's own, and to
 * the light glass with black ink over a bright one, whatever the theme, each by what lies under
 * itself. Near the threshold it holds its appearance (±0.05 of luma) while the window resizes,
 * and it turns over a cross-fade, not at once.
 *
 * Fails when: light glass keeps black ink over dark line art (or dark glass white ink over a very
 * bright picture); an element turns back and forth while the window is resized near the
 * threshold; the turn is instant; or its text is not legible (4.5:1 at the worst 1% of pixels).
 */
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('adaptive-glass.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

async function settings(page: Page, theme: 'light' | 'dark') {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '外觀', exact: true }).click()
  await page
    .getByRole('radiogroup', { name: '主題', exact: true })
    .getByRole('radio', { name: theme === 'dark' ? '深色' : '淺色', exact: true })
    .click()
  await expect(page.locator(`html[data-theme="${theme}"]`)).toBeAttached()
}

const preferences = (page: Page) =>
  page.evaluate(async () => (await window.yuki.boot()).preferences)

/** Chooses `kind` as the picture of one's own (from the settings), back in the chat after. */
async function choose(app: ElectronApplication, page: Page, kind: Picture, first: boolean) {
  const path = test.info().outputPath(`${kind}.png`)
  await writeFile(path, await picture(page, kind))
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
  }, path)
  if (first)
    await page
      .getByRole('radiogroup', { name: '對話背景', exact: true })
      .getByRole('radio', { name: '自訂圖片', exact: true })
      .click()
  else await page.getByRole('button', { name: '選擇圖片…', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-backdrop', 'custom')
  await expect.poll(async () => (await preferences(page)).customBackdrop.light).toBeTruthy()
  return (await preferences(page)).customBackdrop.light!
}

async function back(page: Page) {
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
  await page.waitForTimeout(1200)
}

/** Chooses `kind` as the picture of one's own from the chat's menu, staying in the chat. */
async function fromMenu(app: ElectronApplication, page: Page, kind: Picture) {
  const path = test.info().outputPath(`${kind}.png`)
  await writeFile(path, await picture(page, kind))
  await app.evaluate(({ dialog, Menu }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
    Menu.prototype.popup = function (this: Electron.Menu) {
      this.items.find((item) => item.label === '更換背景…')!.click()
    }
  }, path)
  const log = page.locator('[role="log"]').first()
  const box = (await log.boundingBox())!
  await page.mouse.click(box.x + 12, box.y + box.height / 2, { button: 'right' })
}

/** Sets the picture of one's own to be tiled at its own size. */
async function tiled(page: Page) {
  await page
    .getByRole('radiogroup', { name: '顯示方式', exact: true })
    .getByRole('radio', { name: '並排', exact: true })
    .click()
}

function glass(page: Page) {
  const reply = page
    .locator('article')
    .filter({ hasText: 'Desktop reference reply' })
    .first()
    .locator('[data-bubble-copy]')
    .locator('..')
  return {
    composer: page.locator('[data-region="composer"]'),
    toolbar: page.locator('[data-region="toolbar"] [data-glass="toolbar"]').first(),
    sidebar: page.locator('[data-region="sidebar"]'),
    reply,
  } satisfies Record<string, Locator>
}

const appearances = async (page: Page) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(glass(page)).map(
        async ([name, element]) => [name, await element.getAttribute('data-appearance')] as const,
      ),
    ),
  )

test('text-bearing glass turns dark over dark pictures and light over bright ones, with ink to match', async () => {
  test.setTimeout(300000)
  await mkdir(test.info().outputPath(), { recursive: true })
  const rig = await yukiFixture(),
    app = await rig.launch('adaptive-glass')
  let success = false
  try {
    const page = await app.firstWindow()
    await contentSize(app, page, 1100, 760)
    await pairUI(page, rig.base, await rig.code())
    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
    })
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    await composer.fill('看得清楚嗎？')
    const texts = (page: Page) => ({
      composer,
      reply: page.getByText('Desktop reference reply', { exact: true }).first(),
      title: page.locator('[data-region="toolbar"] strong').first(),
      sidebar: page
        .locator('[data-region="sidebar"]')
        .getByText('桌面對話', { exact: true })
        .first(),
    })
    const ink = (text: Locator) =>
      text.evaluate((element) => {
        const [r, g, b] = getComputedStyle(element)
          .color.match(/[\d.]+/g)!
          .map(Number)
        return (r! + g! + b!) / 3
      })

    // Dark line art in the light theme: dark glass, white ink.
    await settings(page, 'light')
    await choose(app, page, 'nightlines', true)
    await back(page)
    await page.screenshot({ path: test.info().outputPath('nightlines-light.png') })
    const overNight = await appearances(page)
    evidence['nightlines light'] = { appearance: overNight }
    for (const [name, shown] of Object.entries(overNight))
      expect.soft(shown, `nightlines light: ${name}`).toBe('dark')
    const seenNight: Record<string, number> = {}
    for (const [name, text] of Object.entries(texts(page))) {
      expect.soft(await ink(text), `nightlines light: ${name}'s ink is white`).toBeGreaterThan(200)
      seenNight[name] = await legible(page, text)
      expect.soft(seenNight[name], `nightlines light: ${name}`).toBeGreaterThanOrEqual(4.5)
    }
    ;(evidence['nightlines light'] as Record<string, unknown>).contrast = seenNight

    // A very bright picture chosen from the chat's own menu, in place: the glass turns light over
    // a cross-fade of about 200ms, the ink passing through greys on its way from white to black.
    const fade = composer.evaluate(
      (element) =>
        new Promise<{ levels: number[]; transitions: string[] }>((resolve) => {
          const levels: number[] = [],
            transitions = new Set<string>(),
            start = performance.now()
          const glass = element.closest<HTMLElement>('[data-region="composer"]')!
          const step = () => {
            const [r] = getComputedStyle(element)
              .color.match(/[\d.]+/g)!
              .map(Number)
            levels.push(r!)
            for (const animation of glass.getAnimations())
              if (animation instanceof CSSTransition)
                transitions.add(
                  `${animation.transitionProperty} ${animation.effect?.getComputedTiming().duration}`,
                )
            if (performance.now() - start < 4000) requestAnimationFrame(step)
            else resolve({ levels, transitions: [...transitions] })
          }
          step()
        }),
    )
    await fromMenu(app, page, 'snow')
    const { levels, transitions } = await fade
    evidence.fade = { levels, transitions }
    expect.soft(levels.at(-1), 'the ink ends black').toBeLessThan(40)
    expect.soft(transitions, 'the ink cross-fades over 200ms').toContain('--text-primary 200')
    expect
      .soft(
        levels.filter((level) => level > 50 && level < 205).length,
        'the ink passes through greys rather than turning at once',
      )
      .toBeGreaterThan(0)
    for (const [name, shown] of Object.entries(await appearances(page)))
      expect.soft(shown, `snow light: ${name}`).toBe('light')

    // The dark theme over the very bright picture: light glass, black ink.
    await settings(page, 'dark')
    await back(page)
    await page.screenshot({ path: test.info().outputPath('snow-dark.png') })
    const darkOverSnow = await appearances(page)
    evidence['snow dark'] = { appearance: darkOverSnow }
    for (const [name, shown] of Object.entries(darkOverSnow))
      expect.soft(shown, `snow dark: ${name}`).toBe('light')
    const seenSnow: Record<string, number> = {}
    for (const [name, text] of Object.entries(texts(page))) {
      expect.soft(await ink(text), `snow dark: ${name}'s ink is black`).toBeLessThan(60)
      seenSnow[name] = await legible(page, text)
      expect.soft(seenSnow[name], `snow dark: ${name}`).toBeGreaterThanOrEqual(4.5)
    }
    ;(evidence['snow dark'] as Record<string, unknown>).contrast = seenSnow
    // And dark again over the dark line art, in the dark theme.
    await fromMenu(app, page, 'nightlines')
    // Once the picture has been read (its blurred copy made).
    await expect
      .poll(async () => Object.values(await appearances(page)), { timeout: 20000 })
      .toEqual(['dark', 'dark', 'dark', 'dark'])
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('near the threshold the glass keeps its appearance while the window resizes', async () => {
  test.setTimeout(300000)
  await mkdir(test.info().outputPath(), { recursive: true })
  const rig = await yukiFixture(),
    app = await rig.launch('adaptive-glass-hysteresis')
  let success = false
  try {
    const page = await app.firstWindow()
    await contentSize(app, page, 1100, 760)
    await pairUI(page, rig.base, await rig.code())
    await expect(page.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible()
    await settings(page, 'light')
    // Tiled at its own size, a grey running from level 77 at the left to 173 at the right: the
    // composer, centred in the chat beside the sidebar, lies over about level 118 (the threshold)
    // and moves 3 levels either way as the window narrows and widens, crossing it each time.
    await choose(app, page, 'ramp-77-173', true)
    await tiled(page)
    await back(page)
    const steps: Record<string, string | null>[] = []
    for (const width of [1100, 1000, 1200, 1050, 1150, 1000, 1200, 1100]) {
      await contentSize(app, page, width, 760)
      await page.waitForTimeout(500)
      steps.push({ width: String(width), ...(await appearances(page)) })
    }
    evidence.resizing = steps
    for (const name of Object.keys(glass(page)))
      expect
        .soft(
          new Set(steps.map((step) => step[name]).filter(Boolean)).size,
          `${name} holds one appearance (the sidebar folds away in a narrow window)`,
        )
        .toBe(1)
    expect
      .soft(steps[0]!.composer, 'the composer is glass with an appearance')
      .toMatch(/light|dark/)
    // Beyond the band it does turn.
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await choose(app, page, 'level-150', false)
    await back(page)
    expect.soft(await glass(page).composer.getAttribute('data-appearance')).toBe('light')
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await choose(app, page, 'level-86', false)
    await back(page)
    expect.soft(await glass(page).composer.getAttribute('data-appearance')).toBe('dark')
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
