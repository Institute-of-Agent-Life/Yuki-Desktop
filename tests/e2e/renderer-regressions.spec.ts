import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { navigate, sidebar } from '../fixtures/navigation'

interface ConversationScrollFixture {
  imagePending(eventId: number): boolean
  releaseImage(): void
  appendImageConversation(): void
  snapshot(): { mainHistoryReads: number }
}
const conversationPosition = (log: Locator) =>
  log.evaluate((node) => ({
    top: node.scrollTop,
    gap: Math.round(node.scrollHeight - node.scrollTop - node.clientHeight),
  }))
const renderedFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )

for (const position of ['tail', 'reader', 'quoted-history'] as const) {
  test(`delayed image decode preserves the actual ${position} position`, async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 760 })
    let notifyRequest!: (route: Route) => void
    const imageRequest = new Promise<Route>((resolve) => {
      notifyRequest = resolve
    })
    await page.route('**/delayed-conversation-image.svg', (route) => notifyRequest(route))
    await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-scroll')
    const log = page.getByRole('log', { name: '對話訊息', exact: true })
    await expect(page.locator('article[data-event-id="1024"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /引用：Original quoted image/ })).toBeEnabled()
    await log.hover()
    await page.mouse.wheel(0, 10000)
    await expect.poll(async () => (await conversationPosition(log)).gap).toBe(0)
    const eventId = position === 'quoted-history' ? 900 : 1024
    if (position === 'quoted-history') {
      await page.getByRole('button', { name: /引用：Original quoted image/ }).click()
      await expect(page.getByRole('button', { name: '回到最新訊息', exact: true })).toBeVisible()
      await expect(page.locator('article[data-event-id="900"]')).toHaveClass(/selected/)
      await log.hover()
      await page.mouse.wheel(0, 10000)
      await expect.poll(async () => (await conversationPosition(log)).gap).toBe(0)
    }
    await expect
      .poll(() =>
        page.evaluate(
          (eventId) =>
            (
              window as unknown as { regression: ConversationScrollFixture }
            ).regression.imagePending(eventId),
          eventId,
        ),
      )
      .toBe(true)
    await page.evaluate(() =>
      (window as unknown as { regression: ConversationScrollFixture }).regression.releaseImage(),
    )
    const imageRoute = await imageRequest
    const image = page.locator(`article[data-event-id="${eventId}"] img`)
    await expect(image).toBeAttached()
    // The placeholder is gone while the real image response remains unfinished.
    await renderedFrames(page)
    if (position === 'reader') {
      const initial = await conversationPosition(log)
      await log.hover()
      await page.mouse.wheel(0, -100)
      await expect.poll(async () => (await conversationPosition(log)).top).toBeLessThan(initial.top)
      await renderedFrames(page)
      await expect(image).toBeAttached()
    }
    const before = await conversationPosition(log)
    await imageRoute.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="blue"/></svg>',
    })
    await image.evaluate((node) => (node as HTMLImageElement).decode())
    await renderedFrames(page)
    expect(await image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBe(320)
    if (position === 'tail') expect((await conversationPosition(log)).gap).toBe(0)
    else expect((await conversationPosition(log)).top).toBe(before.top)
    await page.evaluate(() =>
      (
        window as unknown as { regression: ConversationScrollFixture }
      ).regression.appendImageConversation(),
    )
    if (position === 'quoted-history') {
      await expect(page.locator('article[data-event-id="1025"]')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '回到最新訊息', exact: true })).toBeVisible()
    } else await expect(page.locator('article[data-event-id="1025"]')).toHaveCount(1)
    await renderedFrames(page)
    if (position === 'tail') {
      expect((await conversationPosition(log)).gap).toBe(0)
      await expect(page.getByRole('button', { name: '↓ 新訊息', exact: true })).toHaveCount(0)
    } else expect((await conversationPosition(log)).top).toBe(before.top)
  })
}

