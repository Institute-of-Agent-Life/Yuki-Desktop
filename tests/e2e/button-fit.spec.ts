import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { resources, type Language } from '../../src/shared/locales'

/*
 * Long button labels and the flashing receipt refresh (task book 2026-11-20), through the real
 * renderer views of 「這台電腦」 and the Works delegations with the renderer fixtures. Failure cases,
 * written before the fix:
 * (a) A visible labelled button (the shared Button, a tab or a segment) has its label run past
 *     it: its scroll size exceeds its box, the label's text sits outside the button's box, or the
 *     label wraps to more than two lines. Checked on
 *     「這台電腦」 (native tasks with this device's delegations, terminals, the connector settings),
 *     the original receipt and terminal receipt dialogs and the Works delegation views, in
 *     zh-Hans, zh-Hant and en, at the app's normal size (1440×900), its minimum window (960×640)
 *     and a narrower width (600×720, below the app's minimum, for dialogs on narrow widths).
 * (b) Two buttons overlap, a button sticks out of its dialog, settings row or the window, or an
 *     ancestor that clips horizontally cuts it.
 * (c) While the stream's `refresh` hint reads a receipt again in the background, with no click,
 *     any button on the page or in the receipt changes disabled, aria-busy, class, colour,
 *     opacity or size.
 * (d) During that background read the receipt's content goes away or 「正在讀取…」 appears.
 * (e) A clicked refresh shows no loading (aria-busy, then the spinner) while its own read runs,
 *     or keeps showing it after that read has settled.
 * Output: one screenshot per view, language and size, `button-fit.json` with every finding, and
 * `background-*.json` with the sampled button states and the clicked refresh's timeline.
 */

test.use({ actionTimeout: 15000 })

const languages: Language[] = ['zh-Hans', 'zh-Hant', 'en']
const sizes = [
  [1440, 900],
  [960, 640],
  [600, 720],
] as const
const fixture = 'http://127.0.0.1:4178'

interface Finding {
  view: string
  kind: 'overflow' | 'label-outside' | 'lines' | 'overlap' | 'outside' | 'clipped'
  text: string
  detail?: string
}

/** Every visible labelled button of the open dialog, or of the page when none is open. */
async function measure(page: Page, view: string) {
  const found = await page.evaluate(() => {
    const result: Omit<Finding, 'view'>[] = []
    const dialog = document.querySelector('dialog[open]')
    const scope = dialog ?? document.body
    const shown = (element: Element) => {
      const rect = element.getBoundingClientRect()
      // checkVisibility leaves out the contents of a closed <details> and hidden panels.
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        element.checkVisibility({ visibilityProperty: true }) &&
        !element.closest('[inert], [aria-hidden="true"]')
      )
    }
    const label = (element: Element) =>
      (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 60)
    // Buttons with a label: the shared Button, tabs and segments. A list row that is a button
    // (a Works row) truncates its own title by design and is not a label.
    const buttons = [
      ...scope.querySelectorAll('[data-press="button"], [role="tab"], [role="radio"]'),
    ].filter(shown) as HTMLElement[]
    for (const button of buttons) {
      const text = label(button)
      const box = button.getBoundingClientRect()
      if (
        button.scrollWidth > button.clientWidth + 1 ||
        button.scrollHeight > button.clientHeight + 1
      )
        result.push({
          kind: 'overflow',
          text,
          detail: `${button.scrollWidth}×${button.scrollHeight} in ${button.clientWidth}×${button.clientHeight}`,
        })
      // The label's own text: its lines and the box they make.
      const lines = new Set<number>()
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent!.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) {
          if (!rect.width) continue
          lines.add(Math.round(rect.top))
          if (
            rect.left < box.left - 1 ||
            rect.right > box.right + 1 ||
            rect.top < box.top - 1 ||
            rect.bottom > box.bottom + 1
          )
            result.push({
              kind: 'label-outside',
              text,
              detail: `text ${Math.round(rect.left)}–${Math.round(rect.right)} in ${Math.round(box.left)}–${Math.round(box.right)}`,
            })
        }
      }
      if (lines.size > 2) result.push({ kind: 'lines', text, detail: `${lines.size} lines` })
      const container = dialog ?? button.closest('[data-settings-row]')
      const bounds = container?.getBoundingClientRect() ?? { left: 0, right: innerWidth }
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1)
        result.push({
          kind: 'outside',
          text,
          detail: container?.tagName.toLowerCase() ?? 'window',
        })
      for (
        let parent = button.parentElement;
        parent && parent !== scope.parentElement;
        parent = parent.parentElement
      ) {
        if (getComputedStyle(parent).overflowX === 'visible') continue
        const clip = parent.getBoundingClientRect()
        if (box.left < clip.left - 1 || box.right > clip.right + 1)
          result.push({ kind: 'clipped', text, detail: parent.className || parent.tagName })
      }
    }
    for (const [index, one] of buttons.entries())
      for (const other of buttons.slice(index + 1)) {
        const a = one.getBoundingClientRect(),
          b = other.getBoundingClientRect()
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left),
          height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (width > 1 && height > 1)
          result.push({ kind: 'overlap', text: label(one), detail: label(other) })
      }
    return result
  })
  return found.map((item) => ({ ...item, view }))
}

