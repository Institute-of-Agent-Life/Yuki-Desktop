import { expect, test, type ElectronApplication } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { activeCharacterName } from '../fixtures/active-character'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'

/*
 * Yuki's own computer task book (2026-11-14) §7 and R2a, failure cases written before the code:
 * H1 The window is hidden or minimized and the computer page keeps its remote screen stream, so
 *    the Manager still counts someone watching and the display never rests.
 * H2 Only the full computer page closes; the inspector's compact preview keeps its stream.
 * H3 Showing the window again leaves the screen disconnected until the person reconnects by hand.
 * H4 Hiding the window returns the person's control, or showing it takes control anew.
 * H5 A reconnect while hidden: the stream comes back on its own retry although nobody can see it.
 */

interface Facts {
  connections: number
  display_streams: number
  control: { holder: string; device_id?: string; lease_id?: string }
}

async function setShown(app: ElectronApplication, how: 'hide' | 'show' | 'minimize' | 'restore') {
  await app.evaluate(({ BrowserWindow }, how) => {
    BrowserWindow.getAllWindows()[0]![how]()
  }, how)
}

test(
  'hiding or minimizing the window closes every remote screen stream and showing it reconnects, control kept',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(150000)
    const rig = await yukiFixture({ computer: true, character: true })
    const app = await rig.launch('computer-hidden')
    const facts = async () => (await (await fetch(`${rig.base}/__test/computer`)).json()) as Facts
    const steps: { step: string; facts: Facts; open: number }[] = []
    let open = 0,
      success = false
    const record = async (step: string) => steps.push({ step, facts: await facts(), open })
    try {
      const page = await app.firstWindow()
      // The renderer's own display WebSockets, beside the Manager's count of streams.
      page.on('websocket', (socket) => {
        if (!socket.url().includes('/computer/display')) return
        open++
        socket.on('close', () => open--)
      })
      await pairUI(page, rig.base, await rig.code())
      const name = await activeCharacterName(page)
      await navigate(page, `${name} 的電腦`)
      const screen = page.getByRole('application', { name: '遠端電腦畫面' })
      await expect(screen.locator('canvas')).toBeVisible()
      await expect(page.getByRole('button', { name: '截圖存檔' })).toBeEnabled()
      await expect.poll(async () => (await facts()).display_streams).toBe(1)
      await page.getByRole('button', { name: '接手', exact: true }).click()
      await expect(page.getByRole('button', { name: '貼上文字到遠端畫面' })).toBeEnabled()
      const held = (await facts()).control
      expect(held.holder).toBe('human')
      await record('page-watching-held')

      // Without a window manager (the Linux CI display) a window cannot be minimized; macOS
      // reports hiding through occlusion, which a locked or covered test screen never changes.
      const cycles: ['hide' | 'minimize', 'show' | 'restore'][] = [
        ...(process.platform === 'darwin' ? [] : [['hide', 'show'] as ['hide', 'show']]),
        ...(process.platform === 'linux'
          ? []
          : [['minimize', 'restore'] as ['minimize', 'restore']]),
      ]
      for (const [away, back] of cycles) {
        const before = (await facts()).connections
        await setShown(app, away)
        await expect.poll(async () => (await facts()).display_streams).toBe(0)
        await expect.poll(() => open).toBe(0)
        await record(`page-${away}`)
        // Nothing reconnects while nobody can see the window (H5): the disconnected screen
        // retries after 1.5 s, so a hidden one that would retry has done so by now.
        await page.waitForTimeout(3000)
        expect((await facts()).display_streams).toBe(0)
        expect((await facts()).connections).toBe(before)
        expect((await facts()).control).toEqual(held)
        await setShown(app, back)
        await expect.poll(async () => (await facts()).display_streams).toBe(1)
        await expect(page.getByRole('button', { name: '截圖存檔' })).toBeEnabled()
        // Still this device's control, with input enabled again on the new connection.
        await expect(page.getByRole('button', { name: '貼上文字到遠端畫面' })).toBeEnabled()
        expect((await facts()).control).toEqual(held)
        await record(`page-${back}`)
      }

      // The inspector's compact preview in the conversation follows the same window.
      await page.keyboard.press('ControlOrMeta+1')
      const inspector = page.getByRole('complementary', { name: '詳情', exact: true })
      if (!(await inspector.count()))
        await page.getByRole('button', { name: '詳情', exact: true }).click()
      await inspector.getByRole('tab', { name: '電腦', exact: true }).click()
      await expect(
        inspector.getByRole('img', { name: '遠端電腦預覽' }).locator('canvas'),
      ).toBeVisible()
      await expect.poll(async () => (await facts()).display_streams).toBe(1)
      await record('preview-watching')
      const [away, back] = cycles[0]!
      await setShown(app, away)
      await expect.poll(async () => (await facts()).display_streams).toBe(0)
      await expect.poll(() => open).toBe(0)
      await record(`preview-${away}`)
      await setShown(app, back)
      await expect.poll(async () => (await facts()).display_streams).toBe(1)
      await expect(inspector.getByText('正在連接畫面', { exact: true })).toHaveCount(0)
      expect((await facts()).control).toEqual(held)
      await record(`preview-${back}`)

      await inspector.getByRole('button', { name: `交回給 ${name}`, exact: true }).click()
      await page
        .getByRole('dialog', { name: `交回給 ${name}` })
        .getByRole('button', { name: '交回', exact: true })
        .click()
      await expect.poll(async () => (await facts()).control.holder).toBe('none')
      success = true
    } finally {
      await writeFile(
        test.info().outputPath('hidden-window-streams.json'),
        JSON.stringify({ platform: process.platform, steps }, null, 2),
      )
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
        })
        .catch(() => {})
      await app.close()
      await rig.close(success)
    }
  },
)
