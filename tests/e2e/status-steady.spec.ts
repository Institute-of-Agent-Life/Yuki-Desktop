import { expect, test, type Locator, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

/*
 * Status text that flashes with background reads (Settings → Connection → Server → Status
 * flashing between 「已連線」 and 「正在確認…」), through the real Settings and Computer views with
 * the renderer fixture. Every read is held `delay` ms, so a read in progress is on screen.
 * Failure cases, written before the fix:
 * (a) While server hints (`refresh`) read the person, route and requests again in the background,
 *     with no click, the server status leaves 「已連線」 or its row changes at all.
 * (b) The status element is replaced during those reads (the row mounts again).
 * (c) Those background reads did not happen (the test would pass without testing anything).
 * (d) Before the server has answered once, the status is not 「正在確認…」.
 * (e) Once the server is unreachable, background reads flip 「無法連線」 to 「正在確認…」.
 * (f) A clicked 「重新檢查」 does not show 「正在確認…」 while its own read runs, or does not end at
 *     「已連線」 once the server answers.
 * (g) While `computer` hints read the computer again in the background, the computer's status
 *     gains 「正在確認最新狀態」 or changes at all, or is replaced.
 * Output: `status-steady.json` with every status text seen and the reads made, and screenshots.
 */

const fixture = 'http://127.0.0.1:4178/renderer-regressions.html?case=showcase'
const evidence: Record<string, unknown> = {}
test.afterAll(async () => {
  await writeFile(
    test.info().outputPath('status-steady.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  )
})

interface Regression {
  hint(kind: string): void
  serverDown(down: boolean): void
  snapshot(): { reads: string[] }
}
type Fixture = Window & { regression: Regression }
const hint = (page: Page, kind: string) =>
  page.evaluate((kind) => (window as unknown as Fixture).regression.hint(kind), kind)
const reads = (page: Page, kind: string) =>
  page.evaluate(
    (kind) =>
      (window as unknown as Fixture).regression.snapshot().reads.filter((read) => read === kind)
        .length,
    kind,
  )

/** Records every text `status` shows and every change under `scope` from now on. */
async function watch(status: Locator, scope: Locator) {
  await scope.evaluate(
    (root, element) => {
      const log = { texts: [element!.textContent], changes: 0, element: element! }
      new MutationObserver((records) => {
        log.changes += records.length
        log.texts.push(log.element.textContent)
      }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
      Object.assign(window, { __status: log })
    },
    await status.elementHandle(),
  )
}
const watched = (status: Locator) =>
  status.evaluate((element) => {
    const log = (
      window as unknown as { __status: { texts: string[]; changes: number; element: Element } }
    ).__status
    return { texts: log.texts, changes: log.changes, same: log.element === element }
  })
async function backgroundReads(page: Page, kind: string, read: string, times: number) {
  const before = await reads(page, read)
  for (let index = 0; index < times; index++) {
    await hint(page, kind)
    await page.waitForTimeout(800)
  }
  // (c) Each hint did read again.
  const made = (await reads(page, read)) - before
  expect(made).toBeGreaterThanOrEqual(times)
  return made
}

async function openServer(page: Page, query: string) {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto(`${fixture}&${query}`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
  )
  const settings = page.getByRole('region', { name: '設定', exact: true })
  await settings.getByRole('tab', { name: '連線', exact: true }).click()
  const row = settings
    .locator('[data-settings-row]')
    .filter({ has: page.getByText('狀態', { exact: true }) })
  return { row, status: row.getByRole('status') }
}

test('background reads leave the server status as it was', async ({ page }) => {
  const { row, status } = await openServer(page, 'server=up&delay=400')
  // (d) Nothing has answered yet.
  await expect(status).toHaveText('正在確認…')
  await expect(status).toHaveText('已連線')
  await watch(status, row)
  const made = await backgroundReads(page, 'refresh', 'me', 3)
  const connected = await watched(status)
  evidence.connected = { ...connected, reads: made }
  await page.screenshot({ path: test.info().outputPath('server-connected.png') })
  // (a) (b)
  expect(connected).toEqual({ texts: ['已連線'], changes: 0, same: true })
})

test('background reads keep an unreachable server unreachable until the person rechecks', async ({
  page,
}) => {
  const { row, status } = await openServer(page, 'server=down&delay=400')
  await expect(status).toHaveText('無法連線')
  await watch(status, status)
  const made = await backgroundReads(page, 'refresh', 'me', 2)
  const unreachable = await watched(status)
  evidence.unreachable = { ...unreachable, reads: made }
  // (e)
  expect(unreachable).toEqual({ texts: ['無法連線'], changes: 0, same: true })
  // (f) The person's own recheck shows itself until its read settles.
  await page.evaluate(() => (window as unknown as Fixture).regression.serverDown(false))
  await watch(status, status)
  await row.getByRole('button', { name: '重新檢查', exact: true }).click()
  await expect(status).toHaveText('正在確認…')
  await expect(status).toHaveText('已連線')
  const rechecked = await watched(status)
  evidence.rechecked = rechecked
  await page.screenshot({ path: test.info().outputPath('server-rechecked.png') })
  expect(rechecked.texts.at(-1)).toBe('已連線')
})

test('background reads leave the computer status as it was', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.goto(`${fixture}&delay=400`)
  await expect(page.getByText('幫我整理一下這週的訪談筆記。', { exact: true })).toBeVisible()
  const toggle = page.getByRole('button', { name: '側邊欄', exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page
    .getByRole('navigation', { name: '主要導覽', exact: true })
    .getByRole('button', { name: 'Yuki 的電腦', exact: true })
    .click()
  const group = page.getByRole('group', { name: '電腦狀態與控制', exact: true })
  const status = group.locator('span').filter({ hasText: '控制：' }).first()
  await expect(status).toBeVisible()
  await expect(status).not.toContainText('正在確認')
  await watch(status, status)
  const made = await backgroundReads(page, 'computer', 'computer', 3)
  const computer = await watched(status)
  evidence.computer = { ...computer, reads: made }
  await page.screenshot({ path: test.info().outputPath('computer.png') })
  // (g)
  expect(computer).toEqual({ texts: [computer.texts[0]], changes: 0, same: true })
  expect(computer.texts[0]).not.toContain('正在確認')
})
