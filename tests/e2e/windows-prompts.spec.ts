import { navigate } from '../fixtures/navigation'
import { expect, test } from '@playwright/test'
import { pairUI } from '../fixtures/backend'
import { crashSoulApp, soulBackend } from '../fixtures/soul-backend'

test('Windows administrators edit the shared SOUL with native keyboard input', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const rig = await soulBackend(),
    app = await rig.launch('windows-owner')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, rig.ownerCode, undefined, 30000)
    await navigate(page, '關於 初始角色')
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'SOUL.md 內容', exact: true })
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('Windows {{name}}')
    await page.keyboard.press('Control+S')
    await expect(page.getByRole('status')).toContainText('已儲存')
    await page.screenshot({ path: test.info().outputPath('windows-soul-saved.png') })
    success = true
  } finally {
    await crashSoulApp(app)
    await rig.close(success)
  }
})
