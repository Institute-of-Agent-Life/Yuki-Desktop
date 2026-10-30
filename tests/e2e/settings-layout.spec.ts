import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { activeCharacterName } from '../fixtures/active-character'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { captureViewport, contentSize, workspaceSizes } from '../fixtures/visual'

test('settings have one navigation column and keep the selected category across actual Yuki switches', async () => {
  test.setTimeout(180000)
  const first = await yukiFixture({ character: true }),
    second = await yukiFixture({ character: true }),
    app = await first.launch('settings-layout')
  let success = false
  const layouts: unknown[] = []
  try {
    const page = await app.firstWindow()
    await pairUI(page, first.base, await first.code())
    const firstConnection = await currentConnection(page)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '所有 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '連接…', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    await page.keyboard.press('ControlOrMeta+5')
    await page.getByRole('button', { name: '編輯名稱與簡介', exact: true }).click()
    const secondName = '第二個 Yuki'
    await page.getByRole('textbox', { name: '名稱', exact: true }).fill(secondName)
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByRole('heading', { name: secondName, exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const reducedMotion = page.getByRole('switch', { name: '減少動態', exact: true })
    if ((await reducedMotion.getAttribute('aria-checked')) !== 'true') await reducedMotion.click()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const categories = [
      ['general', '一般'],
      ['look', '外觀'],
      ['notify', '通知'],
      ['updates', '更新'],
      ['connection', '連線'],
      ['devices', '裝置'],
      ['computer', '這台電腦'],
      ['yukis', '所有 Yuki'],
      ['advanced', '進階'],
    ] as const
    for (const [width, height] of workspaceSizes) {
      const viewportMethod = await contentSize(app, page, width, height)
      await page.keyboard.press('ControlOrMeta+,')
      const tabs = page.getByRole('tablist', { name: '設定分類', exact: true })
      await expect(tabs).toBeVisible()
      await expect(page.getByRole('navigation', { name: '主要導覽', exact: true })).toBeHidden()
      await expect(page.locator('section[aria-label="設定"] > header > strong')).toHaveText('設定')
      await expect(tabs.getByRole('tab')).toHaveText(categories.map(([, label]) => label))
      for (const [id, label] of categories) {
        const selected = tabs.getByRole('tab', { name: label, exact: true })
        await selected.click()
        await expect(selected).toHaveAttribute('aria-selected', 'true')
        const heading = page.getByRole('heading', {
          name: id === 'connection' ? `${secondName} 的連線` : label,
          exact: true,
        })
        await expect(heading).toBeVisible()
        await writeFile(
          test.info().outputPath(`settings-${id}-${width}x${height}.layout.json`),
          JSON.stringify(
            await heading.evaluate((element) => {
              const { x, y, width, height } = element.getBoundingClientRect()
              return {
                heading: { x, y, width, height },
                paneScrollTop: document.getElementById('settings-panel')!.scrollTop,
                viewport: { width: innerWidth, height: innerHeight },
              }
            }),
          ),
        )
        await expect(heading).toBeInViewport()
        await expect
          .poll(() =>
            tabs.evaluate((nav) => {
              const pill = nav
                .querySelector(':scope > span[aria-hidden="true"]')!
                .getBoundingClientRect()
              const tab = nav
                .querySelector('[role="tab"][aria-selected="true"]')!
                .getBoundingClientRect()
              return Math.max(
                Math.abs(pill.x - tab.x),
                Math.abs(pill.y - tab.y),
                Math.abs(pill.width - tab.width),
                Math.abs(pill.height - tab.height),
              )
            }),
          )
          .toBeLessThanOrEqual(1)
        await captureViewport(
          app,
          page,
          test.info().outputPath(`settings-${id}-${width}x${height}.png`),
        )
      }
      layouts.push({
        requested: { width, height },
        viewportMethod,
        ...(await tabs.evaluate((nav) => ({
          tabs: [...nav.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => ({
            id: tab.id,
            text: tab.textContent?.trim(),
            group: tab.parentElement?.querySelector('div')?.textContent?.trim() ?? '',
          })),
          pane: (() => {
            const box = document.getElementById('settings-panel')!.getBoundingClientRect()
            return { x: box.x, y: box.y, width: box.width, height: box.height }
          })(),
        }))),
      })
      await page.getByRole('button', { name: '返回', exact: true }).click()
    }
    await page.keyboard.press('ControlOrMeta+,')
    const connectionTab = page.getByRole('tab', { name: '連線', exact: true })
    await connectionTab.click()
    await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
    await page.getByRole('menuitemradio').filter({ hasText: firstConnection.name }).click()
    await expect(page.getByRole('tablist', { name: '設定分類', exact: true })).toBeVisible()
    await expect(connectionTab).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('heading', { name: `${firstConnection.name} 的連線`, exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '切換 Yuki', exact: true }).click()
    await page.getByRole('menuitemradio').filter({ hasText: secondName }).click()
    await expect(connectionTab).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.getByRole('heading', { name: `${secondName} 的連線`, exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.keyboard.press('ControlOrMeta+,')
    await expect(connectionTab).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.keyboard.press('ControlOrMeta+1')
    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
      exact: true,
    })
    const draft = '切換分類與全窗口設定後仍保留的草稿'
    await composer.fill(draft)
    await page.keyboard.press('ControlOrMeta+,')
    await expect(connectionTab).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(composer).toHaveValue(draft)
    await writeFile(
      test.info().outputPath('settings-layout.json'),
      JSON.stringify(
        {
          layouts,
          switches: [firstConnection.name, secondName],
          retainedCategory: 'connection',
          draft,
        },
        null,
        2,
      ),
    )
    success = true
  } finally {
    await app.close().catch(() => {})
    await Promise.all([first.close(success), second.close(success)])
  }
})