/** Sheets morph open and segment thumbs slide: wait for finite animations (spinners loop). */
const settle = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((item) => item.effect?.getComputedTiming().iterations !== Infinity)
        .map((item) => item.finished.catch(() => {})),
    ),
  )

async function open(page: Page, url: string, language: Language) {
  await page.goto(`${fixture}/${url}`)
  await page.evaluate(
    (language) =>
      (window as Window & { __applyLanguage?: (value: string) => void }).__applyLanguage!(language),
    language,
  )
  await expect(page.locator('html')).toHaveAttribute('lang', language)
}

test('「這台電腦」, its receipts and the delegation views keep every label inside its button, in three languages and three widths', async ({
  page,
}) => {
  test.setTimeout(10 * 60 * 1000)
  const findings: Finding[] = []
  const check = async (name: string) => {
    await settle(page)
    const dialog = (await page.locator('dialog[open]').count()) > 0
    await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: !dialog })
    findings.push(...(await measure(page, name)))
  }
  for (const language of languages)
    for (const [width, height] of sizes) {
      const w = resources[language]
      const at = `${language}-${width}x${height}`
      await page.setViewportSize({ width, height })

      // 這台電腦 → 原生 Agent 任務, with this device's delegations, and the receipt of a
      // delegation: queue, steer, end, cancel, refresh and close in one footer.
      await open(page, 'delegations.html?view=connector', language)
      await expect(page.getByRole('region', { name: w.connector.tasks.here })).toBeVisible()
      await check(`connector-tasks-${at}`)
      const receipts = page.getByRole('button', { name: w.connector.tasks.viewReceipt })
      await receipts.nth(1).click()
      const delegated = page.getByRole('dialog', {
        name: w.connector.tasks.operation.replace('{{id}}', 'op-claude'),
      })
      await expect(delegated.getByRole('button', { name: 'allow', exact: true })).toBeVisible()
      await check(`receipt-delegation-${at}`)
      await page.keyboard.press('Escape')
      await expect(delegated).toHaveCount(0)

      // A server before Client API 14: the watch keeps its answers and the previous wording.
      await open(page, 'delegations.html?view=connector&revision=13', language)
      await page.getByRole('button', { name: w.connector.tasks.viewReceipt }).first().click()
      const legacy = page.getByRole('dialog', {
        name: w.connector.tasks.operation.replace('{{id}}', 'op-watch'),
      })
      await expect(legacy.getByRole('button', { name: 'allow', exact: true })).toBeVisible()
      await check(`receipt-legacy-${at}`)

      // Works: the running view by device and a delegation's own detail.
      await open(page, 'delegations.html?work=deleg-claude', language)
      await expect(page.locator('[data-native-request="501"]').first()).toBeVisible()
      await check(`works-delegation-${at}`)

      // 這台電腦 in the app's page: native tasks with a long receipt, then the terminal receipt
      // with its stop sent and unconfirmed (resend and verify join the footer).
      await open(page, 'components.html?connector=operation-detail&view=local', language)
      await expect(page.getByRole('tablist', { name: w.connector.tasks.activity })).toBeVisible()
      await check(`local-computer-${at}`)
      await page.getByRole('button', { name: w.connector.tasks.viewReceipt, exact: true }).click()
      const operation = page.getByRole('dialog', {
        name: w.connector.tasks.operation.replace('{{id}}', 'original-operation'),
      })
      await expect(operation.getByText('第一頁原進度', { exact: true })).toBeVisible()
      await check(`receipt-operation-${at}`)

      await open(page, 'components.html?connector=terminal-detail&view=local', language)
      await page.getByRole('tab', { name: w.connector.tasks.terminals, exact: true }).click()
      await page
        .getByRole('button', { name: w.connector.terminals.viewReceipt, exact: true })
        .click()
      const terminal = page.getByRole('dialog', {
        name: w.connector.terminals.run.replace('{{id}}', 'original-terminal'),
      })
      await expect(terminal.locator('pre').filter({ hasText: 'hello' })).toBeVisible()
      await terminal.getByRole('button', { name: w.connector.terminals.stop, exact: true }).click()
      await expect(
        terminal.getByRole('button', { name: w.connector.terminals.verifyStop, exact: true }),
      ).toBeVisible()
      await check(`receipt-terminal-${at}`)

      // The connector's own settings with an update waiting.
      await open(page, 'components.html?connector=control-outdated', language)
      await expect(page.getByRole('button', { name: w.connector.updateKeepData })).toBeVisible()
      await check(`connector-settings-${at}`)
    }
  await writeFile(test.info().outputPath('button-fit.json'), JSON.stringify(findings, null, 2))
  expect(findings).toEqual([])
})

