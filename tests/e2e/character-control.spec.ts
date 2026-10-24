import { navigate, sidebar } from '../fixtures/navigation'
import { activeCharacterName } from '../fixtures/active-character'
import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Connection } from '../../src/shared/api'
import { pairUI, yukiFixture } from '../fixtures/backend'

async function local(page: Page) {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '本機連接', exact: true }).click()
}
async function state(page: Page, connection: Connection) {
  return page.evaluate(async (id) => {
    const value = await window.yuki.client.executorState(id)
    if (!value.ok) throw new Error(value.code)
    return value.value
  }, connection.characterId)
}
test(
  'actual role switches retain independent leases, folder grants and executor pauses',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(180000)
    const first = await yukiFixture({ character: true, computer: true, executor: true })
    const second = await yukiFixture({ character: true, computer: true, executor: true })
    const app = await first.launch('role-controls')
    let success = false
    const facts = async (base: string) =>
      (await (await fetch(base + '/__test/computer')).json()) as {
        control: { holder: string; lease_id?: string }
      }
    try {
      const page = await app.firstWindow()
      await pairUI(page, first.base, await first.code())
      const firstName = await activeCharacterName(page)
      const original = await page.evaluate(async () => {
        const value = await window.yuki.client.connections()
        if (!value.ok) throw Error(value.code)
        return value.value[0]!
      })
      await local(page)
      await page
        .getByRole('button', {
          name: `允許 ${await activeCharacterName(page)} 使用這台電腦`,
          exact: true,
        })
        .click()
      await expect.poll(async () => (await state(page, original)).state).toBe('online')
      const folder = join(first.root, 'private-yuki-folder')
      await mkdir(folder)
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, folder)
      await page.getByRole('button', { name: '新增資料夾…', exact: true }).click()
      await page.getByRole('textbox', { name: '資料夾別名（可選）' }).fill('收件匣')
      await page.getByRole('button', { name: '選擇資料夾…', exact: true }).click()
      await expect
        .poll(async () =>
          (await state(page, original)).installation?.scopes.map((scope) => scope.alias),
        )
        .toEqual(['收件匣'])
      expect(JSON.stringify(await state(page, original))).not.toContain(folder)
      await page.getByRole('tab', { name: '伺服器與角色', exact: true }).click()
      await page.getByRole('button', { name: '加入另一個角色', exact: true }).click()
      await pairUI(page, second.base, await second.code())
      const next = await page.evaluate(async (id) => {
        const value = await window.yuki.client.connections()
        if (!value.ok) throw Error(value.code)
        return value.value.find((item) => item.characterId !== id)!
      }, original.characterId)
      await expect.poll(async () => (await state(page, next)).installation).toBeNull()
      await navigate(page, `關於 ${await activeCharacterName(page)}`)
      await page.getByRole('button', { name: '編輯角色資料', exact: true }).click()
      await page.getByLabel('名稱', { exact: true }).fill('Mika')
      await page.getByRole('button', { name: '儲存', exact: true }).click()
      await expect(
        (await sidebar(page)).getByRole('button', { name: 'Mika 的電腦', exact: true }),
      ).toBeVisible()
      await navigate(page, 'Mika 的電腦')
      await page.getByRole('button', { name: '接手', exact: true }).click()
      await expect.poll(async () => (await facts(second.base)).control.holder).toBe('human')
      const mikaLease = (await facts(second.base)).control.lease_id
      await page.keyboard.press('ControlOrMeta+Shift+[')
      await navigate(page, `${firstName} 的電腦`)
      await page.getByRole('button', { name: '接手', exact: true }).click()
      await expect.poll(async () => (await facts(first.base)).control.holder).toBe('human')
      const yukiLease = (await facts(first.base)).control.lease_id
      expect((await facts(second.base)).control.lease_id).toBe(mikaLease)
      await page.keyboard.press('ControlOrMeta+Shift+]')
      await expect(page.getByRole('button', { name: '交回給 Mika', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '交回給 Mika', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: '交回', exact: true }).click()
      await expect.poll(async () => (await facts(second.base)).control.holder).toBe('none')
      expect((await facts(first.base)).control.lease_id).toBe(yukiLease)
      expect((await facts(first.base)).control.holder).toBe('human')
      await local(page)
      await expect(
        page.getByRole('button', { name: '允許 Mika 使用這台電腦', exact: true }),
      ).toBeVisible()
      await page.getByRole('button', { name: '允許 Mika 使用這台電腦', exact: true }).click()
      await expect.poll(async () => (await state(page, next)).state).toBe('online')
      expect((await state(page, next)).installation?.scopes).toEqual([])
      await page.getByRole('switch', { name: '允許顯示通知', exact: true }).click()
      await expect(page.getByRole('switch', { name: '允許顯示通知', exact: true })).toBeChecked()
      await page.getByRole('switch', { name: '暫停本機連接', exact: true }).click()
      await expect.poll(async () => (await state(page, next)).installation?.paused).toBe(true)
      const firstState = await state(page, original)
      expect(firstState.installation?.paused).toBe(false)
      expect(firstState.installation?.scopes.map((scope) => scope.alias)).toEqual(['收件匣'])
      expect(firstState.installation?.consents.some((grant) => grant.capability === 'notify')).toBe(
        false,
      )
      expect(firstState.installation?.executorId).not.toBe(
        (await state(page, next)).installation?.executorId,
      )
      await page.keyboard.press('ControlOrMeta+Shift+[')
      await expect(
        page.getByRole('button', {
          name: `交回給 ${firstName}`,
          exact: true,
        }),
      ).toBeVisible()
      await page.getByRole('button', { name: `交回給 ${firstName}`, exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: '交回', exact: true }).click()
      await expect.poll(async () => (await facts(first.base)).control.holder).toBe('none')
      success = true
    } finally {
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
        })
        .catch(() => {})
      await app.close()
      await first.close(success)
      await second.close(success)
    }
  },
)
