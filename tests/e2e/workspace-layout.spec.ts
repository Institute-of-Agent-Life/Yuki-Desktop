import { activeCharacterName } from '../fixtures/active-character'
import { expect, test, type Page } from '@playwright/test'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { captureWorkspace, contentSize } from '../fixtures/visual'

const inspector = (page: Page) => page.getByRole('complementary', { name: '檢視器', exact: true })
const tabs = (page: Page) => inspector(page).getByRole('tablist', { name: '檢視器內容' })
const toolbar = (page: Page) => page.locator('[data-region="toolbar"]')

test(
  'inspector segments preserve original work drafts and immutable file selections alongside shared computer controls',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(240000)
    const rig = await yukiFixture({ computer: true, character: true }),
      app = await rig.launch('inspector-segments')
    let success = false
    try {
      const page = await app.firstWindow(),
        errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await pairUI(page, rig.base, await rig.code())
      await contentSize(app, page, 1440, 900)
      await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
      await page
        .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` })
        .fill('請建立原工作整合測試')
      await page.getByRole('button', { name: '送出', exact: true }).click()
      const card = page.getByRole('article').filter({
        has: page.getByRole('heading', { name: '原工作整合測試', exact: true }),
      })
      await expect(card.getByText('等你回覆', { exact: true })).toBeVisible({ timeout: 20000 })
      await card.getByRole('button', { name: '查看詳情', exact: true }).click()
      await expect(tabs(page).getByRole('tab', { name: '工作', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      const draft = '原工作尚未送出的城市補充：台北'
      await inspector(page).getByRole('textbox').fill(draft)
      await tabs(page).getByRole('tab', { name: '工作', exact: true }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(tabs(page).getByRole('tab', { name: '電腦', exact: true })).toBeFocused()
      await expect(
        inspector(page).getByRole('button', { name: '儲存目前內容', exact: true }),
      ).toBeVisible()
      await page.keyboard.press('ArrowRight')
      await expect(tabs(page).getByRole('tab', { name: '檔案', exact: true })).toBeFocused()
      await expect(inspector(page).getByRole('heading', { name: '尚未選取檔案' })).toBeVisible()
      const response = await fetch(`${rig.base}/__test/artifacts`, { method: 'POST' })
      expect(response.status).toBe(200)
      const artifacts = (await response.json()) as { artifact_id: string }[]
      await inspector(page).getByRole('button', { name: '開啟檔案與成果', exact: true }).click()
      await expect(inspector(page)).toHaveCount(0)
      await page.getByRole('button').filter({ hasText: artifacts[1]!.artifact_id }).click()
      await expect(page.getByRole('region', { name: '成果預覽' })).toContainText(
        'Different immutable content.',
      )
      await page.keyboard.press('ControlOrMeta+1')
      await toolbar(page).getByRole('button', { name: '檢視器', exact: true }).click()
      await expect(tabs(page).getByRole('tab', { name: '檔案', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await expect(inspector(page)).toContainText('Different immutable content.')
      await tabs(page).getByRole('tab', { name: '工作', exact: true }).click()
      await expect(inspector(page).getByRole('textbox')).toHaveValue(draft)
      await expect(
        inspector(page).getByRole('heading', { name: '原工作整合測試', exact: true }),
      ).toBeVisible()
      await captureWorkspace(
        app,
        page,
        'inspector-work',
        async () => {
          await page.keyboard.press('ControlOrMeta+1')
          if (!(await inspector(page).count()))
            await toolbar(page).getByRole('button', { name: '檢視器', exact: true }).click()
          await tabs(page).getByRole('tab', { name: '工作', exact: true }).click()
          await expect(inspector(page).getByRole('textbox')).toHaveValue(draft)
        },
        {
          verify: async () => {
            await expect(tabs(page)).toBeInViewport({ ratio: 1 })
            await expect(inspector(page).getByRole('textbox')).toHaveValue(draft)
          },
        },
      )
      await contentSize(app, page, 1440, 900)
      await captureWorkspace(
        app,
        page,
        'inspector-computer',
        async () => {
          if (!(await inspector(page).count()))
            await toolbar(page).getByRole('button', { name: '檢視器', exact: true }).click()
          await tabs(page).getByRole('tab', { name: '電腦', exact: true }).click()
          await expect(
            inspector(page).getByRole('button', { name: '儲存目前內容', exact: true }),
          ).toBeVisible()
        },
        {
          verify: async () => {
            await expect(tabs(page)).toBeInViewport({ ratio: 1 })
            await expect(inspector(page).getByRole('img', { name: '遠端電腦預覽' })).toBeInViewport(
              {
                ratio: 1,
              },
            )
            await expect(
              inspector(page).getByRole('button', { name: '開啟完整畫面', exact: true }),
            ).toBeInViewport({ ratio: 1 })
          },
        },
      )
      await contentSize(app, page, 1440, 900)
      await tabs(page).getByRole('tab', { name: '工作', exact: true }).click()
      await expect(inspector(page).getByRole('textbox')).toHaveValue(draft)
      await tabs(page).getByRole('tab', { name: '檔案', exact: true }).click()
      await expect(inspector(page)).toContainText('Different immutable content.')
      expect(errors).toEqual([])
      success = true
    } finally {
      await app.close()
      await rig.close(success)
    }
  },
)

test('only visible columns resize and actual close paths leave the expanded stage and restore focus', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('inspector-layout')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await contentSize(app, page, 1440, 900)
    const sidebar = page.getByRole('separator', { name: '調整側邊欄', exact: true }),
      divider = page.getByRole('separator', { name: '調整檢視器', exact: true }),
      sidebarButton = toolbar(page).getByRole('button', { name: '側邊欄', exact: true }),
      inspectorButton = toolbar(page).getByRole('button', { name: '檢視器', exact: true })
    await expect(sidebar).toHaveAttribute('aria-valuenow', '260')
    await sidebarButton.click()
    await expect(sidebar).toHaveCount(0)
    await sidebarButton.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('ArrowRight')
    await sidebarButton.click()
    await expect(sidebar).toHaveAttribute('aria-valuenow', '260')
    await inspectorButton.click()
    await expect(divider).toHaveAttribute('aria-valuenow', '380')
    await contentSize(app, page, 960, 492)
    await expect(sidebar).toHaveCount(0)
    await expect(divider).toHaveCount(0)
    await sidebarButton.click()
    await expect(page.getByRole('navigation', { name: '主要導覽' })).toBeVisible()
    await expect(sidebar).toHaveCount(0)
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼` })
      .click()
    await expect(inspector(page)).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '主要導覽' })).not.toBeVisible()
    await inspectorButton.click()
    await expect(inspector(page)).toBeVisible()
    await expect(divider).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(inspectorButton).toBeFocused()
    await contentSize(app, page, 1180, 800)
    await inspectorButton.click()
    for (const handle of [sidebar, divider]) {
      const bounds = await handle.boundingBox()
      expect(bounds).not.toBeNull()
      await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 240)
      await page.mouse.down()
      await page.mouse.move(bounds!.x + (handle === sidebar ? 800 : -800), bounds!.y + 240, {
        steps: 8,
      })
      await page.mouse.up()
      expect(
        (await page.locator('[data-region="content"]').boundingBox())!.width,
      ).toBeGreaterThanOrEqual(520)
    }
    await contentSize(app, page, 1440, 900)
    await sidebar.dblclick()
    await divider.dblclick()
    await expect(sidebar).toHaveAttribute('aria-valuenow', '260')
    await expect(divider).toHaveAttribute('aria-valuenow', '380')
    for (const close of ['button', 'escape', 'shortcut'] as const) {
      await toolbar(page).getByRole('button', { name: '展開工作區', exact: true }).click()
      await expect(sidebar).toHaveCount(0)
      await expect(divider).toHaveCount(0)
      await expect(page.getByRole('button', { name: '收合工作區', exact: true })).toBeVisible()
      if (close === 'button')
        await inspector(page).getByRole('button', { name: '關閉檢視器' }).click()
      else if (close === 'escape') await page.keyboard.press('Escape')
      else await page.keyboard.press(process.platform === 'darwin' ? 'Alt+Meta+i' : 'Control+Alt+i')
      await expect(inspector(page)).toHaveCount(0)
      await expect(page.getByRole('button', { name: '收合工作區', exact: true })).toHaveCount(0)
      await expect(inspectorButton).toBeFocused()
      await expect(sidebar).toHaveAttribute('aria-valuenow', '260')
    }
    await toolbar(page).getByRole('button', { name: '展開工作區', exact: true }).click()
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: '指令面板', exact: true })
    await palette.getByRole('combobox').fill('開合側邊欄')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('navigation', { name: '主要導覽' })).toBeVisible()
    await expect(page.getByRole('button', { name: '收合工作區', exact: true })).toHaveCount(0)
    await toolbar(page).getByRole('button', { name: '展開工作區', exact: true }).click()
    await sidebarButton.click()
    await expect(page.getByRole('navigation', { name: '主要導覽' })).toBeVisible()
    await expect(page.getByRole('button', { name: '收合工作區', exact: true })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('visible-columns.png') })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
