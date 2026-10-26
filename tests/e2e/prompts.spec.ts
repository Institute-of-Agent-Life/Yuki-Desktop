import { navigate } from '../fixtures/navigation'
import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { currentConnection, pairUI } from '../fixtures/backend'
import { crashSoulApp, soulBackend } from '../fixtures/soul-backend'

test('single SOUL saves empty text and preserves a raw draft after process reopening', async () => {
  test.setTimeout(120000)
  const rig = await soulBackend()
  let app = await rig.launch('owner')
  let success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, rig.base, rig.ownerCode, undefined, 30000)
    await navigate(page, '關於 初始角色')
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    let editor = page.getByRole('textbox', { name: 'SOUL.md 內容', exact: true })
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('ControlOrMeta+S')
    await expect.poll(() => readFile(join(rig.root, 'character/SOUL.md'), 'utf8')).toBe('')
    await editor.fill('未送出的原始草稿 {{name}}')
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const all = await window.yuki.client.connections()
          if (!all.ok) throw Error(all.code)
          const draft = await window.yuki.client.soulDraft(all.value[0]!.characterId)
          return draft.ok ? draft.value?.draft : null
        }),
      )
      .toBe('未送出的原始草稿 {{name}}')
    await crashSoulApp(app)
    app = await rig.launch('owner')
    page = await app.firstWindow()
    await navigate(page, '關於 初始角色')
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '恢復未儲存的草稿？' })).toBeVisible()
    await page.getByRole('button', { name: '恢復草稿', exact: true }).click()
    editor = page.getByRole('textbox', { name: 'SOUL.md 內容', exact: true })
    await expect(editor).toContainText('未送出的原始草稿 {{name}}')
    await page.screenshot({ path: test.info().outputPath('soul-draft-recovered.png') })
    success = true
  } catch (error) {
    const page = await app.firstWindow()
    console.error(await page.locator('body').innerText())
    await page.screenshot({ path: test.info().outputPath('soul-failure.png') })
    throw error
  } finally {
    await crashSoulApp(app)
    await rig.close(success)
  }
})

test('another paired person updates the name and SOUL, preserves conflicts and keeps editing after the original device is revoked', async () => {
  test.setTimeout(120000)
  const rig = await soulBackend(),
    app = await rig.launch('owner')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, rig.ownerCode, undefined, 30000)
    const connection = await currentConnection(page)
    await navigate(page, '關於 初始角色')
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'SOUL.md 內容', exact: true })
    await editor.fill('local private draft')
    const paired = await fetch(rig.base + '/client/v1/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: rig.nonownerCode, device_label: 'second real device' }),
      }),
      token = (await paired.json()).data.token,
      headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      profile = (await (await fetch(rig.base + '/client/v1/character', { headers })).json()).data,
      remote = (await (await fetch(rig.base + '/client/v1/character/soul', { headers })).json())
        .data
    const renamed = await fetch(rig.base + '/client/v1/character', {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        request_id: randomUUID(),
        expected_revision: profile.revision,
        display_name: 'Renamed',
      }),
    })
    expect(renamed.status).toBe(200)
    await expect(
      page.getByRole('button', { name: '關於 Renamed', exact: true }).first(),
    ).toBeVisible()
    const saved = await fetch(rig.base + '/client/v1/character/soul', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        request_id: randomUUID(),
        expected_revision: remote.revision,
        content: 'remote private original',
      }),
    })
    expect(saved.status).toBe(200)
    await expect(page.getByText('另一台裝置儲存了新版本。你的草稿基於較早的版本。')).toBeVisible()
    await expect(editor).toContainText('local private draft')
    await page.getByRole('button', { name: '儲存', exact: false }).click()
    await expect(
      page
        .getByText('儲存未完成：伺服器版本已改變，請先處理差異', { exact: true })
        .filter({ visible: true }),
    ).toBeVisible()
    expect(await readFile(join(rig.root, 'character/SOUL.md'), 'utf8')).toBe(
      'remote private original',
    )
    const revoked = await fetch(rig.base + '/__test/revoke-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: connection.deviceId }),
    })
    expect(revoked.status).toBe(200)
    expect(await revoked.json()).toMatchObject({ device_id: connection.deviceId, revoked: true })
    const denied = await page.evaluate(async (id) => {
      const result = await window.yuki.client.soulDocument(id)
      return result.ok ? 'unexpected-success' : result.code
    }, connection.characterId)
    expect(denied).toBe('unauthenticated')
    await expect(editor).not.toBeVisible()
    await expect(page.getByRole('button', { name: '編輯提示詞', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '編輯角色資料', exact: true })).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('local private draft')
    const remaining = await fetch(rig.base + '/client/v1/character/soul', { headers })
    expect(remaining.status).toBe(200)
    const remainingDocument = (await remaining.json()).data
    const afterRevocation = await fetch(rig.base + '/client/v1/character/soul', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        request_id: randomUUID(),
        expected_revision: remainingDocument.revision,
        content: 'remaining paired person can still edit',
      }),
    })
    expect(afterRevocation.status).toBe(200)
    expect(await readFile(join(rig.root, 'character/SOUL.md'), 'utf8')).toBe(
      'remaining paired person can still edit',
    )
    await page.screenshot({ path: test.info().outputPath('soul-device-revoked.png') })
    success = true
  } finally {
    await crashSoulApp(app)
    await rig.close(success)
  }
})
