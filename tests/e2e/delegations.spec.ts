import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

// Delegations and observations (Client API 14) through the real renderer views, with the
// server's projections from tests/fixtures/delegations.tsx. Each case leaves screenshots and
// the recorded calls in its output directory.
interface Calls {
  reads: string[]
  answers: { workId: string; permissionId: string; answer: Record<string, unknown> }[]
  commands: unknown[]
  submits: unknown[]
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: Calls }).__calls)
async function evidence(page: Page, name: string) {
  // An open dialog is captured as shown; a list as a whole page.
  const dialog = (await page.getByRole('dialog').count()) > 0
  // Sheets morph open; wait for finite animations (spinners loop forever).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((item) => item.effect?.getComputedTiming().iterations !== Infinity)
        .map((item) => item.finished.catch(() => {})),
    ),
  )
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: !dialog })
  await writeFile(
    test.info().outputPath(`${name}.json`),
    JSON.stringify(await calls(page), null, 2) + '\n',
  )
}
const open = (page: Page, query = '') =>
  page.goto(`http://127.0.0.1:4178/delegations.html${query}`).then(() => page)
// The server's own status lines are in its language; the interface uses its own words.
const serverWords = /运行|状态|会话|服务器/

test('the running view groups every delegation and observation by its device, other devices and offline facts included', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page)
  const view = page.getByRole('region', { name: '各裝置上的 Agent', exact: true })
  const mac = view.getByRole('group', { name: 'Peter 的 MacBook', exact: true })
  const linux = view.getByRole('group', { name: 'Linux 工作站', exact: true })
  const idle = view.getByRole('group', { name: 'Windows 桌機', exact: true })
  await expect(mac.getByText('在線', { exact: true })).toBeVisible()
  await expect(mac.getByText('執行中 1・等你回答 1・狀態未知 0', { exact: true })).toBeVisible()
  await expect(mac.getByText('修登入頁的表單驗證', { exact: true })).toBeVisible()
  await expect(mac.getByText('觀察終端裡的 Claude Code', { exact: true })).toBeVisible()
  await expect(mac.getByText('Yuki 正在看 · 正在觀察 Claude Code 的會話')).toBeVisible()
  // Another device, offline, with a stuck delegation: its own facts, not this computer's.
  await expect(linux.getByText('離線', { exact: true })).toBeVisible()
  await expect(linux.getByText('執行中 1・等你回答 0・狀態未知 1', { exact: true })).toBeVisible()
  await expect(linux.getByText('委派 · Codex 狀態未知：裝置離線')).toBeVisible()
  await expect(linux.getByText('狀態未知', { exact: true })).toBeVisible()
  await expect(linux.getByText('整理 API 文件', { exact: true })).toBeVisible()
  await expect(idle.getByText('沒有進行中的委派', { exact: true })).toBeVisible()
  // The observation is listed by its device, not again as an ordinary work in progress.
  const progress = page.getByRole('region', { name: '進行中', exact: true })
  await expect(progress.getByText('修好登入頁並跑完測試', { exact: true })).toBeVisible()
  await expect(progress.getByText('觀察終端裡的 Claude Code')).toHaveCount(0)
  await expect(page.getByText(serverWords)).toHaveCount(0)
  await evidence(page, 'devices')
})

test('a server before Client API 14 keeps the original Works list', async ({ page }) => {
  await open(page, '?legacy=1')
  await expect(page.getByText('修好登入頁並跑完測試', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: '各裝置上的 Agent' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '需要你' })).toHaveCount(0)
  await evidence(page, 'legacy')
})