/** Samples every button's look on each frame, and whether the receipt shows its content. */
async function startSampling(page: Page, reading: string, content: string) {
  await page.evaluate(
    ({ reading, content }) => {
      const buttons: Record<string, string[]> = {}
      const receipt: string[] = []
      let running = true
      const record = (list: string[], state: string) => {
        if (list.at(-1) !== state) list.push(state)
      }
      const tick = () => {
        const seen = new Map<string, number>()
        for (const button of document.querySelectorAll('button')) {
          if (button.closest('[hidden]')) continue
          const text = (button.textContent ?? '').trim()
          const index = seen.get(text) ?? 0
          seen.set(text, index + 1)
          const style = getComputedStyle(button),
            box = button.getBoundingClientRect()
          record(
            (buttons[`${text}#${index}`] ??= []),
            JSON.stringify({
              disabled: button.disabled,
              busy: button.getAttribute('aria-busy'),
              className: button.className,
              background: style.backgroundColor,
              color: style.color,
              opacity: style.opacity,
              size: [Math.round(box.width), Math.round(box.height)],
            }),
          )
        }
        const dialog = document.querySelector('dialog[open]')
        const text = dialog?.textContent ?? ''
        record(
          receipt,
          JSON.stringify({ reading: text.includes(reading), content: text.includes(content) }),
        )
        if (running) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      Object.assign(window, {
        __sampling: {
          stop: () => {
            running = false
            return { buttons, receipt }
          },
        },
      })
    },
    { reading, content },
  )
}
const stopSampling = (page: Page) =>
  page.evaluate(() =>
    (
      window as Window & {
        __sampling?: {
          stop(): { buttons: Record<string, string[]>; receipt: string[] }
        }
      }
    ).__sampling!.stop(),
  )

/** A clicked refresh: busy at once, its spinner while the read runs, and idle once it settles. */
async function clickedRefresh(button: Locator) {
  const handle = (await button.elementHandle())!
  const timeline: { at: number; busy: string | null; spinner: string | null }[] = []
  const started = Date.now()
  const sample = async () =>
    timeline.push({
      at: Date.now() - started,
      ...(await handle.evaluate((element) => ({
        busy: element.getAttribute('aria-busy'),
        spinner: element.querySelector('[data-shown]')?.getAttribute('data-shown') ?? null,
      }))),
    })
  await handle.click()
  await sample()
  await expect.poll(async () => (await sample(), timeline.at(-1)!.spinner)).toBe('true')
  await expect
    .poll(async () => (await sample(), timeline.at(-1)!.busy), { timeout: 10000 })
    .toBe('false')
  await sample()
  return timeline
}

test('a background read of a receipt leaves its buttons and content still; only a clicked refresh shows loading', async ({
  page,
}) => {
  const w = resources['zh-Hant'].connector
  await page.setViewportSize({ width: 1440, height: 900 })

  // The original receipt of a delegation (這台電腦 → 原生 Agent 任務).
  await page.goto(`${fixture}/delegations.html?view=connector`)
  await page.getByRole('button', { name: w.tasks.viewReceipt, exact: true }).nth(1).click()
  const receipt = page.getByRole('dialog', { name: 'op-claude', exact: false })
  await expect(receipt.getByRole('button', { name: 'allow', exact: true })).toBeVisible()
  await settle(page)
  // Each read of the receipt takes a while, as it does over a real connection.
  await page.evaluate(() => {
    const read = window.yuki.connector.operation
    window.yuki.connector.operation = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      return read(...args)
    }
  })
  const reads = () =>
    page.evaluate(
      () =>
        (window as Window & { __calls?: { reads: string[] } }).__calls!.reads.filter((read) =>
          read.startsWith('operation:op-claude'),
        ).length,
    )
  const content = w.statusLine.replace('{{status}}', 'running')
  await startSampling(page, w.tasks.readingReceipt, content)
  let before = await reads()
  for (let round = 0; round < 3; round++) {
    await page.evaluate(() => (window as unknown as { __bumpRecords(): void }).__bumpRecords())
    await expect.poll(reads).toBeGreaterThan(before)
    before = await reads()
    await page.waitForTimeout(1200)
  }
  const background = await stopSampling(page)
  await writeFile(
    test.info().outputPath('background-receipt.json'),
    JSON.stringify(background, null, 2),
  )
  await page.screenshot({ path: test.info().outputPath('background-receipt.png') })
  expect(Object.entries(background.buttons).filter(([, states]) => states.length > 1)).toEqual([])
  expect(background.receipt).toEqual([JSON.stringify({ reading: false, content: true })])

  const refresh = receipt.getByRole('button', { name: w.tasks.refreshReceipt, exact: true })
  const clicked = await clickedRefresh(refresh)
  await writeFile(
    test.info().outputPath('clicked-receipt.json'),
    JSON.stringify({ clicked, reads: await reads() }, null, 2),
  )
  expect(await reads()).toBeGreaterThan(before)

  // The terminal receipt (這台電腦 → 終端執行).
  await page.goto(`${fixture}/components.html?connector=terminal-detail&view=local`)
  await page.getByRole('tab', { name: w.tasks.terminals, exact: true }).click()
  await page.getByRole('button', { name: w.terminals.viewReceipt, exact: true }).click()
  const terminal = page.getByRole('dialog', { name: 'original-terminal', exact: false })
  await expect(terminal.locator('pre').filter({ hasText: 'hello' })).toBeVisible()
  await settle(page)
  let terminalReads = 0
  await page.exposeFunction('__terminalRead', () => terminalReads++)
  await page.evaluate(() => {
    const read = window.yuki.connector.terminal
    window.yuki.connector.terminal = async (...args) => {
      ;(window as unknown as { __terminalRead(): void }).__terminalRead()
      await new Promise((resolve) => setTimeout(resolve, 800))
      return read(...args)
    }
  })
  await startSampling(
    page,
    w.terminals.readingReceipt,
    w.statusLine.replace('{{status}}', 'running'),
  )
  for (let round = 0; round < 3; round++) {
    const seen = terminalReads
    await page.evaluate(() =>
      (window as Window & { __connectorAdvance?: (phase: string) => void }).__connectorAdvance!(
        'initial',
      ),
    )
    await expect.poll(() => terminalReads).toBeGreaterThan(seen)
    await page.waitForTimeout(1200)
  }
  const terminalBackground = await stopSampling(page)
  await writeFile(
    test.info().outputPath('background-terminal.json'),
    JSON.stringify(terminalBackground, null, 2),
  )
  await page.screenshot({ path: test.info().outputPath('background-terminal.png') })
  expect(
    Object.entries(terminalBackground.buttons).filter(([, states]) => states.length > 1),
  ).toEqual([])
  expect(terminalBackground.receipt).toEqual([JSON.stringify({ reading: false, content: true })])
  const seen = terminalReads
  const terminalClicked = await clickedRefresh(
    terminal.getByRole('button', { name: w.terminals.refreshReceipt, exact: true }),
  )
  await writeFile(
    test.info().outputPath('clicked-terminal.json'),
    JSON.stringify({ clicked: terminalClicked, reads: terminalReads }, null, 2),
  )
  expect(terminalReads).toBeGreaterThan(seen)
})
