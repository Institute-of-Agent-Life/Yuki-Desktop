import { navigate, sidebar } from '../fixtures/navigation'
import { activeCharacterName } from '../fixtures/active-character'
import { expect, test } from '@playwright/test'
import { pairUI, yukiFixture } from '../fixtures/backend'

test(
  'actual role switches retain independent remote computer leases',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(180000)
    const first = await yukiFixture({ character: true, computer: true })
    const second = await yukiFixture({ character: true, computer: true })
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
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '所有 Yuki', exact: true }).click()
      await page.getByRole('button', { name: '連接…', exact: true }).click()
      await pairUI(page, second.base, await second.code())
      await navigate(page, `關於 ${await activeCharacterName(page)}`)
      await page.getByRole('button', { name: '編輯名稱與簡介', exact: true }).click()
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
      await expect(page.locator(`[data-character-session="${original.characterId}"]`)).toBeVisible()
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