test('「需要你」 offers a delegation request its own native options, while an observed request is handled only in the terminal', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page)
  const needs = page.getByRole('region', { name: '需要你', exact: true })
  const delegated = needs.locator('[data-native-request="501"]')
  const observed = needs.locator('[data-native-request="601"]')
  // The request's own content and options, read from the original native event.
  await expect(delegated.getByText('npm test -- login', { exact: true })).toBeVisible()
  await expect(delegated.getByRole('button', { name: 'allow', exact: true })).toBeEnabled()
  await expect(delegated.getByRole('button', { name: 'deny', exact: true })).toBeEnabled()
  // Answers are one-time: a persistent option is never offered (the server says one_time_only).
  await expect(delegated.getByRole('button', { name: 'allow_always' })).toHaveCount(0)
  // F2: an observation's request is never answerable from Desktop, not even with deny.
  await expect(observed.getByText('rm -rf build', { exact: true })).toBeVisible()
  await expect(
    observed.getByText('在終端處理：Yuki 只觀察這個會話，不會回答或拒絕這個請求。', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(observed.getByRole('button')).toHaveCount(0)
  await expect(observed.getByRole('textbox')).toHaveCount(0)
  // An answer place this app does not know fails closed: shown, never answerable.
  const elsewhere = needs.locator('[data-native-request="701"]')
  await expect(elsewhere.getByText('Codex 要求權限：Write', { exact: true })).toBeVisible()
  await expect(elsewhere.getByRole('button')).toHaveCount(0)
  await evidence(page, 'needs-you')
  expect((await calls(page)).answers).toEqual([])
  // A wait no operation received: only its metadata reached Yuki, and it can only be denied.
  const unowned = needs.locator('[data-native-request="801"]')
  await expect(
    unowned.getByText(
      '沒有任何操作接收這個等待：只有工具名等基本資訊傳到 Yuki，請求內容沒有離開那台電腦，只能拒絕。',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(unowned.getByRole('button')).toHaveCount(1)
  await unowned.getByRole('button', { name: '拒絕', exact: true }).click()
  expect((await calls(page)).answers).toEqual([
    {
      workId: 'deleg-acp',
      permissionId: '801',
      answer: expect.objectContaining({ optionId: 'deny' }),
    },
  ])
})

test('one native request shown in two places sends a single answer however often and wherever it is pressed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  // The same request is in 「需要你」 and in its delegation's detail.
  await open(page, '?work=deleg-claude')
  const requests = page.locator('[data-native-request="501"]')
  await expect(requests).toHaveCount(2)
  await expect(requests.nth(1).getByText('npm test -- login', { exact: true })).toBeVisible()
  // F19: four presses in one task, before any re-render can disable a button.
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-native-request="501"] button')].filter(
      (button) => button.textContent === 'allow',
    ) as HTMLButtonElement[]
    if (buttons.length !== 2) throw Error('Expected the request in two places')
    for (const button of [...buttons, ...buttons]) button.click()
  })
  for (const panel of [requests.first(), requests.nth(1)])
    await expect(panel.getByRole('button', { name: 'allow', exact: true })).toBeDisabled()
  const sent = (await calls(page)).answers
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({
    workId: 'deleg-claude',
    permissionId: '501',
    answer: { optionId: 'allow' },
  })
  expect(sent[0]!.answer.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  await page.evaluate(() => (window as unknown as { __releaseAnswer(): void }).__releaseAnswer())
  const needs = page.getByRole('region', { name: '需要你', exact: true })
  await expect(needs.getByText('回答已交給 Claude Code。', { exact: true })).toBeVisible()
  await expect(requests).toHaveCount(0)
  await expect(
    page.locator('[data-work-detail]').getByText('回答已交給 Claude Code。', { exact: true }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('group', { name: 'Peter 的 MacBook', exact: true })
      .getByText('執行中 2・等你回答 0・狀態未知 0', { exact: true }),
  ).toBeVisible()
  expect((await calls(page)).answers).toHaveLength(1)
  await evidence(page, 'answered')
})

test('an answer whose commit is uncertain keeps its request ID and, once the request is gone, reads its real outcome', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page, '?answer=unknown')
  const needs = page.getByRole('region', { name: '需要你', exact: true })
  await needs
    .locator('[data-native-request="501"]')
    .getByRole('button', { name: 'allow', exact: true })
    .click()
  // The request left the pending list (the server committed it); the same request ID is
  // asked once more, and the server's original receipt replaces the uncertain one.
  await expect(needs.getByText('回答已交給 Claude Code。', { exact: true })).toBeVisible()
  await expect(needs.locator('[data-native-request="501"]')).toHaveCount(0)
  const sent = (await calls(page)).answers
  expect(sent).toHaveLength(2)
  expect(sent[1]!.answer).toEqual(sent[0]!.answer)
  await expect(needs.getByText(/尚未確認/)).toHaveCount(0)
  await evidence(page, 'uncertain-answer')
})

test('a failed delegation read is shown, not an empty list', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page, '?delegations-fail=1')
  await expect(page.getByText('委派與觀察紀錄暫時無法讀取', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新讀取委派', exact: true })).toBeVisible()
  await evidence(page, 'delegations-unreadable')
})

