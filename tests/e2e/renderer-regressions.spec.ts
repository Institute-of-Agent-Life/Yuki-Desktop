import { expect, test } from '@playwright/test'

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
  const input = page.getByRole('textbox', { name: '和 Yuki 說點什麼' })
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

test('work overview and detail consume current home and work wire shapes without catalog or steps', async ({ page }) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=work')
  await expect(page.getByRole('button').filter({ hasText: 'Original completed work' })).toBeVisible()
  await page.getByRole('button').filter({ hasText: 'Original active work' }).click()
  await expect(page.getByRole('heading', { name: 'Original active work' })).toBeVisible()
  await expect(page.getByText('Original result', { exact: true })).toBeVisible()
  await expect(page.getByText(/模型請求 3／無上限/)).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { regression: { snapshot(): { reads: string[] } } }).regression.snapshot().reads)).toEqual(['home', 'work'])
})

test('an attachment without invented availability is clickable and original failure comes from content retrieval', async ({ page }) => {
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=media')
  await page.getByRole('button', { name: 'original.wav' }).click()
  await expect(page.getByRole('status').filter({ hasText: '附件內容目前無法取得。' })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { regression: { snapshot(): { contentReads: unknown[] } } }).regression.snapshot().contentReads)).toEqual([{ conversationId: 'conversation', eventId: 31, index: 0 }])
})