for (const view of ['工作', 'Yuki 的電腦', '設定']) {
  test(`returning from ${view} restores the main conversation tail without a new history response`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1439, height: 760 })
    await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-scroll')
    const log = page.getByRole('log', { name: '對話訊息', exact: true })
    await expect(page.locator('article[data-event-id="1024"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /引用：Original quoted image/ })).toBeEnabled()
    await log.hover()
    await page.mouse.wheel(0, 10000)
    await expect.poll(async () => (await conversationPosition(log)).gap).toBe(0)
    const reads = () =>
      page.evaluate(
        () =>
          (window as unknown as { regression: ConversationScrollFixture }).regression.snapshot()
            .mainHistoryReads,
      )
    const beforeReads = await reads()
    await navigate(page, view)
    await expect(log).toHaveCount(0)
    if (view === '設定') await page.getByRole('button', { name: '返回', exact: true }).click()
    else await navigate(page, '桌面對話')
    await expect(log).toHaveCount(1)
    await renderedFrames(page)
    expect((await conversationPosition(log)).gap).toBe(0)
    expect(await reads()).toBe(beforeReads)
  })
}

for (const position of ['reader', 'quoted-history'] as const) {
  test(`closing settings restores the actual ${position} offset`, async ({ page }) => {
    await page.setViewportSize({ width: 1439, height: 760 })
    await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=conversation-scroll')
    const log = page.getByRole('log', { name: '對話訊息', exact: true })
    await expect(page.locator('article[data-event-id="1024"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /引用：Original quoted image/ })).toBeEnabled()
    await log.hover()
    await page.mouse.wheel(0, 10000)
    await expect.poll(async () => (await conversationPosition(log)).gap).toBe(0)
    if (position === 'quoted-history') {
      await page.getByRole('button', { name: /引用：Original quoted image/ }).click()
      await expect(page.locator('article[data-event-id="900"]')).toHaveClass(/selected/)
      await expect(page.getByRole('button', { name: '回到最新訊息', exact: true })).toBeVisible()
    } else {
      const tail = await conversationPosition(log)
      await log.hover()
      await page.mouse.wheel(0, -600)
      await expect.poll(async () => (await conversationPosition(log)).top).toBeLessThan(tail.top)
    }
    await renderedFrames(page)
    const before = await conversationPosition(log)
    const draft = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
    await draft.fill(`開關設定仍保留的 ${position} 草稿`)
    await navigate(page, '設定')
    await expect(log).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '主要導覽', exact: true })).toHaveCount(0)
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(log).toHaveCount(1)
    await renderedFrames(page)
    const after = await conversationPosition(log)
    expect(after.top).toBe(before.top)
    await expect(draft).toHaveValue(`開關設定仍保留的 ${position} 草稿`)
    if (position === 'quoted-history')
      await expect(page.getByRole('button', { name: '回到最新訊息', exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath(`settings-return-${position}.png`) })
    await writeFile(
      test.info().outputPath(`settings-return-${position}.json`),
      JSON.stringify({ position, before, after, draft: await draft.inputValue() }, null, 2),
    )
  })
}

