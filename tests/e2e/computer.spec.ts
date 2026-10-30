import { navigate } from '../fixtures/navigation'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Profile } from '../../src/shared/api'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'

async function characterName(page: Page) {
  const connection = await currentConnection(page)
  return page.evaluate(async (id) => {
    const profile = await window.yuki.client.read<Profile>(id, { kind: 'character' })
    if (!profile.ok) throw Error(profile.code)
    return profile.value.display_name
  }, connection.characterId)
}

interface Facts {
  events: { kind: string; flags?: number; hex?: string; values?: number[] }[]
  clipboard: string
  connections: number
  mutations: number
  control: { holder: string; device_id?: string; lease_id?: string }
}
test(
  'real noVNC with two Electron devices controls, transfers, pastes and returns through the real backend',
  { tag: '@unix-manager' },
  async ({ page: attacker }) => {
    test.setTimeout(120000)
    const rig = await yukiFixture({ computer: true }),
      a = await rig.launch('computer-a'),
      b = await rig.launch('computer-b')
    let success = false
    const facts = async () => (await (await fetch(`${rig.base}/__test/computer`)).json()) as Facts
    try {
      const pa = await a.firstWindow(),
        pb = await b.firstWindow(),
        errors: string[] = []
      pa.on('pageerror', (error) => errors.push(error.message))
      await pairUI(pa, rig.base, await rig.code())
      await pairUI(pb, rig.base, await rig.code())
      const name = await characterName(pa)
      await navigate(pa, `${name} 的電腦`)
      await navigate(pb, `${name} 的電腦`)
      await expect(pa.getByRole('button', { name: '截圖存檔' })).toBeEnabled()
      await expect(pb.getByRole('button', { name: '截圖存檔' })).toBeEnabled()
      await expect.poll(async () => (await facts()).connections).toBe(2)
      await expect
        .poll(
          async () =>
            (await facts()).events.filter(
              (e) => e.kind === 'clipboard' && !!(e.flags! & 0x01000000),
            ).length,
        )
        .toBe(2)
      const encoded = (await facts()).events.filter((e) => e.kind === 'encodings')
      expect(encoded).toHaveLength(2)
      for (const event of encoded) {
        expect(event.values).not.toContain(-316)
        expect(event.values).not.toContain(-309)
      }
      const beforeTake = (await facts()).mutations
      await fetch(`${rig.base}/__test/lose-next-computer-response`, { method: 'POST' })
      await pa.getByRole('button', { name: '接手', exact: true }).click()
      await pa.getByRole('button', { name: '查證原請求', exact: true }).click()
      await expect.poll(async () => (await facts()).mutations).toBe(beforeTake + 1)
      await expect(pa.getByRole('button', { name: `交回給 ${name}`, exact: true })).toBeVisible()
      await expect(pa.getByRole('button', { name: `交回給 ${name}`, exact: true })).toBeEnabled()
      await expect(pb.getByRole('button', { name: '改由這台控制', exact: true })).toBeVisible()
      const firstLease = (await facts()).control.lease_id
      await pa
        .getByRole('application', { name: '遠端電腦畫面' })
        .click({ position: { x: 80, y: 80 } })
      await pa.keyboard.press('a')
      await expect
        .poll(async () => (await facts()).events.filter((e) => e.kind === 'extended').length)
        .toBeGreaterThan(0)
      await pa.keyboard.press('Control+Alt')
      const pasted = '中文與表情 🙂，從觀看後第一次接手。'
      await a.evaluate(({ clipboard }, text) => clipboard.writeText(text), pasted)
      await pa.getByRole('button', { name: '貼上文字到遠端畫面' }).click()
      await expect.poll(async () => (await facts()).clipboard).toBe(pasted)
      if (process.env.YUKI_DESKTOP_TEST_EVIDENCE)
        await pa.screenshot({
          path: join(process.env.YUKI_DESKTOP_TEST_EVIDENCE, 'F4-真Electron-接手.png'),
        })
      const png = join(rig.root, 'computer-screen.png')
      await a.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
      }, png)
      await pa.getByRole('button', { name: '截圖存檔' }).click()
      await expect
        .poll(async () => {
          try {
            return (await readFile(png)).subarray(0, 8).toString('hex')
          } catch {
            return ''
          }
        })
        .toBe('89504e470d0a1a0a')
      await pa.getByRole('button', { name: '檢視器', exact: true }).click()
      const currentFile = join(rig.root, 'current.txt')
      await a.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
      }, currentFile)
      await pa.getByRole('button', { name: '儲存目前內容', exact: true }).click()
      await expect
        .poll(async () => {
          try {
            return await readFile(currentFile, 'utf8')
          } catch {
            return ''
          }
        })
        .toBe('Current workspace bytes.')
      await pa.getByRole('button', { name: '關閉檢視器', exact: true }).click()
      await pb.getByRole('button', { name: '改由這台控制', exact: true }).click()
      await pb
        .getByRole('dialog', { name: '改由這台裝置控制？' })
        .getByRole('button', { name: '改由這台控制', exact: true })
        .click()
      await expect.poll(async () => (await facts()).control.lease_id).not.toBe(firstLease)
      await expect(pa.getByRole('button', { name: '貼上文字到遠端畫面' })).toBeDisabled()
      await expect(pb.getByRole('button', { name: '貼上文字到遠端畫面' })).toBeEnabled()
      await b.evaluate(({ clipboard }) => clipboard.writeText('另一台接手後的 Unicode 🦊'))
      await pb.getByRole('button', { name: '貼上文字到遠端畫面' }).click()
      await expect.poll(async () => (await facts()).clipboard).toBe('另一台接手後的 Unicode 🦊')
      await pb.getByRole('button', { name: `交回給 ${name}`, exact: true }).click()
      const sheet = pb.getByRole('dialog', { name: `交回給 ${name}` })
      await sheet.getByLabel('說明').fill('原畫面處理完成。')
      await sheet.getByRole('button', { name: '交回', exact: true }).click()
      await expect.poll(async () => (await facts()).control.holder).toBe('none')
      await expect(pb.getByRole('button', { name: '接手', exact: true })).toBeVisible()
      const ticket = await pa.evaluate(async () => {
        const connections = await window.yuki.client.connections()
        if (!connections.ok) throw new Error(connections.code)
        const result = await window.yuki.client.computerTicket(connections.value[0]!.characterId)
        if (!result.ok) throw new Error(result.code)
        return result.value
      })
      await attacker.goto('http://127.0.0.1:4178/novnc.html')
      await attacker.waitForFunction(() => Boolean(window.rfbTest))
      await attacker.evaluate((url) => window.rfbTest.connect(url), ticket)
      const before = await facts()
      await attacker.evaluate(() => window.rfbTest.forceInput())
      await expect
        .poll(async () => (await facts()).events.filter((e) => e.kind === 'read').length)
        .toBeGreaterThan(before.events.filter((e) => e.kind === 'read').length)
      const after = await facts()
      expect(after.events.filter((e) => ['key', 'extended', 'pointer'].includes(e.kind))).toEqual(
        before.events.filter((e) => ['key', 'extended', 'pointer'].includes(e.kind)),
      )
      expect(after.clipboard).toBe(before.clipboard)
      await attacker.evaluate(() => window.rfbTest.unknown())
      await expect.poll(() => attacker.evaluate(() => window.rfbTest.closed)).toBe(true)
      expect(errors).toEqual([])
      await pa.screenshot({ path: join(rig.root, 'computer-real-electron.png') })
      success = true
    } finally {
      for (const instance of [a, b])
        await instance
          .evaluate(({ dialog }) => {
            dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
          })
          .catch(() => {})
      await a.close()
      await b.close()
      await rig.close(success)
    }
  },
)

