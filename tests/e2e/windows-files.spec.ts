import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchShell } from '../fixtures/shell-app'
import { pairUI, yukiFixture } from '../fixtures/backend'
import { completeWindowsFileDialog, windowsFileDialogOwner } from '../fixtures/windows-file-dialog'

test('Windows native diagnostics export uses the real file dialog and excludes paired conversation data', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  test.setTimeout(120000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  const rig = await yukiFixture(),
    base = rig.base,
    code = await rig.code(),
    data = rig.root
  const app = await launchShell(join(data, 'profile'))
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, base!, code, '原生檔案驗證', 20000)
    const composer = page.getByRole('textbox', { name: /^和 .+ 說點什麼$/ })
    const message = `診斷應省略的訊息-${randomUUID()}`
    const draft = `診斷應省略的草稿-${randomUUID()}`
    await composer.fill(message)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText('Desktop reference reply', { exact: true }).last()).toBeVisible()
    await composer.fill(draft)
    const connections = await page.evaluate(() => window.yuki.client.connections())
    if (!connections.ok) throw Error(connections.code)
    const connection = connections.value[0]!
    const runtime = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged,
      platform: process.platform,
      electron: process.versions.electron,
      sandboxed: app
        .getAppMetrics()
        .find(
          (entry) => entry.pid === BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
        )?.sandboxed,
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    }))
    expect(runtime).toMatchObject({
      packaged: true,
      platform: 'win32',
      sandboxed: true,
      noSandbox: false,
    })
    const destination = join(data, '原生診斷.json')
    await page.keyboard.press('Control+,')
    const sidebar = page.getByRole('navigation', { name: '主要導覽', exact: true })
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByRole('button', { name: '設定', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      (await page.getByRole('tablist', { name: '設定分類', exact: true }).boundingBox())!.width,
    ).toBe(200)
    await expect(page.getByRole('complementary', { name: '檢視器', exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: '進階', exact: true }).click()
    const nativeOwner = await windowsFileDialogOwner(app)
    await page.getByRole('button', { name: '匯出…', exact: true }).click()
    const receipt = await completeWindowsFileDialog(nativeOwner, destination, 'save')
    expect(receipt).toMatchObject({
      Action: 'save',
      DialogClass: '#32770',
      FilenameControl: 1001,
      DefaultButton: 1,
      Method: 'native-win32-controls',
    })
    expect(receipt.SessionId).toBeGreaterThan(0)
    await expect(page.getByText('診斷記錄已匯出。', { exact: true })).toBeVisible()
    const exported = await readFile(destination, 'utf8')
    const diagnostic = JSON.parse(exported) as {
      application: { platform: string; electron: string }
      local: { connections: number; messages: Record<string, number> }
    }
    expect(Object.keys(diagnostic).sort()).toEqual([
      'application',
      'created_at',
      'local',
      'preferences',
      'required_api_revision',
      'schema_version',
    ])
    expect(diagnostic.application).toMatchObject({ platform: 'win32', electron: runtime.electron })
    expect(diagnostic.local.connections).toBe(1)
    expect(
      Object.values(diagnostic.local.messages).reduce((sum, count) => sum + count, 0),
    ).toBeGreaterThan(0)
    for (const secret of [
      message,
      draft,
      code,
      base!,
      data,
      destination,
      connection.characterId,
      connection.personId,
    ])
      expect(exported.includes(secret)).toBe(false)
    expect(exported).not.toMatch(/Bearer |client_token|encrypted_key|os_crypt/)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(composer).toHaveValue(draft)
    await writeFile(
      test.info().outputPath('windows-native-diagnostics.json'),
      JSON.stringify({ receipt, runtime, diagnostic }, null, 2) + '\n',
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