test('full-window settings hide the mounted workspace and return through the Settings header', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 760 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=settings-transition')
  const navigation = await sidebar(page)
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' }))
  })
  const settings = page.getByRole('region', { name: '設定', exact: true })
  await expect(settings).toBeVisible()
  await expect(navigation).not.toBeVisible()
  await expect(page.getByRole('button', { name: '側邊欄', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toBeVisible()
  const workspace = page.getByTestId('workspace-session')
  await expect(workspace).toBeAttached()
  await expect(workspace).not.toBeVisible()
  const mounted = await workspace.evaluate((element) => ({
    hidden: !!element.closest('[hidden]'),
    inert: !!element.closest('[inert]'),
  }))
  expect(mounted).toEqual({ hidden: true, inert: true })
  await page.screenshot({ path: test.info().outputPath('settings-replaces-workspace.png') })
  await writeFile(
    test.info().outputPath('settings-replaces-workspace.json'),
    JSON.stringify({ mounted, tabs: await settings.getByRole('tab').allTextContents() }, null, 2),
  )
  await settings.getByRole('button', { name: '返回', exact: true }).click()
  await expect(settings).toHaveCount(0)
  await expect(page.getByText('原對話內容', { exact: true })).toBeVisible()
})

for (const recovery of ['online', 'refresh'] as const) {
  test(`a failed manual reconnect does not leave a stale error after automatic ${recovery} recovery`, async ({
    page,
  }) => {
    await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=connection-reconnect')
    const input = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
    await expect(page.locator('article[data-event-id="31"]')).toHaveCount(1)
    await input.fill('重連失敗與恢復都保留的草稿')
    await page.evaluate(() => {
      const fixture = (
        window as unknown as {
          regression: { connection(state: string): void; failNextReconnect(): void }
        }
      ).regression
      fixture.connection('offline')
      fixture.failNextReconnect()
    })
    await page.getByRole('button', { name: '重新連線', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'fixture_reconnect_failed' }),
    ).toBeVisible()
    await page.evaluate((recovery) => {
      const fixture = (
        window as unknown as {
          regression: { connection(state: string): void; settleLateEffect(): void }
        }
      ).regression
      if (recovery === 'online') fixture.connection('online')
      else fixture.settleLateEffect()
    }, recovery)
    await expect(
      page.getByRole('status').filter({ hasText: 'fixture_reconnect_failed' }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重新連線', exact: true })).toHaveCount(0)
    await expect(input).toHaveValue('重連失敗與恢復都保留的草稿')
    await expect(page.locator('article[data-event-id="31"]')).toHaveCount(1)
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            regression: { snapshot(): { reconnects: number; submissions: number } }
          }
        ).regression.snapshot(),
      ),
    ).toMatchObject({ reconnects: 1, submissions: 0 })
  })
}

test('logout recovery opens Connection before a retained Computer category', async ({ page }) => {
  await page.goto(
    'http://127.0.0.1:4178/renderer-regressions.html?case=settings&category=computer&logout=true',
  )
  await expect(page.getByRole('tab', { name: '連線', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('tab', { name: '這台電腦', exact: true })).toHaveAttribute(
    'aria-selected',
    'false',
  )
  await expect(page.getByRole('dialog', { name: '處理本機內容', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保留並登出', exact: true })).toBeVisible()
})

test('manual reconnect is available with cached messages and preserves the draft without submitting again', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=connection-reconnect')
  const input = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
  await expect(page.locator('article[data-event-id="31"]')).toHaveCount(1)
  await expect(page.locator('article[data-event-id="32"]')).toHaveCount(1)
  await input.fill('手動重連仍保留的原草稿')
  const snapshot = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          regression: {
            snapshot(): {
              reconnects: number
              submissions: number
              conversationDraft: string
              reads: string[]
            }
          }
        }
      ).regression.snapshot(),
    )
  await page.evaluate(() =>
    (
      window as unknown as { regression: { connection(state: string): void } }
    ).regression.connection('offline'),
  )
  const reconnect = page.getByRole('button', { name: '重新連線', exact: true })
  await expect(reconnect).toBeVisible()
  await expect(page.locator('article[data-event-id="31"]')).toHaveCount(1)
  const before = await snapshot()
  await reconnect.click()
  await expect(reconnect).toHaveCount(0)
  await expect
    .poll(async () => (await snapshot()).reads.length)
    .toBeGreaterThan(before.reads.length)
  expect(await snapshot()).toMatchObject({
    reconnects: 1,
    submissions: 0,
    conversationDraft: '手動重連仍保留的原草稿',
  })
  await expect(input).toHaveValue('手動重連仍保留的原草稿')
  await expect(page.locator('article[data-event-id="31"]')).toHaveCount(1)
  await expect(page.locator('article[data-event-id="32"]')).toHaveCount(1)
})

test('the conversation scroll area starts below the toolbar at wide and narrow content widths', async ({
  page,
}) => {
  for (const width of [1440, 960, 480]) {
    await page.setViewportSize({ width, height: 650 })
    await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=connection-reconnect')
    const log = page.getByRole('log', { name: '對話訊息', exact: true })
    await expect(page.locator('article[data-event-id="31"]')).toHaveCount(1)
    await page.evaluate(() =>
      (
        window as unknown as { regression: { connection(state: string): void } }
      ).regression.connection('online'),
    )
    await expect(page.getByRole('button', { name: '重新連線', exact: true })).toHaveCount(0)
    const toolbar = await page.locator('[data-region="toolbar"]:visible').boundingBox()
    const scroll = await log.boundingBox()
    expect(scroll!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height - 1)
    expect(await log.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: test.info().outputPath(`scroll-area-${width}.png`) })
  }
})

