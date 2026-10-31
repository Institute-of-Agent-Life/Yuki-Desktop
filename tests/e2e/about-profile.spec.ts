import { expect, test } from '@playwright/test'

test('an existing administrator can edit an empty profile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:4178/about-profile.html')
  const heading = page.getByRole('heading', { name: 'Yuki', exact: true })
  await expect(heading).toBeVisible()
  await expect(heading).toBeInViewport()
  const bounds = await heading.boundingBox()
  expect(bounds!.height).toBeGreaterThan(20)
  await test.info().attach('about-layout.json', {
    body: JSON.stringify({
      heading: bounds,
      content: await page.locator('[data-region="content"]').evaluate((element) => ({
        height: element.clientHeight,
        width: element.clientWidth,
      })),
    }),
    contentType: 'application/json',
  })
  await page.screenshot({ path: test.info().outputPath('about-administrator-empty.png') })
  await expect(page.getByText('尚未設定簡介。', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '簡介', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '頭像', exact: true })).toBeInViewport()
  await expect(
    page.getByText('名稱、簡介、頭像與提示詞由連接這個 Yuki 的使用者共享。'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '編輯名稱與簡介', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '編輯提示詞', exact: true })).toBeVisible()
})

test('administrator identity preserves the original profile editor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('http://127.0.0.1:4178/about-profile.html?administrator=true')
  await expect(page.getByText('尚未設定簡介。', { exact: true })).toBeVisible()
  await expect(
    page.getByText('名稱、簡介、頭像與提示詞由連接這個 Yuki 的使用者共享。'),
  ).toBeVisible()
  await page.getByRole('button', { name: '編輯名稱與簡介', exact: true }).click()
  await expect(page.getByLabel('名稱', { exact: true })).toHaveValue('Yuki')
  await expect(page.getByLabel('簡介', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('button', { name: '編輯名稱與簡介', exact: true })).toBeVisible()
})

test('a long profile wraps and scrolls inside the existing content column', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.goto('http://127.0.0.1:4178/about-profile.html?bio=long')
  const content = page.locator('[data-region="content"]')
  const scrollArea = content.locator(':scope > div')
  await expect(page.getByRole('heading', { name: 'Yuki', exact: true })).toBeVisible()
  expect(
    await scrollArea.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1)
  expect(await scrollArea.evaluate((element) => element.clientHeight)).toBeGreaterThan(300)
  expect(await scrollArea.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    await scrollArea.evaluate((element) => element.clientHeight),
  )
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(page.getByRole('heading', { name: '簡介', exact: true })).toBeVisible()
  await page.getByRole('heading', { name: '簡介', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('heading', { name: '簡介', exact: true })).toBeInViewport()
  await page.getByRole('heading', { name: '頭像', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('heading', { name: '頭像', exact: true })).toBeInViewport()
  expect(await content.evaluate((element) => element.scrollTop)).toBe(0)
  await page.screenshot({ path: test.info().outputPath('about-long-profile.png') })
})

test('avatar editing depends on the actual server capability', async ({ page }) => {
  await page.goto('http://127.0.0.1:4178/about-profile.html?administrator=true')
  await expect(page.getByText('這個 Yuki 目前尚未提供更換頭像的功能。')).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: '頭像', exact: true })
      .getByRole('button', { name: '更換頭像', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: '編輯名稱與簡介', exact: true })).toBeVisible()
  await page.goto('http://127.0.0.1:4178/about-profile.html?administrator=true&avatar=supported')
  await page
    .getByRole('region', { name: '頭像', exact: true })
    .getByRole('button', { name: '更換頭像', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: '更換 Yuki 的頭像' })).toBeVisible()
  await expect(page.getByRole('button', { name: '選擇圖片…', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '還原預設', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page
      .getByRole('region', { name: '頭像', exact: true })
      .getByRole('button', { name: '更換頭像', exact: true }),
  ).toBeFocused()
})

test('administrator avatar editing retains original pending updates', async ({ page }) => {
  await page.goto('http://127.0.0.1:4178/about-profile.html?avatar=supported')
  await expect(
    page
      .getByRole('region', { name: '頭像', exact: true })
      .getByRole('button', { name: '更換頭像', exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('header').getByRole('button', { name: '更換頭像', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('region', { name: '頭像', exact: true })
    .getByRole('button', { name: '更換頭像', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: '更換 Yuki 的頭像' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.goto('http://127.0.0.1:4178/about-profile.html?avatar=supported&pending=avatar')
  await page.getByRole('button', { name: '查看這次更新', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '更換 Yuki 的頭像' })).toBeVisible()
  await expect(
    page.getByRole('dialog').getByRole('button', { name: '查證頭像更新', exact: true }),
  ).toBeVisible()
})

test('an unavailable capability read stays unknown while normal profile editing remains available', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/about-profile.html?administrator=true&avatar=error')
  await expect(page.getByText('目前無法取得頭像設定，請確認連線後重新讀取。')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新讀取頭像設定', exact: true })).toBeVisible()
  await expect(page.getByText('這個 Yuki 目前尚未提供更換頭像的功能。')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '編輯名稱與簡介', exact: true })).toBeVisible()
})

test('the full About keeps personal memory, read-only SELF memory, arrangements and capabilities', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/about-profile.html?collections=full')
  await page.getByRole('button', { name: /原有的個人記憶/ }).click()
  await expect(page.getByRole('button', { name: '更正', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '她自己', exact: true }).click()
  await page.getByRole('button', { name: /Yuki 的原有自我記憶/ }).click()
  await expect(page.getByRole('button', { name: '更正', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: '安排', exact: true }).click()
  await expect(page.getByRole('heading', { name: '原有的安排' })).toBeVisible()
  await expect(page.getByRole('button', { name: '暫停', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '她的安排', exact: true }).click()
  await expect(page.getByRole('heading', { name: '原有的安排' })).toBeVisible()
  await expect(page.getByRole('button', { name: '暫停', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '刪除安排', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: '能力', exact: true }).click()
  await expect(page.getByRole('heading', { name: '原有擴充' })).toBeVisible()
})