test('an answer that lost to an earlier one says so and shows the request is no longer pending', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page, '?answer=already')
  const needs = page.getByRole('region', { name: '需要你', exact: true })
  await needs
    .locator('[data-native-request="501"]')
    .getByRole('button', { name: 'deny', exact: true })
    .click()
  await expect(
    needs.getByText('這個請求已由其他人回答，以先到的回答為準。', { exact: true }),
  ).toBeVisible()
  await expect(needs.locator('[data-native-request="501"]')).toHaveCount(0)
  expect((await calls(page)).answers).toHaveLength(1)
  await evidence(page, 'already-answered')
})

test('cancelling an observation only stops observing, and a delegation says it cancels the native turn', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page, '?work=observe-claude')
  const detail = page.locator('[data-work-detail]')
  await expect(detail.getByText('Yuki 正在看', { exact: true })).toBeVisible()
  await expect(detail.getByRole('button', { name: '取消工作', exact: true })).toHaveCount(0)
  // Observing never sends input: there is no addition box for the observed session.
  await expect(detail.getByRole('textbox', { name: /補充給/ })).toHaveCount(0)
  await detail.getByRole('button', { name: '停止觀察', exact: true }).click()
  const stop = page.getByRole('dialog', { name: '停止觀察這個會話？', exact: true })
  await expect(
    stop.getByText('只停止 Yuki 觀察。不會向這個會話傳送任何輸入或控制，會話本身繼續執行。', {
      exact: true,
    }),
  ).toBeVisible()
  await evidence(page, 'stop-observing')
  await stop.getByRole('button', { name: '停止觀察', exact: true }).click()
  expect((await calls(page)).commands).toEqual([
    { kind: 'cancel', workId: 'observe-claude', expectedRevision: 2 },
  ])

  await open(page, '?work=deleg-claude')
  await detail.getByRole('button', { name: '取消委派', exact: true }).click()
  const cancel = page.getByRole('dialog', { name: '取消這項委派？', exact: true })
  await expect(
    cancel.getByText(
      '這會取消 Claude Code 正在執行的原生回合並結束委派；已完成的步驟不會被撤銷。',
      { exact: true },
    ),
  ).toBeVisible()
  await evidence(page, 'cancel-delegation')
  await cancel.getByRole('button', { name: '取消委派', exact: true }).click()
  expect((await calls(page)).commands).toEqual([
    { kind: 'cancel', workId: 'deleg-claude', expectedRevision: 2 },
  ])
})

test('a step that started or directed a delegation shows its live state from the work hint, with no polling, and opens it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await open(page, '?work=parent-work')
  const detail = page.locator('[data-work-detail]')
  const links = detail.locator('[data-subtask="deleg-acp"]')
  await expect(links).toHaveCount(2)
  await expect(links.first().getByText('執行中', { exact: true })).toBeVisible()
  await expect(links.first().getByText('Gemini 正在執行', { exact: true })).toBeVisible()
  // The live state is part of the button's name, not hidden behind it.
  await expect(
    detail.getByRole('button', { name: '打開子工作：Gemini 正在執行（執行中）', exact: true }),
  ).toHaveCount(2)
  await expect(detail.getByText('任務管理 委派', { exact: false }).first()).toBeVisible()
  const reads = async () =>
    (await calls(page)).reads.filter((read) => read === 'work:deleg-acp').length
  const before = await reads()
  // No timer re-reads the delegation while nothing changes.
  await page.waitForTimeout(3000)
  expect(await reads()).toBe(before)
  await page.evaluate(() => (window as unknown as { __finishAcp(): void }).__finishAcp())
  await expect(links.first().getByText('Gemini 已完成', { exact: true })).toBeVisible()
  await expect(links.first().getByText('已完成', { exact: true })).toBeVisible()
  expect(await reads()).toBe(before + 1)
  await expect(
    detail.getByRole('button', { name: '打開子工作：Gemini 已完成（已完成）', exact: true }),
  ).toHaveCount(2)
  await expect(page.getByText(serverWords)).toHaveCount(0)
  await evidence(page, 'step-live-state')
  // The historical native operation of an old agent step opens its original receipt.
  await detail.getByRole('button', { name: '原生操作 op-historic', exact: true }).click()
  const receipt = page.getByRole('dialog', { name: '原生操作 op-historic', exact: true })
  await expect(receipt.getByText('原生回合已完成', { exact: true })).toBeVisible()
  await receipt.getByRole('button', { name: '關閉', exact: true }).click()
  await links.first().click()
  await expect(detail.getByRole('heading', { name: '整理 API 文件', exact: true })).toBeVisible()
  await expect(detail.getByText('Gemini 已完成', { exact: true })).toBeVisible()
})

