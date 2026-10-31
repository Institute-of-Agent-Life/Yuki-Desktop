import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { activeCharacterName } from '../fixtures/active-character'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { sidebar } from '../fixtures/navigation'
import { captureViewport, contentSize, workspaceSizes } from '../fixtures/visual'

test('settings have one navigation column and keep the selected category across actual Yuki switches', async () => {
  test.setTimeout(180000)
  const first = await yukiFixture({ character: true, modelConfiguration: true }),
    second = await yukiFixture({ character: true, modelConfiguration: true }),
    app = await first.launch('settings-layout')
  let success = false
  const layouts: unknown[] = []
  const sidebars: unknown[] = []
  try {
    const page = await app.firstWindow()
    await pairUI(page, first.base, await first.code())
    const firstConnection = await currentConnection(page)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    const reducedMotion = page.getByRole('switch', { name: '減少動態', exact: true })
    if ((await reducedMotion.getAttribute('aria-checked')) !== 'true') await reducedMotion.click()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    const captureSidebars = async (kind: 'single' | 'dual', name: string) => {
      for (const [width, height] of workspaceSizes) {
        const viewportMethod = await contentSize(app, page, width, height)
        const navigation = await sidebar(page)
        const trigger = navigation.getByRole('button', { name: '切換 Yuki', exact: true })
        await expect(trigger).toHaveAccessibleDescription(new RegExp(name))
        await expect(navigation.getByText('對話', { exact: true })).toBeVisible()
        await expect(navigation.getByText('工作區', { exact: true })).toBeVisible()
        await expect(navigation.locator('button:not([aria-haspopup])')).toHaveText([
          '桌面對話',
          '工作',
          '檔案與成果',
          `${name} 的電腦`,
          '這台電腦',
          `關於 ${name}`,
          '設定',
        ])
        const observed = await navigation.evaluate((nav) => {
          const trigger = nav.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
          const description = document.getElementById(trigger.getAttribute('aria-describedby')!)!
          return {
            buttons: [...nav.querySelectorAll<HTMLButtonElement>('button')].map((button) => ({
              name: button.getAttribute('aria-label') ?? button.textContent?.trim(),
              current: button.getAttribute('aria-current'),
            })),
            groups: [...nav.children]
              .filter((element) => String(element.className).includes('group'))
              .map((element) => element.textContent?.trim()),
            trigger: {
              name: description.querySelector('strong')!.textContent,
              status: description.querySelector('small')!.textContent,
            },
          }
        })
        expect(observed.trigger).toEqual({ name, status: expect.stringMatching(/\S/) })
        await captureViewport(
          app,
          page,
          test.info().outputPath(`sidebar-${kind}-${width}x${height}.png`),
        )
        sidebars.push({ kind, requested: { width, height }, viewportMethod, ...observed })
        await page.keyboard.press('Escape')
      }
    }
    await captureSidebars('single', firstConnection.name)
    await (await sidebar(page)).getByRole('button', { name: '切換 Yuki', exact: true }).click()
    const singleMenu = page.getByRole('menu', { name: 'Yuki', exact: true })
    await expect(singleMenu.getByRole('menuitemradio')).toHaveCount(1)
    await singleMenu.getByRole('menuitem', { name: '連接另一個 Yuki', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    const secondConnection = await currentConnection(page)
    expect(secondConnection.characterId).not.toBe(firstConnection.characterId)
    expect(secondConnection.baseUrl).toBe(second.base)
    await (await sidebar(page)).getByRole('button', { name: '切換 Yuki', exact: true }).click()
    await page
      .getByRole('menu', { name: 'Yuki', exact: true })
      .getByRole('menuitem', { name: `關於 ${secondConnection.name}`, exact: true })
      .click()
    await page.getByRole('button', { name: '編輯名稱與簡介', exact: true }).click()
    const secondName = '第二個 Yuki'
    await page.getByRole('textbox', { name: '名稱', exact: true }).fill(secondName)
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByRole('heading', { name: secondName, exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+1')
    await captureSidebars('dual', secondName)
    const categories = [
      ['general', '一般'],
      ['look', '外觀'],
      ['notify', '通知'],
      ['updates', '更新'],
      ['connection', '連線'],
      ['models', '模型'],
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
          sidebars,
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
