import { expect, test, type Page } from '@playwright/test'

const link = (target: string) =>
  `yuki://pair?server=https%3A%2F%2F${target}.example&code=${target.repeat(32)}`
const inputName = '配對連結、綁定碼或完整回覆'
async function start(page: Page) {
  await page.goto('http://127.0.0.1:4178/pairing-regressions.html')
  await page.getByLabel(inputName).fill(link('a'))
  await page.getByRole('button', { name: '繼續', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Character A' })).toBeVisible()
  await page.getByRole('button', { name: '確認並連接', exact: true }).click()
}
async function completed(page: Page, activate: boolean) {
  await page.getByRole('button', { name: 'Complete original pairing' }).click()
  await expect(page.getByTestId('finished')).toHaveText(
    JSON.stringify([{ characterId: '00000000-0000-4000-8000-000000000001', activate }]),
  )
  await expect(page.getByTestId('requests')).toHaveText(
    JSON.stringify([{ server: 'https://a.example', code: 'a'.repeat(32) }]),
  )
}
async function emptyConnect(page: Page) {
  await expect(page.getByLabel(inputName)).toHaveValue('')
  await expect(page.getByRole('button', { name: '繼續', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '確認並連接', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '連接已有 Yuki' })).toBeVisible()
  await expect(page.getByRole('button', { name: '手動輸入伺服器位址' })).toBeVisible()
}

test('reopening the retained Pairing component clears consumed successful confirmation', async ({
  page,
}) => {
  await start(page)
  await completed(page, true)
  await expect(page.getByRole('region', { name: 'Pairing surface' })).toBeHidden()
  await page.getByRole('button', { name: 'Show pairing' }).click()
  await emptyConnect(page)
})

test('a hidden original form clears its consumed code without taking navigation', async ({
  page,
}) => {
  await start(page)
  await page.getByRole('button', { name: 'Hide pairing' }).click()
  await completed(page, false)
  await expect(page.getByRole('region', { name: 'Pairing surface' })).toBeHidden()
  await page.getByRole('button', { name: 'Show pairing' }).click()
  await emptyConnect(page)
})

test('late success for A preserves the newly confirmed B form and does not activate A', async ({
  page,
}) => {
  await start(page)
  await page.getByLabel(inputName).fill(link('b'))
  await page.getByRole('button', { name: '繼續', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Character B' })).toBeVisible()
  await completed(page, false)
  await expect(page.getByLabel(inputName)).toHaveValue(link('b'))
  await expect(page.getByRole('heading', { name: 'Character B' })).toBeVisible()
  await expect(page.getByText('伺服器：https://b.example', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '確認並連接', exact: true })).toBeEnabled()
})
