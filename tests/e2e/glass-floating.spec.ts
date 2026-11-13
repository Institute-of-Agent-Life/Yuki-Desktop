import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// 液态玻璃组件统一任务书 (2026-11-12), steps 4 and 6: what floats over content is frost or a lens,
// what lies in it is content, lone toolbar controls sit in their own capsules, glass never lies
// on glass at rest, and no hidden glass costs a frame. Failure cases 1, 3 and 14, and Q2–Q3.
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('glass-floating.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

type GlassWindow = Window & {
  regression: {
    connection(state: 'online' | 'offline'): void
    receiveGlassReply(text: string): void
  }
}

// Every filtering element the page draws, and the problems among them.
const audit = (page: Page) =>
  page.evaluate(() => {
    const filtering = (element: Element) => getComputedStyle(element).backdropFilter !== 'none'
    const all = [...document.querySelectorAll('*')].filter(
      (element) => filtering(element) && !element.hasAttribute('data-edge-fade'),
    )
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()}[${element.getAttribute('data-glass') ?? element.getAttribute('aria-label') ?? element.className}]`
    const inView = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight
    }
    return {
      stacked: all
        .filter((element) => {
          for (let parent = element.parentElement; parent; parent = parent.parentElement)
            if (filtering(parent)) return true
          return false
        })
        .map(describe),
      hidden: all
        .filter((element) => {
          const style = getComputedStyle(element)
          return (
            element.getBoundingClientRect().width > 0 &&
            (style.opacity === '0' || style.visibility === 'hidden')
          )
        })
        .map(describe),
      lenses: all
        .filter((element) => getComputedStyle(element).backdropFilter.includes('#yuki-glass-'))
        .filter(inView).length,
    }
  })

async function openConversation(page: Page, height = 820) {
  await page.setViewportSize({ width: 1280, height })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-glass')
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as GlassWindow).regression.connection('online'))
  await page.waitForTimeout(600)
}

test('floating pieces are frost or lenses, what lies in the conversation is content', async ({
  page,
}) => {
  await openConversation(page)
  // Q3: the lone toolbar controls each sit in a lens capsule.
  const sidebar = page.getByRole('button', { name: '側邊欄', exact: true })
  expect(await sidebar.evaluate((button) => button.parentElement!.getAttribute('data-glass'))).toBe(
    'toolbar',
  )
  // 1: a message's actions are frost while shown and draw nothing at rest; a code block's copy
  // button is content, a fill.
  const message = page.locator('article[data-event-id="34"]')
  const actions = message.locator('[data-message-actions]')
  expect(await actions.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe('none')
  await message.hover()
  await expect
    .poll(() => actions.evaluate((element) => getComputedStyle(element).backdropFilter))
    .toMatch(/^blur\(12px\)/)
  const rest = await audit(page)
  evidence.conversation = rest
  // 3 and 14: no glass on glass, no hidden glass, few lenses.
  expect(rest.stacked).toEqual([])
  expect(rest.hidden).toEqual([])
  expect(rest.lenses).toBeLessThanOrEqual(12)
})

test('the new-messages pill is a lens and notices over the conversation are frost', async ({
  page,
}) => {
  await openConversation(page, 460)
  const log = page.getByRole('log', { name: '對話訊息' })
  await log.evaluate((node) => (node.scrollTop = 0))
  await page.waitForTimeout(300)
  await page.evaluate(() =>
    (window as unknown as GlassWindow).regression.receiveGlassReply('捲走時到來的新訊息'),
  )
  const pill = page.getByRole('button', { name: /新訊息/ })
  await expect(pill).toBeVisible()
  // 1: the pill floats over the conversation as a lens.
  await expect(pill).toHaveAttribute('data-refracting', 'true')
  expect(await pill.evaluate((element) => getComputedStyle(element).backdropFilter)).toContain(
    '#yuki-glass-',
  )
  await page.evaluate(() => (window as unknown as GlassWindow).regression.connection('offline'))
  const notice = page.locator('[data-floating-notices] [role="status"]').first()
  await expect(notice).toBeVisible()
  expect(await notice.evaluate((element) => getComputedStyle(element).backdropFilter)).toMatch(
    /^blur\(12px\)/,
  )
  const shown = await audit(page)
  evidence.notices = shown
  expect(shown.stacked).toEqual([])
  expect(shown.hidden).toEqual([])
  await page.screenshot({ path: test.info().outputPath('floating.png') })
})

test('secondary buttons are lit glass without a filter (Q2)', async ({ page }) => {
  await page.goto('http://127.0.0.1:4178/components.html')
  const secondary = page.locator('button[data-glass="button"]').first()
  await expect(secondary).toBeVisible()
  const look = await secondary.evaluate((element) => ({
    filter: getComputedStyle(element).backdropFilter,
    rim: getComputedStyle(element, '::before').backgroundImage,
  }))
  evidence.secondary = look
  expect(look.filter).toBe('none')
  expect(look.rim).toContain('linear-gradient')
  const gallery = await audit(page)
  evidence.gallery = gallery
  expect(gallery.stacked).toEqual([])
  expect(gallery.hidden).toEqual([])
})