test('consecutive messages keep separate bubbles and preserve the actual participant', async ({
  page,
}) => {
  for (const width of [960, 480]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=messages')
    const log = page.getByRole('log', { name: 'Message spacing sample' })
    await expect(log.locator('article[data-event-id]')).toHaveCount(6)
    await expect(log.getByText('First separate message', { exact: true })).toBeVisible()
    await expect(log.locator('[data-transcript-segment]')).toHaveText([
      '第一段原始語音轉寫',
      '第二段原始語音轉寫',
    ])
    const card = log
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Original active work' }) })
    await expect(card).toBeVisible()
    await expect(log.locator('article')).toHaveCount(7)
    const gaps = await log
      .locator('article')
      .evaluateAll((items) =>
        items
          .slice(1)
          .map(
            (item, index) =>
              item.getBoundingClientRect().top - items[index]!.getBoundingClientRect().bottom,
          ),
      )
    for (const gap of gaps) expect(gap).toBeGreaterThan(0)
    const preceding = await log.locator('[data-event-id="5"]').boundingBox()
    const cardBox = await card.boundingBox()
    const following = await log.locator('[data-event-id="6"]').boundingBox()
    expect(cardBox!.y).toBeGreaterThan(preceding!.y + preceding!.height)
    expect(following!.y).toBeGreaterThan(cardBox!.y + cardBox!.height)
    await expect(page.getByRole('article', { name: '你的訊息', exact: true })).toHaveCount(3)
    await expect(
      page.getByRole('article', { name: 'Other person的訊息', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('article', { name: 'Yuki的訊息', exact: true })).toHaveCount(2)
    expect(await log.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`messages-${width}.png`) })
  }
})

test('discarding a recovered SOUL draft retries the actual failed local write before closing the prompt', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=soul')
  const prompt = page.getByRole('dialog', { name: '恢復未儲存的草稿？' })
  await prompt.getByRole('button', { name: '不恢復', exact: true }).click()
  await expect(prompt).toBeVisible()
  await expect(prompt.getByText(/本機草稿未能儲存/)).toBeVisible()
  const snapshot = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          regression: { snapshot(): { draft: { draft: string }; attempts: number } }
        }
      ).regression.snapshot(),
    )
  expect(await snapshot()).toMatchObject({
    attempts: 1,
    draft: { draft: 'unsaved original draft' },
  })
  await prompt.getByRole('button', { name: '不恢復', exact: true }).click()
  await expect(prompt).not.toBeVisible()
  expect(await snapshot()).toMatchObject({ attempts: 2, draft: { draft: 'original content' } })
  await expect(page.getByRole('textbox', { name: 'SOUL.md 內容' })).toContainText(
    'original content',
  )
})

test('composer associates submission failure with retained input and ignores IME confirmation', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html')
  const input = page.getByRole('textbox', {
    name: '和 Yuki 說點什麼',
  })
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  await expect(page.getByTestId('calls')).toHaveText('0')
  await input.press('Enter')
  await expect(page.getByTestId('calls')).toHaveText('1')
  await expect(input).toHaveValue('original message')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  const description = await input.getAttribute('aria-describedby')
  await expect(page.locator(`[id="${description}"]`)).toHaveText('尚未送出，已保留內容。')
  await input.fill('edited retry')
  await expect(input).toHaveAttribute('aria-invalid', 'false')
})

