import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { captureViewport, contentSize } from '../fixtures/visual'

const guideFor = (page: Page) => page.locator('details[aria-label="Tailscale 連接說明"]')

async function captureGuide(app: ElectronApplication, page: Page, context: string) {
  const guide = guideFor(page)
  const layouts = []
  for (const [width, height] of [
    [1440, 900],
    [720, 560],
    [960, 492],
  ] as const) {
    await contentSize(app, page, width, height)
    const command = guide.locator('code')
    await command.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }),
    )
    await expect(command).toBeInViewport({ ratio: 1 })
    const layout = await guide.evaluate((element) => {
      const rect = (node: Element) => {
        const { x, y, width, height } = node.getBoundingClientRect()
        return { x, y, width, height }
      }
      return {
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        guide: rect(element),
        command: rect(element.querySelector('code')!),
        text: element.textContent,
      }
    })
    expect(layout.command.x).toBeGreaterThanOrEqual(0)
    expect(layout.command.x + layout.command.width).toBeLessThanOrEqual(layout.viewport.width)
    layouts.push(layout)
    await captureViewport(
      app,
      page,
      test.info().outputPath(`tailscale-${context}-${width}x${height}.png`),
    )
  }
  await writeFile(
    test.info().outputPath(`tailscale-${context}-layout.json`),
    JSON.stringify(layouts, null, 2) + '\n',
  )
}

test('static Tailscale guidance keeps original pairing, connection errors and the current draft', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    proxy = await forwardProxy(rig.base, '/tailscale-guide'),
    unavailable = await forwardProxy(rig.base, '/unavailable')
  const app = await rig.launch('tailscale-guide')
  let success = false
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '連接已有 Yuki', exact: true }).click()
    await expect(page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })).toBeVisible()
    // The original app is already on its real pairing form before checking the new surface.
    expect(await guideFor(page).count()).toBe(1)
    const guide = guideFor(page)
    await guide.locator('summary').first().click()
    await expect(guide.getByText('在執行 Yuki 的伺服器操作', { exact: true })).toBeVisible()
    await expect(guide.getByRole('button', { name: /執行|幫我運行/ })).toHaveCount(0)
    await app.evaluate(({ dialog, shell }) => {
      const host = globalThis as typeof globalThis & { __tailscaleGuideExternal: string[] }
      host.__tailscaleGuideExternal = []
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      shell.openExternal = async (url) => {
        host.__tailscaleGuideExternal.push(url)
      }
    })
    await guide.getByRole('button', { name: '下載 Tailscale', exact: true }).click()
    await guide.getByRole('button', { name: '伺服器接入指南', exact: true }).click()
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as typeof globalThis & { __tailscaleGuideExternal: string[] })
              .__tailscaleGuideExternal,
        ),
      )
      .toEqual([
        'https://tailscale.com/download',
        'https://github.com/YuanYeYouTao/Yuki-QQbot/blob/main/docs/operations/tailscale-connection.zh-CN.md',
      ])
    await guide.getByRole('button', { name: '複製伺服器指令範本', exact: true }).click()
    const copied = await page.evaluate(() => window.yuki.client.paste())
    expect(copied).toMatchObject({
      ok: true,
      value: expect.stringContaining('--https=<HTTPS連接埠>'),
    })
    await captureGuide(app, page, 'pairing')
    await contentSize(app, page, 1440, 900)
    await page.getByRole('button', { name: '手動輸入伺服器位址', exact: true }).click()
    await page.getByLabel('伺服器位址', { exact: true }).fill(proxy.base)
    proxy.faults.offline = true
    await page.getByRole('button', { name: '繼續', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: '伺服器暫時無法接收，尚未寫入。' }),
    ).toBeVisible()
    expect(await page.evaluate(() => window.yuki.client.connections())).toEqual({
      ok: true,
      value: [],
    })
    proxy.faults.offline = false
    await pairUI(page, proxy.base, await rig.code())
    const original = await currentConnection(page)
    const composer = page.getByRole('textbox', {
      name: `和 ${original.name} 說點什麼`,
      exact: true,
    })
    const draft = '接入說明往返後仍保留的草稿'
    await composer.fill(draft)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '連線', exact: true }).click()
    const settingsGuide = guideFor(page)
    await settingsGuide.locator('summary').first().click()
    await captureGuide(app, page, 'settings')
    await contentSize(app, page, 1440, 900)
    await page.getByRole('button', { name: '更改…', exact: true }).click()
    unavailable.faults.offline = true
    const sheet = page.getByRole('dialog', { name: '更改伺服器位址', exact: true })
    await sheet.getByRole('textbox', { name: '新伺服器位址', exact: true }).fill(unavailable.base)
    await sheet.getByRole('button', { name: '確認並連線', exact: true }).click()
    await expect(
      sheet.getByRole('status').filter({ hasText: '伺服器暫時無法接收，尚未寫入。' }),
    ).toBeVisible()
    expect(await currentConnection(page)).toEqual(original)
    await sheet.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(composer).toHaveValue(draft)
    const background = await app.evaluate(
      () =>
        (globalThis as typeof globalThis & { __yukiBackgroundWindows?: unknown })
          .__yukiBackgroundWindows,
    )
    await writeFile(
      test.info().outputPath('tailscale-original-connection.json'),
      JSON.stringify(
        {
          original,
          after: await currentConnection(page),
          draft: await composer.inputValue(),
          copied,
          background,
        },
        null,
        2,
      ) + '\n',
    )
    success = true
  } finally {
    await app.close().catch(() => {})
    await proxy.close()
    await unavailable.close()
    await rig.close(success)
  }
})