test('「這台電腦」 lists this device’s delegations with the right stop wording and never answers a watched request', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1000 })
  await open(page, '?view=connector')
  const here = page.getByRole('region', { name: '這台電腦上的委派與觀察', exact: true })
  // A settings row reads as its title and description together.
  await expect(here.getByText('修登入頁的表單驗證')).toBeVisible()
  await expect(here.getByText('觀察終端裡的 Claude Code')).toBeVisible()
  await expect(here.getByText('Yuki 正在看 · 正在觀察 Claude Code 的會話')).toBeVisible()
  // Only this device's records; the Linux workstation's stay in the Works view.
  await expect(here.getByText('整理 API 文件')).toHaveCount(0)
  await expect(here.getByRole('button', { name: '取消委派', exact: true })).toHaveCount(1)
  // The records change elsewhere; the stream's `refresh` reloads them before a cancel.
  const reads = async () =>
    (await calls(page)).reads.filter((read) => read === 'delegations').length
  const before = await reads()
  await page.evaluate(() => (window as unknown as { __bumpRecords(): void }).__bumpRecords())
  await expect.poll(reads).toBeGreaterThan(before)
  await here.getByRole('button', { name: '停止觀察', exact: true }).click()
  await page
    .getByRole('dialog', { name: '停止觀察這個會話？', exact: true })
    .getByRole('button', { name: '停止觀察', exact: true })
    .click()
  expect((await calls(page)).commands).toEqual([
    { kind: 'cancel', workId: 'observe-claude', expectedRevision: 3 },
  ])
  // DT6: the actions say what Yuki will do in the one subtask tool set.
  await expect(page.getByRole('button', { name: '請 Yuki 委派', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '請 Yuki 觀察', exact: true })).toBeVisible()

  // The watched operation's request: facts only, handled in the terminal (F2).
  const rows = page.getByRole('button', { name: '查看原回執', exact: true })
  await rows.first().click()
  const watched = page.getByRole('dialog', { name: '原操作 op-watch', exact: true })
  await expect(watched.getByText('rm -rf build', { exact: true })).toBeVisible()
  await expect(
    watched.getByText('在終端處理：Yuki 只觀察這個會話，不會回答或拒絕這個請求。', {
      exact: true,
    }),
  ).toBeVisible()
  for (const name of ['allow', 'deny', '排入原會話', '調整回合', '取消回合'])
    await expect(watched.getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(watched.getByRole('button', { name: '停止觀察', exact: true })).toBeVisible()
  await evidence(page, 'connector-watch')
  await watched.getByRole('button', { name: '關閉', exact: true }).click()

  await rows.nth(1).click()
  const delegated = page.getByRole('dialog', { name: '原操作 op-claude', exact: true })
  await expect(delegated.getByRole('button', { name: 'allow', exact: true })).toBeVisible()
  await expect(delegated.getByRole('button', { name: '結束委派', exact: true })).toBeVisible()
  await expect(delegated.getByRole('button', { name: '取消回合', exact: true })).toBeVisible()
  await evidence(page, 'connector-delegate')
  expect((await calls(page)).submits).toEqual([])
})

test('「這台電腦」 on a server before Client API 14 keeps the previous watch controls and wording', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1000 })
  await open(page, '?view=connector&revision=13')
  await expect(
    page.getByText('直接交代任務，或選擇已有會話繼續處理。', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: '這台電腦上的委派與觀察' })).toHaveCount(0)
  await page.getByRole('button', { name: '查看原回執', exact: true }).first().click()
  const watched = page.getByRole('dialog', { name: '原操作 op-watch', exact: true })
  // That server never marked a watch as observe-only: its answers stay where they were.
  await expect(watched.getByRole('button', { name: 'allow', exact: true })).toBeVisible()
  await expect(watched.getByRole('button', { name: '排入原會話', exact: true })).toBeVisible()
  await expect(watched.getByRole('button', { name: '停止觀察', exact: true })).toBeVisible()
  await expect(watched.getByRole('button', { name: '取消執行', exact: true })).toBeVisible()
  await expect(watched.getByText(/在終端處理/)).toHaveCount(0)
  await evidence(page, 'connector-legacy')
})