test('command palette does not execute composition Enter or keyCode 229', async ({ page }) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=palette')
  const input = page.getByRole('combobox')
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229 })
  await expect(page.getByTestId('calls')).toHaveText('0')
  await input.press('Enter')
  await expect(page.getByTestId('calls')).toHaveText('1')
})

test('work overview and detail preserve real catalog pagination and original steps', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=work')
  await expect(
    page.getByRole('button').filter({ hasText: 'Original completed work' }),
  ).toBeVisible()
  await page.getByRole('button').filter({ hasText: 'Original active work' }).click()
  await expect(page.getByRole('heading', { name: 'Original active work' })).toBeVisible()
  await expect(page.getByText('Original result', { exact: true })).toBeVisible()
  await expect(page.getByText('Original terminal step', { exact: true })).toBeVisible()
  const usage = page.locator('details').filter({ has: page.getByText('用量', { exact: true }) })
  await expect(usage).toHaveJSProperty('open', false)
  await usage.getByText('用量', { exact: true }).click()
  await expect(usage).toHaveJSProperty('open', true)
  await expect(page.getByText(/模型請求 3／無上限/)).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { regression: { snapshot(): { reads: string[] } } }
        ).regression.snapshot().reads,
    ),
  ).toEqual(expect.arrayContaining(['works', 'work', 'steps']))
})

