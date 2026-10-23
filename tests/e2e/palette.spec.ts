import { captureViewport, contentSize } from '../fixtures/visual'
import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
async function open(page: Page, text = '') {
  await page.keyboard.press('ControlOrMeta+k')
  const dialog = page.getByRole('dialog', { name: '指令面板', exact: true }),
    input = dialog.getByRole('combobox')
  await expect(input).toBeFocused()
  await input.fill(text)
  return { dialog, input }
}

test('palette searches only actual loaded entries and exact-event verification never opens the next event after deletion', async () => {
  test.setTimeout(150000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/palette'),
    app = await rig.launch('palette-messages')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code())
    const source = (await (
      await fetch(`${rig.base}/__test/qq-entry`, { method: 'POST' })
    ).json()) as { event_id: number; conversation_id: string }
    let palette = await open(page, 'QQ 原入口')
    await expect(palette.dialog.getByRole('option')).toHaveCount(0)
    expect(
      proxy.calls.some((call) =>
        call.path.includes(`/conversations/${source.conversation_id}/events`),
      ),
    ).toBe(false)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^QQ ·/ }).click()
    await expect(page.getByText('QQ 原入口的真實帳本內容', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '回到桌面對話', exact: true }).click()
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    await composer.fill('新的桌面訊息不會移除已載入的 QQ 搜尋內容')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true }).last()).toBeVisible()
    await composer.focus()
    palette = await open(page, 'QQ 原入口')
    await expect(palette.dialog.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(composer).toBeFocused()
    palette = await open(page, 'QQ 原入口')
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(palette.dialog).not.toBeVisible()
    await expect(
      page
        .getByRole('region', { name: '原訊息舞台' })
        .locator(`article[data-event-id="${source.event_id}"]`),
    ).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(
      page
        .getByRole('region', { name: '原訊息舞台' })
        .locator(`article[data-event-id="${source.event_id}"]`),
    ).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+e')
    await page.getByRole('button', { name: '回到桌面對話', exact: true }).click()
    const nextResponse = await fetch(`${rig.base}/__test/qq-entry`, { method: 'POST' })
    expect(nextResponse.status).toBe(200)
    const next = (await nextResponse.json()) as { event_id: number; conversation_id: string }
    expect(next.conversation_id).toBe(source.conversation_id)
    await page.getByRole('button', { name: /^QQ ·/ }).click()
    await expect(page.locator(`article[data-event-id="${next.event_id}"]`)).toBeVisible()
    await page.getByRole('button', { name: '回到桌面對話', exact: true }).click()
    palette = await open(page, 'QQ 原入口')
    const original = palette.dialog.locator(
      `[data-item-id="message/${source.conversation_id}/${source.event_id}"]`,
    )
    await original.hover()
    await expect(original).toHaveAttribute('aria-selected', 'true')
    proxy.pauseActive('/client/v1/stream?works=active')
    await fetch(`${rig.base}/__test/events/${source.event_id}`, { method: 'DELETE' })
    await page.keyboard.press('Enter')
    await expect(palette.dialog.getByRole('alert')).toHaveText('引用的訊息無法讀取')
    await expect(original).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(palette.dialog.getByRole('alert')).toHaveText('所選項目已更新，請重新選擇。')
    expect(
      proxy.calls.some(
        (call) =>
          call.path.includes(`after=${source.event_id - 1}`) && call.path.includes('limit=1'),
      ),
    ).toBe(true)
    await expect(palette.dialog).toBeVisible()
    proxy.resumeActive('/client/v1/stream?works=active')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^QQ ·/ }).click()
    await expect(page.locator(`article[data-event-id="${source.event_id}"]`)).toHaveCount(0)
    await expect(page.locator(`article[data-event-id="${next.event_id}"]`)).toBeVisible()
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await rig.close(success)
  }
})

test('palette navigation preserves the original unsaved prompt guard', async () => {
  const rig = await yukiFixture(),
    app = await rig.launch('palette-prompt')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await page.getByRole('button', { name: '關於 初始角色', exact: true }).click()
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'SOUL.md 內容', exact: true })
    await expect(editor).toHaveAttribute('aria-readonly', 'false')
    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.insertText('尚未儲存的原角色提示詞')
    await open(page, '開啟設定')
    await page.keyboard.press('Enter')
    const guard = page.getByRole('dialog', { name: '要儲存變更嗎？', exact: true })
    await expect(guard).toBeVisible()
    await guard.getByRole('button', { name: '取消', exact: true }).click()
    await expect(editor).toHaveText('尚未儲存的原角色提示詞')
    await open(page, '開啟設定')
    await page.keyboard.press('Enter')
    await guard.getByRole('button', { name: '不儲存', exact: true }).click()
    await expect(page.getByRole('tab', { name: '一般', exact: true })).toBeVisible()
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('palette geometry, keyboard focus and footer remain usable across themes, small windows and zoom', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('palette-visual')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ }).fill('可搜尋的真實訊息')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true }).last()).toBeVisible()
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await contentSize(app, page, 1440, 900)
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radio', { name: mode === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      for (const [label, value] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = page.getByRole('switch', { name: label, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(value)) await toggle.click()
      }
      await page.getByRole('button', { name: '返回', exact: true }).click()
      for (const [width, height] of [
        [1440, 900],
        [1100, 760],
        [960, 492],
      ] as const) {
        const viewportMethod = await contentSize(app, page, width, height)
        await expect
          .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
          .toEqual([width, height])
        const palette = await open(page)
        await expect(palette.dialog).toHaveCSS('width', '640px')
        await expect(palette.dialog).toHaveCSS('top', height < 600 ? '32px' : '120px')
        await expect(palette.input).toHaveCSS('height', '44px')
        await expect(
          palette.dialog.getByText('只搜尋這台電腦已載入的內容', { exact: true }),
        ).toBeInViewport()
        await page.keyboard.press('ArrowDown')
        await expect(palette.input).toBeFocused()
        await captureViewport(
          app,
          page,
          test
            .info()
            .outputPath(
              `isolated-native-${mode}-palette-${width}x${height}${viewportMethod === 'electron-device-emulation' ? '-emulated' : ''}.png`,
            ),
        )
        await page.keyboard.press('Escape')
      }
    }
    await contentSize(app, page, 960, 640)
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1.5),
    )
    const palette = await open(page)
    await expect(palette.dialog).toHaveCSS('width', '576px')
    await expect(
      palette.dialog.getByText('只搜尋這台電腦已載入的內容', { exact: true }),
    ).toBeInViewport()
    const footer = await palette.dialog
      .getByText('只搜尋這台電腦已載入的內容', { exact: true })
      .boundingBox()
    expect(footer).not.toBeNull()
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
    // Electron's native capture includes the full zoomed surface; the CDP
    // screenshot clip is expressed in unzoomed coordinates on this platform.
    const capture = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toDataURL(),
    )
    await writeFile(
      test.info().outputPath('isolated-palette-150-percent-native.png'),
      Buffer.from(capture.split(',')[1]!, 'base64'),
    )
    await page.keyboard.press('Escape')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1),
    )
    success = true
  } finally {
    await app.close().catch(() => {})
    await rig.close(success)
  }
})
