import { navigate } from '../fixtures/navigation'
import { expect, test } from '@playwright/test'
import { crashElectron } from '../fixtures/electron-process'
import { writeFile } from 'node:fs/promises'
import type { Profile } from '../../src/shared/api'
import { recordBusinessState, currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { captureWorkspace, contentSize } from '../fixtures/visual'

test(
  'computer controls stay in the 52px toolbar through viewing, takeover, transfer and return',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(180000)
    const rig = await yukiFixture({ computer: true }),
      a = await rig.launch('computer-toolbar-a'),
      b = await rig.launch('computer-toolbar-b')
    const facts = async () =>
      (await (await fetch(`${rig.base}/__test/computer`)).json()) as {
        control: { holder: string; lease_id?: string }
      }
    let success = false
    try {
      const pa = await a.firstWindow(),
        pb = await b.firstWindow()
      await pairUI(pa, rig.base, await rig.code())
      await pairUI(pb, rig.base, await rig.code())
      const connection = await currentConnection(pa)
      const name = await pa.evaluate(async (id) => {
        const profile = await window.yuki.client.read<Profile>(id, { kind: 'character' })
        if (!profile.ok) throw Error(profile.code)
        return profile.value.display_name
      }, connection.characterId)
      await navigate(pa, `${name} 的電腦`)
      const toolbar = pa.locator('[data-region="toolbar"]')
      const controls = toolbar.getByRole('group', { name: '電腦狀態與控制', exact: true })
      await expect(
        controls.getByRole('heading', { name: `${name} 的電腦`, exact: true }),
      ).toBeVisible()
      await captureWorkspace(
        a,
        pa,
        'state-computer-toolbar-viewing',
        async () => {
          await navigate(pa, `${name} 的電腦`)
          await expect(pa.getByRole('button', { name: '截圖存檔', exact: true })).toBeEnabled()
        },
        {
          verify: async () => {
            const box = await toolbar.boundingBox()
            expect(box?.height).toBe(52)
            await expect(
              controls.getByRole('button', { name: '接手', exact: true }),
            ).toBeInViewport({
              ratio: 1,
            })
            await expect(
              controls.getByRole('button', { name: '讓電腦休息', exact: true }),
            ).toBeInViewport({ ratio: 1 })
            expect(
              await pa.getByRole('heading', { name: `${name} 的電腦`, exact: true }).count(),
            ).toBe(1)
            const button = await controls
              .getByRole('button', { name: '接手', exact: true })
              .boundingBox()
            expect(button!.y).toBeGreaterThanOrEqual(box!.y)
            expect(button!.y + button!.height).toBeLessThanOrEqual(box!.y + box!.height)
          },
        },
      )
      await contentSize(a, pa, 1440, 900)
      await controls.getByRole('button', { name: '接手', exact: true }).click()
      await expect(
        controls.getByRole('button', { name: `交回給 ${name}`, exact: true }),
      ).toBeEnabled()
      const first = (await facts()).control
      expect(first.holder).toBe('human')
      await navigate(pb, `${name} 的電腦`)
      const other = pb
        .locator('[data-region="toolbar"]')
        .getByRole('group', { name: '電腦狀態與控制', exact: true })
      await other.getByRole('button', { name: '改由這台控制', exact: true }).click()
      await pb
        .getByRole('dialog', { name: '改由這台裝置控制？' })
        .getByRole('button', { name: '改由這台控制', exact: true })
        .click()
      await expect.poll(async () => (await facts()).control.lease_id).not.toBe(first.lease_id)
      await expect(
        controls.getByRole('button', { name: '改由這台控制', exact: true }),
      ).toBeVisible()
      await other.getByRole('button', { name: `交回給 ${name}`, exact: true }).click()
      await pb
        .getByRole('dialog', { name: `交回給 ${name}`, exact: true })
        .getByRole('button', { name: '交回', exact: true })
        .click()
      await expect.poll(async () => (await facts()).control.holder).toBe('none')
      await expect(controls.getByRole('button', { name: '接手', exact: true })).toBeEnabled()
      // Changing views removes only this role's portal and restores the common toolbar.
      await navigate(pa, '對話')
      await expect(toolbar.getByRole('group', { name: '電腦狀態與控制' })).toHaveCount(0)
      await expect(
        pa.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true }),
      ).toBeVisible()
      await navigate(pa, `${name} 的電腦`)
      await expect(controls.getByRole('button', { name: '接手', exact: true })).toBeEnabled()
      const longName = `${name}・在不同裝置間保留同一個長期角色的名稱`
      await navigate(pa, `關於 ${name}`)
      await pa.getByRole('button', { name: '編輯角色資料', exact: true }).click()
      await pa.getByRole('textbox', { name: '名稱', exact: true }).fill(longName)
      await pa.getByRole('button', { name: '儲存', exact: true }).click()
      await expect(pa.getByRole('heading', { name: longName, exact: true })).toBeVisible()
      await navigate(pa, `${longName} 的電腦`)
      await contentSize(a, pa, 960, 492)
      await controls.getByRole('button', { name: '接手', exact: true }).click()
      const longReturn = controls.getByRole('button', { name: `交回給 ${longName}`, exact: true })
      await expect(longReturn).toBeInViewport({ ratio: 1 })
      expect((await toolbar.boundingBox())!.height).toBe(52)
      expect((await controls.getByRole('heading').boundingBox())!.height).toBe(18)
      const { captureViewport } = await import('../fixtures/visual')
      await captureViewport(
        a,
        pa,
        test.info().outputPath('computer-toolbar-long-name-960x492-emulated.png'),
      )
      await longReturn.click()
      await pa
        .getByRole('dialog', { name: `交回給 ${longName}`, exact: true })
        .getByRole('button', { name: '交回', exact: true })
        .click()
      await expect.poll(async () => (await facts()).control.holder).toBe('none')
      await writeFile(
        test.info().outputPath('computer-toolbar-receipts.json'),
        JSON.stringify({ first, final: (await facts()).control }, null, 2) + '\n',
      )
      success = true
    } finally {
      if (!success) {
        await recordBusinessState(await a.firstWindow(), 'computer-state-a.json', true).catch(
          console.error,
        )
        await recordBusinessState(await b.firstWindow(), 'computer-state-b.json', true).catch(
          console.error,
        )
        await crashElectron(a).catch(() => {})
        await crashElectron(b).catch(() => {})
      }
      await a.close().catch(() => {})
      await b.close().catch(() => {})
      await rig.close(success)
    }
  },
)