for (const width of [1440, 960])
  test(`a completed work stays with its original message and its inspector closes below the toolbar at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=historical-work')
    const log = page.getByRole('log', { name: '對話訊息' })
    const original = log.locator('[data-event-id="31"]')
    await expect(original).toContainText('The original message still owns its completed work')
    const card = log.getByRole('article').filter({
      has: page.getByRole('heading', { name: 'Completed work from the original message' }),
    })
    await expect(card).toHaveCount(1)
    await expect(log.locator('[data-event-id="32"]')).toContainText(
      'The original result remains a separate message',
    )
    await expect(card.getByText('已完成', { exact: true })).toBeVisible()
    const originalBounds = await original.boundingBox()
    const cardBounds = await card.boundingBox()
    expect(cardBounds!.y).toBeGreaterThanOrEqual(originalBounds!.y + originalBounds!.height)
    const resultBounds = await log.locator('[data-event-id="32"]').boundingBox()
    expect(resultBounds!.y).toBeGreaterThanOrEqual(cardBounds!.y + cardBounds!.height)
    const draft = page.getByRole('textbox', { name: '和 Yuki 說點什麼', exact: true })
    await draft.fill('關閉工作詳情仍保留的草稿')
    await card.getByRole('button', { name: '查看詳情', exact: true }).click()
    const inspector = page.getByRole('complementary', { name: '詳情' })
    await expect(inspector).toHaveCSS('position', width === 960 ? 'absolute' : 'relative')
    await expect(
      inspector.getByRole('heading', { name: 'Completed work from the original message' }),
    ).toBeVisible()
    await expect(inspector.getByText('Original terminal step', { exact: true })).toBeVisible()
    await expect(inspector.getByText('Original result', { exact: true })).toBeVisible()
    const close = inspector.getByRole('button', { name: '關閉詳情', exact: true })
    const closeBounds = await close.boundingBox()
    const toolbar = await page.locator('[data-region="toolbar"]').boundingBox()
    expect(closeBounds!.y).toBeGreaterThanOrEqual(toolbar!.y + toolbar!.height)
    await page.screenshot({ path: test.info().outputPath('completed-work-original-message.png') })
    await close.click()
    await expect(inspector).toHaveCount(0)
    await expect(page.getByRole('button', { name: '詳情', exact: true })).toBeFocused()
    await expect(original).toBeVisible()
    await expect(draft).toHaveValue('關閉工作詳情仍保留的草稿')
    expect(errors).toEqual([])
  })

test('the result page can show its work when the original trigger has not been loaded', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(
    'http://127.0.0.1:4178/renderer-regressions.html?case=historical-work&events=result',
  )
  const log = page.getByRole('log', { name: '對話訊息' })
  await expect(log.locator('[data-event-id="31"]')).toHaveCount(0)
  const result = log.locator('[data-event-id="32"]')
  await expect(result).toContainText('The original result remains a separate message')
  const card = log.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'Completed work from the original message' }),
  })
  await expect(card).toHaveCount(1)
  await expect(card.getByText('已完成', { exact: true })).toBeVisible()
  const resultBounds = await result.boundingBox()
  const cardBounds = await card.boundingBox()
  expect(cardBounds!.y).toBeGreaterThanOrEqual(resultBounds!.y + resultBounds!.height)
  await card.getByRole('button', { name: '查看詳情', exact: true }).click()
  await expect(
    page
      .getByRole('complementary', { name: '詳情' })
      .getByText('Original terminal step', { exact: true }),
  ).toBeVisible()
})

test('computer tabs use the current WorkPage and keep the original work identity', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=computer-inspector')
  await expect(page.getByText('Original owned browser tab', { exact: true })).toBeVisible()
  await expect(page.getByText('Original unassigned browser tab', { exact: true })).toBeVisible()
  await expect(page.getByText('歸屬不明', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Original active work', exact: true }).click()
  await expect(page.getByTestId('selected-work')).toHaveText('original-work')
  await page.getByRole('button', { name: '查看所屬工作', exact: true }).click()
  await expect(page.getByTestId('selected-work')).toHaveText('historical-work')
  expect(errors).toEqual([])
})

test('an attachment without invented availability is clickable and original failure comes from content retrieval', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=media')
  await page.getByRole('button', { name: 'original.wav' }).click()
  await expect(page.getByRole('status').filter({ hasText: '附件內容目前無法取得。' })).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as { regression: { snapshot(): { contentReads: unknown[] } } }
        ).regression.snapshot().contentReads,
    ),
  ).toEqual([{ conversationId: 'conversation', eventId: 31, index: 0 }])
})

test('unpaired settings use one full-window navigation and keep both Yuki connection entries reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=settings')
  const settings = page.getByRole('region', { name: '設定', exact: true })
  const pane = page.getByRole('tabpanel', { name: '一般', exact: true })
  await expect(pane).toBeVisible()
  const bounds = await pane.boundingBox()
  const settingsBounds = await settings.boundingBox()
  expect(bounds!.width).toBeGreaterThan(680)
  expect(
    Math.abs(bounds!.x + bounds!.width - settingsBounds!.x - settingsBounds!.width),
  ).toBeLessThanOrEqual(1)
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.getByRole('navigation', { name: '主要導覽', exact: true })).toHaveCount(0)
  const tabs = page.getByRole('tablist', { name: '設定分類', exact: true })
  await expect(tabs.getByRole('tab')).toHaveText([
    '一般',
    '外觀',
    '通知',
    '更新',
    '所有 Yuki',
    '進階',
  ])
  await expect(page.getByRole('tab', { name: '這台電腦', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '連線', exact: true })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '裝置', exact: true })).toHaveCount(0)
  await tabs.getByRole('tab', { name: '所有 Yuki', exact: true }).click()
  await page.getByRole('button', { name: '連接…', exact: true }).click()
  await expect(page.getByTestId('settings-action')).toHaveText('connect')
  await page.getByRole('button', { name: '部署與管理…', exact: true }).click()
  await expect(page.getByTestId('settings-action')).toHaveText('deploy')
  await page.screenshot({ path: test.info().outputPath('settings-full-column.png') })
  await writeFile(
    test.info().outputPath('settings-full-column.json'),
    JSON.stringify({ tabs: await tabs.getByRole('tab').allTextContents(), pane: bounds }, null, 2),
  )
})
