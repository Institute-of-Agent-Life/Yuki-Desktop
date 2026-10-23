import { expect, test } from '@playwright/test'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { captureWorkspace, contentSize } from '../fixtures/visual'

test('current workspace renders long original messages and immutable file content across themes', async () => {
  test.setTimeout(180000)
  const rig = await yukiFixture(),
    app = await rig.launch('workspace-content')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    const longText = '# 長文字與中英混排\n\n' + '中英混排 retains its original source. '.repeat(90)
    await composer.fill(longText)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true }).last()).toBeVisible()
    const draft = '切換主題與檔案仍保留的未送出草稿'
    await composer.fill(draft)
    await captureWorkspace(app, page, 'current-chat-longtext', async () => {
      await page.keyboard.press('ControlOrMeta+1')
      await expect(
        page.getByRole('heading', { name: '長文字與中英混排', exact: true }),
      ).toBeVisible()
      await expect(composer).toHaveValue(draft)
    })
    await contentSize(app, page, 1440, 900)
    await page
      .getByRole('button', { name: /desktop-reference.txt/ })
      .first()
      .click()
    const detail = page.getByRole('complementary', { name: '檢視器', exact: true })
    await expect(detail).toContainText('Desktop reference artifact')
    const source = await rig.state()
    await expect(detail).toContainText(source.artifact_id)
    await expect(detail.getByRole('button', { name: '存到…', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: '電腦', exact: true })).toHaveCount(0)
    await expect(composer).toHaveValue(draft)
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
