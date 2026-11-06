import { expect, test } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { currentConnection, pairUI } from '../fixtures/backend'
import { isolatedDesktop } from '../fixtures/isolated-desktop'
import { navigate } from '../fixtures/navigation'
import type { Computer, Profile } from '../../src/shared/api'

test('switch between a real sandbox and SnowLuma login without taking the sandbox lease', async () => {
  const base = process.env.YUKI_DESKTOP_QQ_BACKEND_URL
  test.skip(!base, 'Requires an isolated backend and a new, unpaired QQ desktop.')
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(base!).hostname)
  const root = await mkdtemp(join(tmpdir(), 'yuki-qq-display-'))
  const app = await (await isolatedDesktop(root)).launch('qq-display')
  try {
    const page = await app.firstWindow()
    const response = await fetch(base + '/__test/link-code', { method: 'POST' })
    await pairUI(page, base!, ((await response.json()) as { code: string }).code)
    const connection = await currentConnection(page)
    const profile = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
      if (!result.ok) throw Error(result.code)
      return result.value.display_name
    }, connection.characterId)
    await navigate(page, profile + ' 的電腦')
    const selector = page.getByRole('combobox', { name: '顯示器' })
    const capture = page.getByRole('button', { name: '截圖存檔', exact: true })
    await expect(capture).toBeEnabled()
    await selector.selectOption('qq-view')
    await expect(capture).toBeEnabled()
    await page.getByRole('button', { name: '接手 QQ', exact: true }).click()
    await expect(capture).toBeEnabled()
    const getSandbox = () =>
      page.evaluate(async (id) => {
        const result = await window.yuki.client.read<Computer>(id, { kind: 'computer' })
        if (!result.ok) throw Error(result.code)
        return result.value
      }, connection.characterId)
    expect((await getSandbox()).control?.holder).toBe('none')
    await page.screenshot({ path: test.info().outputPath('local-qq-login.png') })
    await page.getByRole('button', { name: '結束 QQ 控制', exact: true }).click()
    await expect(capture).toBeEnabled()
    await selector.selectOption('sandbox')
    await expect(capture).toBeEnabled()
    await expect(page.getByRole('button', { name: '接手', exact: true })).toBeEnabled()
    expect((await getSandbox()).control?.holder).toBe('none')
  } finally {
    await app.close()
  }
})
