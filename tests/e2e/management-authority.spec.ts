import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Me, Profile } from '../../src/shared/api'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { activeCharacterName } from '../fixtures/active-character'
import { navigate } from '../fixtures/navigation'

test('a paired ordinary person keeps personal tools while shared management is read only', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ character: true, prompts: true }),
    app = await rig.launch('ordinary-person')
  let success = false
  try {
    const page = await app.firstWindow(),
      identity = await rig.state()
    await pairUI(page, rig.base, identity.nonowner_pairing_code)
    const connection = await currentConnection(page)
    await navigate(page, `關於 ${await activeCharacterName(page)}`)
    const me = await page.evaluate(
      (id) => window.yuki.client.read<Me>(id, { kind: 'me' }),
      connection.characterId,
    )
    const facts = {
      personId: connection.personId,
      originalPersonId: identity.nonowner_person_id,
      me,
      editNameVisible: await page.getByRole('button', { name: '編輯名稱與簡介' }).isVisible(),
      editAvatarVisible: await page.getByRole('button', { name: '更換頭像', exact: true }).count(),
      editSoulVisible: await page.getByRole('button', { name: '編輯提示詞' }).isVisible(),
    }
    await writeFile(
      test.info().outputPath('ordinary-authority.json'),
      JSON.stringify(facts, null, 2),
    )
    await page.screenshot({ path: test.info().outputPath('ordinary-authority.png') })
    expect(facts.personId).toBe(facts.originalPersonId)
    expect(facts.editNameVisible).toBe(false)
    expect(facts.editAvatarVisible).toBe(0)
    expect(facts.editSoulVisible).toBe(false)
    expect(me.ok && me.value).toMatchObject({ is_superuser: false })
    await expect(page.getByText('只有 Yuki 的管理員可以修改', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: '安排', exact: true }).click()
    await expect(page.getByRole('tab', { name: '你的安排', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: '她的安排', exact: true }).click()
    await expect(
      page.getByText('只有 Yuki 的管理員可以查看她的安排', { exact: true }),
    ).toBeVisible()
    const soul = await page.evaluate(
      (id) => window.yuki.client.soulDocument(id),
      connection.characterId,
    )
    expect(soul.ok).toBe(false)
    await navigate(page, `${await activeCharacterName(page)} 的電腦`)
    await expect(
      page.getByText('只有 Yuki 的管理員可以使用這個共享電腦', { exact: true }),
    ).toBeVisible()
    await navigate(page, '這台電腦')
    await expect(page.getByRole('button', { name: '前往設定', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '這台電腦', exact: true }).click()
    await expect(page.getByText(/讓 .* 使用這台電腦的命令、檔案與已安裝程式/)).toBeVisible()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await navigate(page, '桌面對話')
    await expect(page.getByRole('textbox', { name: /說點什麼$/ })).toBeVisible()
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('an existing administrator manages shared name avatar and SOUL on first login from two devices', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ character: true, prompts: true }),
    first = await rig.launch('administrator-first'),
    second = await rig.launch('administrator-second')
  let success = false
  try {
    const a = await first.firstWindow(),
      b = await second.firstWindow()
    await pairUI(a, rig.base, await rig.code())
    await pairUI(b, rig.base, await rig.code())
    const original = await currentConnection(a),
      samePerson = await currentConnection(b)
    expect(original.personId).toBe((await rig.state()).owner_person_id)
    expect(samePerson.personId).toBe(original.personId)
    expect(samePerson.deviceId).not.toBe(original.deviceId)
    await navigate(a, /^關於 /)
    await navigate(b, /^關於 /)
    await a.getByRole('button', { name: '編輯名稱與簡介', exact: true }).click()
    await a.getByLabel('名稱', { exact: true }).fill('管理員既有 Yuki')
    await a.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(b.getByRole('heading', { name: '管理員既有 Yuki', exact: true })).toBeVisible()
    await a.locator('header').getByRole('button', { name: '更換頭像', exact: true }).click()
    await first.evaluate(
      ({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      },
      join(process.cwd(), 'tests/fixtures/avatar-white.png'),
    )
    const avatar = a.getByRole('dialog', { name: '更換 管理員既有 Yuki 的頭像', exact: true })
    await avatar.getByRole('button', { name: '選擇圖片…', exact: true }).click()
    await avatar.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(avatar).toHaveCount(0)
    await a.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    await a.getByRole('textbox', { name: 'SOUL.md 內容', exact: true }).fill('既有管理員的原始人格')
    await a.keyboard.press('ControlOrMeta+S')
    await expect
      .poll(() => readFile(join(rig.root, 'character/SOUL.md'), 'utf8'))
      .toBe('既有管理員的原始人格')
    await b.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    await expect(b.getByRole('textbox', { name: 'SOUL.md 內容' })).toContainText(
      '既有管理員的原始人格',
    )
    const facts = await a.evaluate(
      async (id) => ({
        me: await window.yuki.client.read<Me>(id, { kind: 'me' }),
        profile: await window.yuki.client.read<Profile>(id, { kind: 'character' }),
        commands: await window.yuki.client.characterCommands(id),
      }),
      original.characterId,
    )
    expect(facts.me.ok && facts.me.value).toMatchObject({ is_superuser: true })
    expect(facts.profile.ok && facts.profile.value.avatar_revision).toBeGreaterThan(0)
    expect(await currentConnection(a)).toMatchObject({
      personId: original.personId,
      deviceId: original.deviceId,
      bindingId: original.bindingId,
      conversationId: original.conversationId,
    })
    await writeFile(
      test.info().outputPath('administrator-first-login.json'),
      JSON.stringify(
        {
          original,
          samePerson,
          facts,
        },
        null,
        2,
      ),
    )
    await a.screenshot({ path: test.info().outputPath('administrator-soul.png') })
    await b.screenshot({ path: test.info().outputPath('administrator-second-device.png') })
    success = true
  } finally {
    await first.close()
    await second.close()
    await rig.close(success)
  }
})

test('revoking administrator authority hides the open SOUL without blocking the original chat', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ character: true, prompts: true }),
    app = await rig.launch('revoked-administrator')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const original = await currentConnection(page)
    await navigate(page, /^關於 /)
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'SOUL.md 內容', exact: true })
    await editor.fill('撤權後不能繼續顯示的管理草稿')
    const revoked = await fetch(`${rig.base}/__test/superuser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: original.personId, enabled: false }),
    })
    expect(revoked.ok).toBe(true)
    await expect(editor).toHaveCount(0)
    await expect(page.getByText('只有 Yuki 的管理員可以修改', { exact: true })).toBeVisible()
    const denied = await page.evaluate(
      (id) => window.yuki.client.soulDocument(id),
      original.characterId,
    )
    expect(denied.ok).toBe(false)
    await navigate(page, '桌面對話')
    await page.getByRole('textbox', { name: /說點什麼$/ }).fill('原人物的聊天草稿仍可繼續')
    const current = await currentConnection(page)
    expect(current).toEqual(original)
    await writeFile(
      test.info().outputPath('administrator-revoked.json'),
      JSON.stringify(
        {
          original,
          current,
          denied,
        },
        null,
        2,
      ),
    )
    await page.screenshot({ path: test.info().outputPath('administrator-revoked-chat.png') })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})