test(
  'native quit can cancel, keep the original lease across restart, then return and quit',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(120000)
    const rig = await yukiFixture({ computer: true })
    let app = await rig.launch('computer-quit'),
      success = false
    const control = async () =>
      ((await (await fetch(`${rig.base}/__test/computer`)).json()) as Facts).control
    try {
      let page = await app.firstWindow()
      await pairUI(page, rig.base, await rig.code())
      const name = await characterName(page)
      await navigate(page, `${name} 的電腦`)
      await page.getByRole('button', { name: '接手', exact: true }).click()
      await expect(page.getByRole('button', { name: '貼上文字到遠端畫面' })).toBeEnabled()
      const original = await control()
      await app.evaluate(({ dialog, app }) => {
        dialog.showMessageBox = async (
          windowOrOptions: Electron.BaseWindow | Electron.MessageBoxOptions,
          options?: Electron.MessageBoxOptions,
        ) => {
          ;(globalThis as unknown as { quitButtons: string[] }).quitButtons = (
            (options ?? windowOrOptions) as Electron.MessageBoxOptions
          ).buttons!
          return { response: 2, checkboxChecked: false }
        }
        app.quit()
      })
      await expect
        .poll(() =>
          app.evaluate(() => (globalThis as unknown as { quitButtons: string[] }).quitButtons),
        )
        .toEqual(['交回並結束', '保持控制並結束', '取消'])
      expect((await control()).lease_id).toBe(original.lease_id)
      await expect(page.getByRole('button', { name: `交回給 ${name}`, exact: true })).toBeVisible()
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      })
      await app.close()
      expect((await control()).lease_id).toBe(original.lease_id)
      app = await rig.launch('computer-quit')
      page = await app.firstWindow()
      await navigate(page, `${name} 的電腦`)
      await expect(page.getByRole('button', { name: '貼上文字到遠端畫面' })).toBeEnabled()
      expect((await control()).lease_id).toBe(original.lease_id)
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
      })
      await app.close()
      expect((await control()).holder).toBe('none')
      success = true
    } finally {
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
        })
        .catch(() => {})
      await app.close().catch(() => {})
      await rig.close(success)
    }
  },
)
