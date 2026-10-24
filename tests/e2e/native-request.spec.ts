import { expect, test, type Page } from '@playwright/test'
import type { ConnectorTarget } from '../../src/shared/connector'

function recorded(page: Page) {
  return page.evaluate(() => {
    const fixture = window as Window & {
      __nativeRequestedPermissions?: NonNullable<ConnectorTarget['response']>
      __nativeResponses?: Partial<ConnectorTarget>[]
    }
    return {
      requested: fixture.__nativeRequestedPermissions!,
      responses: fixture.__nativeResponses!,
    }
  })
}

test('native permission approval displays the requested scopes and grants only the original turn', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 700 })
  await page.goto('http://127.0.0.1:4178/native-request.html')
  await expect(page.getByText('工作目錄：/isolated/native/project', { exact: true })).toBeVisible()
  await expect(page.getByText('寫入：/isolated/native/project', { exact: true })).toBeVisible()
  await expect(
    page.getByText('讀取：符合模式：/isolated/native/project/docs/**/*.md', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('讀取：專案根目錄/docs', { exact: true })).toBeVisible()
  await expect(page.getByText('路徑模式掃描深度：3', { exact: true })).toBeVisible()
  await expect(page.getByText('網路：允許連線', { exact: true })).toBeVisible()
  await expect(page.getByText('僅限這一回合（turn），回合結束後失效。')).toBeVisible()
  const original = await recorded(page)
  expect(original.responses).toEqual([])
  await page.getByRole('button', { name: '允許本回合', exact: true }).click()
  const value = await recorded(page)
  expect(value.responses).toEqual([
    { permission_id: '71', response: { permissions: original.requested, scope: 'turn' } },
  ])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByText('這項原生請求沒有提供可選回覆', { exact: false })).toHaveCount(0)
})

test('rejecting a native permission request grants none of its requested file or network access', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/native-request.html')
  await page.getByRole('button', { name: '拒絕權限要求', exact: true }).click()
  expect((await recorded(page)).responses).toEqual([
    { permission_id: '71', response: { permissions: {}, scope: 'turn' } },
  ])
})

test('legacy native read and write scopes retain their original response shape', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/native-request.html?mode=legacy')
  await expect(page.getByText('讀取：/isolated/notes.txt', { exact: true })).toBeVisible()
  await expect(page.getByText('寫入：/isolated/output', { exact: true })).toBeVisible()
  await expect(page.getByText('網路：不新增連線權限', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '允許本回合', exact: true }).click()
  expect((await recorded(page)).responses).toEqual([
    {
      permission_id: '71',
      response: {
        permissions: {
          fileSystem: { read: ['/isolated/notes.txt'], write: ['/isolated/output'] },
          network: { enabled: false },
        },
        scope: 'turn',
      },
    },
  ])
})

test('command approval shows its additional permissions and retains the original decision contract', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/native-request.html?mode=command')
  await expect(page.getByText('run original command', { exact: true })).toBeVisible()
  await expect(page.getByText('這次命令要求的額外權限', { exact: true })).toBeVisible()
  await expect(page.getByText('寫入：/isolated/native/project', { exact: true })).toBeVisible()
  await expect(page.getByText('網路：允許連線', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '允許本回合', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'accept', exact: true }).click()
  expect((await recorded(page)).responses).toEqual([
    { permission_id: '71', response: { decision: 'accept' } },
  ])
})
