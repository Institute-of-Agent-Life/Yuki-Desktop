import { expect, test } from '@playwright/test'

interface LateWorkFixture {
  holdNextSecondPage(): void
  settleLateEffect(): void
  releaseSecondPage(): void
  snapshot(): {
    heldSecondPage: boolean
    workStepsToken?: string | null
    lateWorkReads: { kind: string; workId: string }[]
  }
}

test('an ended work refreshes its original late effect without losing loaded step pages', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=late-work')
  await expect(page.getByText('已完成', { exact: true })).toBeVisible()
  await expect(page.getByText('Original first page step', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '載入更多步驟', exact: true }).click()
  await expect(page.getByText('Previously loaded second page step', { exact: true })).toBeVisible()
  await expect(page.getByText('Original late effect receipt', { exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    ;(
      window as unknown as { regression: { settleLateEffect(): void } }
    ).regression.settleLateEffect()
  })
  await expect(page.getByText('Original late effect receipt', { exact: true })).toBeVisible()
  await expect(page.getByText('Original first page step', { exact: true })).toBeVisible()
  await expect(page.getByText('Previously loaded second page step', { exact: true })).toBeVisible()
  await expect(page.getByText('已完成', { exact: true })).toBeVisible()
  const requests = await page.evaluate(
    () =>
      (
        window as unknown as {
          regression: { snapshot(): { lateWorkReads: { kind: string; workId: string }[] } }
        }
      ).regression.snapshot().lateWorkReads,
  )
  expect(requests.filter((item) => item.kind === 'work').length).toBeGreaterThan(1)
  expect(requests.filter((item) => item.kind === 'steps').length).toBeGreaterThan(2)
  expect(requests.every((item) => item.workId === 'historical-work')).toBe(true)
  expect(errors).toEqual([])
})

test('the real Conversation and WorkDetail combination honours refresh after an older second page finishes', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:4178/renderer-regressions.html?case=late-work-combined')
  await page
    .getByRole('log', { name: '對話訊息' })
    .getByRole('button', { name: '查看詳情', exact: true })
    .click()
  const inspector = page.getByRole('complementary', { name: '檢視器' })
  await expect(inspector.getByText('Original first page step', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    ;(window as unknown as { regression: LateWorkFixture }).regression.holdNextSecondPage()
  })
  await inspector.getByRole('button', { name: '載入更多步驟', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { regression: LateWorkFixture }).regression.snapshot()
            .heldSecondPage,
      ),
    )
    .toBe(true)
  await page.evaluate(() => {
    ;(window as unknown as { regression: LateWorkFixture }).regression.settleLateEffect()
  })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { regression: LateWorkFixture }).regression.snapshot()
            .workStepsToken,
      ),
    )
    .toBe('with-original-late-receipt')
  await page.evaluate(() => {
    ;(window as unknown as { regression: LateWorkFixture }).regression.releaseSecondPage()
  })
  await expect(inspector.getByText('Original late effect receipt', { exact: true })).toBeVisible()
  await expect(inspector.getByText('Original first page step', { exact: true })).toBeVisible()
  await expect(
    inspector.getByText('Previously loaded second page step', { exact: true }),
  ).toBeVisible()
  await expect(inspector.getByText('已完成', { exact: true })).toBeVisible()
  const reads = await page.evaluate(
    () =>
      (window as unknown as { regression: LateWorkFixture }).regression.snapshot().lateWorkReads,
  )
  expect(reads.filter((item) => item.kind === 'steps').length).toBeGreaterThanOrEqual(4)
  expect(reads.every((item) => item.workId === 'historical-work')).toBe(true)
  expect(errors).toEqual([])
})
