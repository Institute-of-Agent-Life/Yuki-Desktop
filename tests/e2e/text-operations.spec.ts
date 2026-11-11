import { expect, test, type Page } from '@playwright/test'
import type { MessageBoxOptions } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { currentConnection, pairUI, waitForAcceptedMessage, yukiFixture } from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'

type Item = { label: string; enabled: boolean }
type Probe = { menus: Item[][]; confirmations: string[]; opened: string[] }
type Host = typeof globalThis & { textProbe: Probe; lastMenu?: Electron.Menu }

test('every text surface offers native editing, copying and link actions', async () => {
  test.setTimeout(180_000)
  const rig = await yukiFixture({ richMedia: true }),
    app = await rig.launch('text-operations')
  const evidence: Record<string, unknown> = {}
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    // Menus are recorded instead of shown; a test then chooses one item, as a person would.
    await app.evaluate(({ dialog, shell, Menu }) => {
      const host = globalThis as Host
      host.textProbe = { menus: [], confirmations: [], opened: [] }
      dialog.showMessageBox = (async (...args: unknown[]) => {
        host.textProbe.confirmations.push(String((args.at(-1) as MessageBoxOptions).detail))
        return { response: 1, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      shell.openExternal = async (url) => {
        host.textProbe.opened.push(url)
      }
      Menu.prototype.popup = function (this: Electron.Menu) {
        host.lastMenu = this
        host.textProbe.menus.push(
          this.items
            .filter((item) => item.type !== 'separator')
            .map((item) => ({ label: item.label, enabled: item.enabled })),
        )
      }
    })
    const probe = () => app.evaluate(() => (globalThis as Host).textProbe)
    const menuAt = async (
      target: ReturnType<Page['locator']>,
      position?: { x: number; y: number },
    ) => {
      const count = (await probe()).menus.length
      await target.click({ button: 'right', ...(position ? { position } : {}) })
      await expect.poll(async () => (await probe()).menus.length).toBe(count + 1)
      return (await probe()).menus.at(-1)!
    }
    const choose = (label: string) =>
      app.evaluate(({ BrowserWindow }, label) => {
        const window = BrowserWindow.getAllWindows()[0]!
        const item = (globalThis as Host).lastMenu!.items.find((entry) => entry.label === label)
        if (!item?.enabled) throw Error(`menu item unavailable: ${label}`)
        item.click(undefined, window, window.webContents)
      }, label)
    const labels = (menu: Item[]) => menu.map((item) => item.label)
    const editing = ['復原', '重做', '剪下', '複製', '貼上', '全選']

    // 1–3: the composer has the ordinary editing menu, enabled by what it can do.
    const box = page.getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true })
    const empty = await menuAt(box)
    expect(labels(empty)).toEqual(editing)
    expect(empty.find((item) => item.label === '剪下')!.enabled).toBe(false)
    expect(empty.find((item) => item.label === '複製')!.enabled).toBe(false)
    await box.fill('alpha beta')
    // Right-click on the text itself, as a person does on a selection.
    const onText = { x: 24, y: ((await box.boundingBox())!.height / 2) | 0 }
    await menuAt(box, onText)
    await choose('全選')
    await menuAt(box, onText)
    await choose('剪下')
    await expect(box).toHaveValue('')
    await menuAt(box)
    await choose('貼上')
    await expect(box).toHaveValue('alpha beta')
    await box.press('End')
    await page.keyboard.type(' gamma')
    await expect(box).toHaveValue('alpha beta gamma')
    await menuAt(box)
    await choose('復原')
    await expect(box).not.toHaveValue('alpha beta gamma')
    evidence.composer = { empty, afterUndo: await box.inputValue() }
    await box.fill('')

    // A work whose sent result carries Markdown links.
    const report = 'https://example.invalid/report',
      raw = 'https://example.invalid/raw',
      own = 'https://example.invalid/own'
    const result = `成果在 [報告](${report}) 與 ${raw} ，請查看。`
    await fetch(`${rig.base}/__test/link-work-scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: '連結工作', text: result }),
    })
    const request = `請建立連結工作 ${own}`
    await box.fill(request)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const sent = await waitForAcceptedMessage(page, connection.characterId, request)
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: '連結工作', exact: true }) })
    await expect(card.getByText('已完成', { exact: true })).toBeVisible({ timeout: 30_000 })

    // 8: a message link offers opening and copying the link itself.
    const ownLink = page.locator(`article[data-event-id="${sent.eventId}"]`).getByRole('link')
    const messageMenu = await menuAt(ownLink)
    expect(labels(messageMenu)).toEqual(['複製', '開啟連結', '複製連結'])
    await choose('開啟連結')
    await expect.poll(async () => (await probe()).opened).toEqual([own])

    await card.getByRole('button', { name: '查看詳情', exact: true }).click()
    const detail = page.getByRole('complementary', { name: '詳情' })
    const results = detail
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '已傳送的訊息與成果' }) })
    // 5: the result renders its Markdown links.
    const reportLink = results.getByRole('link', { name: '報告', exact: true })
    await expect(reportLink).toHaveAttribute('href', report)
    await expect(results.getByRole('link', { name: raw, exact: true })).toHaveAttribute('href', raw)
    // 6: a left click asks first, then opens the original address.
    await reportLink.click()
    await expect.poll(async () => (await probe()).opened).toEqual([own, report])
    // 7: the link's own menu opens through the same confirmation and copies the address.
    const linkMenu = await menuAt(reportLink)
    // macOS also selects the link's text on a right click, which adds an ordinary Copy.
    expect(labels(linkMenu).slice(-2)).toEqual(['開啟連結', '複製連結'])
    await choose('開啟連結')
    await expect.poll(async () => (await probe()).opened).toEqual([own, report, report])
    await menuAt(reportLink)
    await choose('複製連結')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(report)
    // 4: selected work text can be copied, and pastes back into the composer.
    const paragraph = results.locator('p').first()
    const selected = await paragraph.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node.firstChild!)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(range)
      return getSelection()!.toString()
    })
    expect(selected).toBe('成果在 ')
    const selectionMenu = await menuAt(paragraph, { x: 6, y: 8 })
    expect(labels(selectionMenu)).toEqual(['複製'])
    await choose('複製')
    await menuAt(box)
    await choose('貼上')
    await expect(box).toHaveValue(selected)
    await box.fill('')

    // 9: a Markdown document preview keeps opening its links.
    const documentLink = 'https://example.invalid/document'
    const file = 'links.md'
    await writeFile(join(rig.root, file), `# 連結文件\n\n請看 [說明](${documentLink})。\n`)
    const delivered = await fetch(`${rig.base}/__test/media-artifact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file, text: '文件已附上' }),
    })
    expect(delivered.ok).toBe(true)
    await navigate(page, '檔案與成果')
    const stage = page.getByRole('region', { name: '成果預覽' })
    await stage.getByRole('link', { name: '說明', exact: true }).click()
    await expect
      .poll(async () => (await probe()).opened)
      .toEqual([own, report, report, documentLink])

    const { menus, confirmations, opened } = await probe()
    expect(confirmations).toEqual(opened)
    evidence.menus = menus
    evidence.confirmations = confirmations
    evidence.opened = opened
    evidence.copiedSelection = selected
    success = true
  } finally {
    await writeFile(
      test.info().outputPath('text-operations.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    )
    await app.close()
    await rig.close(success)
  }
})
