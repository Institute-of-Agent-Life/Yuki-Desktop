import { navigate } from '../fixtures/navigation'
import { activeCharacterName } from '../fixtures/active-character'
import { contentSize } from '../fixtures/visual'
import { expect, test, type Page } from '@playwright/test'
import { join } from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { Connection } from '../../src/shared/api'
import { ledgerEvents, pairUI } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'
import { windowsFileDialogOwner, completeWindowsFileDialog } from '../fixtures/windows-file-dialog'

async function connections(page: Page) {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok) throw Error(result.code)
    return result.value
  })
}
async function localState(page: Page, role: Connection) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.executorState(id)
    if (!result.ok) throw Error(result.code)
    return result.value
  }, role.characterId)
}
async function localSettings(page: Page) {
  await page.keyboard.press('Control+,')
  await page.getByRole('tab', { name: '本機連接', exact: true }).click()
}

async function add(page: Page) {
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByRole('tab', { name: '伺服器與角色', exact: true }).click()
  await page.getByRole('button', { name: '加入另一個角色', exact: true }).click()
  await expect(page.getByLabel('配對連結、綁定碼或完整回覆', { exact: true })).toBeVisible()
}
async function switchRole(page: Page, name: string) {
  await page.getByRole('button', { name: '切換角色', exact: true }).click()
  await page.getByRole('menuitemradio', { name: new RegExp(name) }).click()
}

test('Windows native roles keep original chats, prompt and avatar drafts, grants and cold credentials isolated', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const bases = [
    process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL,
    process.env.YUKI_DESKTOP_NATIVE_SECOND_BACKEND_URL,
  ].map((value) => value?.replace(/\/+$/, ''))
  test.skip(
    bases.some((base) => !base),
    'Requires two fresh independent reference servers with character, prompt and executor fixtures',
  )
  test.setTimeout(240000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(bases[0]).not.toBe(bases[1])
  for (const base of bases)
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-roles-'))
  const code = async (index: number) => {
    const result = await fetch(bases[index] + '/__test/link-code', { method: 'POST' })
    expect(result.ok).toBe(true)
    return ((await result.json()) as { code: string }).code
  }
  const first = {
    base: bases[0]!,
    code: () => code(0),
    launch: (profile: string) => launchShell(join(data, profile)),
  }
  const second = { base: bases[1]!, code: () => code(1) }
  const marker = randomUUID(),
    firstMessage = `原角色一訊息 ${marker}`,
    secondMessage = `原角色二訊息 ${marker}`
  const send = async (page: Page, text: string) => {
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼`, exact: true })
      .fill(text)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(page.getByText(text, { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(
      page.getByText('Desktop reference reply', { exact: true }).filter({ visible: true }),
    ).toBeVisible()
  }
  let app = await first.launch('multiple-roles')
  let mainPid: number | undefined = await app.evaluate(() => process.pid)
  const cleanupErrors: unknown[] = []
  const proof: Record<string, unknown> = { data, stages: [] }
  const stages = proof.stages as unknown[]
  const save = () =>
    writeFile(
      test.info().outputPath('windows-role-isolation.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  const errors: string[] = []
  let page!: Page
  try {
    page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await pairUI(page, first.base, await first.code(), 'Windows 原角色一', 20000)
    const firstName = await activeCharacterName(page)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '外觀', exact: true }).click()
    await page.getByRole('radio', { name: '淺色', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(page.getByRole('button', { name: '切換角色', exact: true })).toHaveCount(0)
    const native = await app.evaluate(({ app, BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      return {
        pid: process.pid,
        browserPid: app.getAppMetrics().find((item) => item.type === 'Browser')?.pid,
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        executable: app.getPath('exe'),
        sandboxed: app
          .getAppMetrics()
          .find((item) => item.pid === window.webContents.getOSProcessId())?.sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
        scaleFactor: screen.getDisplayMatching(window.getBounds()).scaleFactor,
      }
    })
    expect(native).toMatchObject({
      pid: mainPid,
      browserPid: mainPid,
      platform: 'win32',
      arch: 'x64',
      packaged: true,
      executable: process.env.YUKI_ELECTRON_EXECUTABLE,
      sandboxed: true,
      noSandbox: false,
    })
    proof.native = native
    const firstOwner = (await connections(page))[0]!
    expect(firstOwner.persistentCredentials).toBe(true)
    await send(page, firstMessage)
    await localSettings(page)
    await page
      .getByRole('button', {
        name: `允許 ${await activeCharacterName(page)} 使用這台電腦`,
        exact: true,
      })
      .click()
    await expect.poll(async () => (await localState(page, firstOwner)).state).toBe('online')
    const folder = join(data, 'role-one-inbox')
    await mkdir(folder)
    const folderOwner = await windowsFileDialogOwner(app)
    await page.getByRole('button', { name: '新增資料夾…', exact: true }).click()
    await page
      .getByRole('textbox', { name: '資料夾別名（可選）', exact: true })
      .fill('角色一收件匣')
    await page.getByRole('button', { name: '選擇資料夾…', exact: true }).click()
    const folderReceipt = await completeWindowsFileDialog(folderOwner, folder, 'folder')
    expect(folderReceipt).toMatchObject({
      Action: 'folder',
      ProcessId: mainPid,
      FilenameControl: 1152,
      Method: 'native-win32-controls',
    })
    expect(folderReceipt.SessionId).toBeGreaterThan(0)
    await expect
      .poll(async () =>
        (await localState(page, firstOwner)).installation?.scopes.map((scope) => scope.alias),
      )
      .toEqual(['角色一收件匣'])
    proof.folderReceipt = folderReceipt
    await page.getByRole('button', { name: '返回', exact: true }).click()

    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼`, exact: true })
      .fill('只有第一角色的草稿')
    const separator = page.getByRole('separator', { name: '調整側邊欄' })
    await separator.focus()
    await page.keyboard.press('ArrowRight')
    await expect(separator).toHaveAttribute('aria-valuenow', '264')
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await page
      .getByRole('tablist', { name: '檢視器內容' })
      .getByRole('tab', { name: '檔案', exact: true })
      .click()
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await add(page)
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await add(page)
    await pairUI(page, second.base, await second.code(), 'Windows 原角色二', 20000)
    const owners = await connections(page)
    expect(owners).toHaveLength(2)
    const secondOwner = owners.find((item) => item.characterId !== firstOwner.characterId)!
    expect(secondOwner.baseUrl).toBe(second.base)
    expect(secondOwner.persistentCredentials).toBe(true)
    expect(secondOwner.characterId).not.toBe(firstOwner.characterId)
    await expect(
      page.getByText(firstMessage, { exact: true }).filter({ visible: true }),
    ).toHaveCount(0)
    await send(page, secondMessage)
    proof.owners = owners
    await save()

    await expect(
      page.getByRole('textbox', {
        name: `和 ${await activeCharacterName(page)} 說點什麼`,
        exact: true,
      }),
    ).toHaveValue('')
    await expect(separator).toHaveAttribute('aria-valuenow', '260')
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(
      page
        .getByRole('tablist', { name: '檢視器內容' })
        .getByRole('tab', { name: '工作', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await navigate(page, `關於 ${await activeCharacterName(page)}`)
    await page.getByRole('button', { name: '編輯角色資料', exact: true }).click()
    await page.getByLabel('名稱', { exact: true }).fill('Mika')
    await page.getByLabel('淺色外觀', { exact: true }).fill('#b0466b')
    await page.getByLabel('深色外觀', { exact: true }).fill('#e5a2bc')
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByRole('button', { name: '關於 Mika', exact: true })).toBeVisible()
    await navigate(page, '對話')
    await page
      .getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })
      .fill('只有 Mika 的草稿')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')))
      .toBe('#b0466b')

    await localSettings(page)
    expect((await localState(page, secondOwner)).installation).toBeNull()
    await page.getByRole('button', { name: '允許 Mika 使用這台電腦', exact: true }).click()
    await expect.poll(async () => (await localState(page, secondOwner)).state).toBe('online')
    await page.getByRole('switch', { name: '允許顯示通知', exact: true }).click()
    await page.getByRole('switch', { name: '暫停本機連接', exact: true }).click()
    await expect
      .poll(async () => (await localState(page, secondOwner)).installation?.paused)
      .toBe(true)
    const firstGrant = await localState(page, firstOwner),
      secondGrant = await localState(page, secondOwner)
    expect(firstGrant.installation!.paused).toBe(false)
    expect(firstGrant.installation!.scopes.map((scope) => scope.alias)).toEqual(['角色一收件匣'])
    expect(firstGrant.installation!.consents.some((grant) => grant.capability === 'notify')).toBe(
      false,
    )
    expect(secondGrant.installation!.scopes).toEqual([])
    expect(secondGrant.installation!.consents.some((grant) => grant.capability === 'notify')).toBe(
      true,
    )
    expect(secondGrant.installation!.executorId).not.toBe(firstGrant.installation!.executorId)
    expect(JSON.stringify([firstGrant, secondGrant])).not.toContain(folder)
    stages.push({ stage: 'independent-native-folder-and-consents', firstGrant, secondGrant })
    await save()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await switchRole(page, firstName)
    await expect(
      page.getByRole('textbox', {
        name: `和 ${firstName} 說點什麼`,
        exact: true,
      }),
    ).toHaveValue('只有第一角色的草稿')
    await expect(separator).toHaveAttribute('aria-valuenow', '264')
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(
      page
        .getByRole('tablist', { name: '檢視器內容' })
        .getByRole('tab', { name: '檔案', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue('--accent').toLowerCase(),
        ),
      )
      .toBe('#3a6bd6')
    await page.keyboard.press('ControlOrMeta+Shift+BracketRight')
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await navigate(page, '關於 Mika')
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'SOUL.md 內容', exact: true })
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.insertText('\n只屬於 Mika 的提示詞')
    await page.keyboard.press('ControlOrMeta+Shift+BracketLeft')
    await expect(page.getByRole('dialog', { name: '要儲存變更嗎？' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(editor).toContainText('只屬於 Mika 的提示詞')
    await page.keyboard.press('ControlOrMeta+Shift+BracketLeft')
    await page.getByRole('dialog').getByRole('button', { name: '儲存', exact: true }).click()
    await expect(
      page.getByRole('textbox', {
        name: `和 ${firstName} 說點什麼`,
        exact: true,
      }),
    ).toBeVisible()
    await navigate(page, `關於 ${await activeCharacterName(page)}`)
    await page.getByRole('button', { name: '更換角色頭像', exact: true }).click()
    await expect(page.getByRole('dialog', { name: `更換 ${firstName} 的頭像` })).toBeVisible()
    const avatarOwner = await windowsFileDialogOwner(app)
    await page.getByRole('button', { name: '選擇圖片…', exact: true }).click()
    const avatarReceipt = await completeWindowsFileDialog(
      avatarOwner,
      join(process.cwd(), 'tests/fixtures/avatar-white.png'),
      'open',
    )
    expect(avatarReceipt).toMatchObject({
      Action: 'open',
      ProcessId: mainPid,
      FilenameControl: 1148,
      Method: 'native-win32-controls',
    })
    expect(avatarReceipt.SessionId).toBe(folderReceipt.SessionId)
    proof.avatarReceipt = avatarReceipt
    await save()
    await expect(page.getByRole('button', { name: '選擇其他圖片…', exact: true })).toBeVisible()
    await page.getByRole('slider', { name: '頭像縮放', exact: true }).focus()
    await page.keyboard.press('ArrowRight')
    const zoom = await page
      .getByRole('slider', { name: '頭像縮放', exact: true })
      .getAttribute('aria-valuenow')
    await page.keyboard.press('ControlOrMeta+Shift+BracketRight')
    await expect(page.getByRole('dialog', { name: `更換 ${firstName} 的頭像` })).toHaveCount(0)
    await expect(editor).toBeVisible()
    await expect(editor).toContainText('只屬於 Mika 的提示詞')
    await page
      .locator('[data-region="toolbar"]')
      .getByRole('button', { name: '關於 Mika', exact: true })
      .click()
    await page.getByRole('button', { name: '更換角色頭像', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '更換 Mika 的頭像' })).toBeVisible()
    await expect(page.getByRole('button', { name: '選擇圖片…', exact: true })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+BracketLeft')
    await expect(page.getByRole('dialog', { name: `更換 ${firstName} 的頭像` })).toBeVisible()
    await expect(page.getByRole('button', { name: '選擇其他圖片…', exact: true })).toBeVisible()
    await expect(page.getByRole('slider', { name: '頭像縮放', exact: true })).toHaveAttribute(
      'aria-valuenow',
      zoom!,
    )
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '更換角色頭像', exact: true })).toBeFocused()
    await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    await expect(editor).not.toContainText('只屬於 Mika 的提示詞')
    await navigate(page, '對話')
    await switchRole(page, 'Mika')
    await expect(page.getByRole('dialog', { name: '更換 Mika 的頭像' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('ControlOrMeta+1')
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await page.getByRole('button', { name: '切換角色', exact: true }).click()
    await page.keyboard.press('Home')
    await expect(page.getByRole('menuitemradio', { name: new RegExp(firstName) })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '切換角色', exact: true })).toBeFocused()
    await page.screenshot({ path: join(test.info().outputDir, 'mika-role-switch.png') })

    const beforeCrash = await connections(page)
    for (const [base, own, other] of [
      [first.base, firstMessage, secondMessage],
      [second.base, secondMessage, firstMessage],
    ] as const) {
      const events = await ledgerEvents(base)
      expect(events.filter((event) => event.content === own)).toHaveLength(1)
      expect(events.some((event) => event.content === other)).toBe(false)
    }
    stages.push({
      stage: 'separate-main-histories-and-drafts-before-crash',
      beforeCrash,
      nativePid: mainPid,
    })
    await save()
    const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
    expect(process.kill(mainPid!, 'SIGKILL')).toBe(true)
    mainPid = undefined
    await exited
    await app.close()
    app = await first.launch('multiple-roles')
    mainPid = await app.evaluate(() => process.pid)

    page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('textbox', { name: '和 Mika 說點什麼', exact: true })).toHaveValue(
      '只有 Mika 的草稿',
    )
    await switchRole(page, firstName)
    await expect(
      page.getByRole('textbox', {
        name: `和 ${firstName} 說點什麼`,
        exact: true,
      }),
    ).toHaveValue('只有第一角色的草稿')
    await expect(page.getByRole('separator', { name: '調整側邊欄' })).toHaveAttribute(
      'aria-valuenow',
      '264',
    )
    await page.getByRole('button', { name: '檢視器', exact: true }).click()
    await expect(
      page
        .getByRole('tablist', { name: '檢視器內容' })
        .getByRole('tab', { name: '檔案', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '關閉檢視器', exact: true }).click()

    for (const owner of beforeCrash)
      expect(
        (await connections(page)).find((item) => item.characterId === owner.characterId),
      ).toEqual(owner)
    expect((await localState(page, firstOwner)).installation!.scopes).toEqual(
      firstGrant.installation!.scopes,
    )
    expect((await localState(page, firstOwner)).installation!.paused).toBe(false)
    expect((await localState(page, secondOwner)).installation!.scopes).toEqual([])
    expect((await localState(page, secondOwner)).installation!.paused).toBe(true)
    stages.push({
      stage: 'same-dpapi-owners-and-independent-grants-after-crash',
      nativePid: mainPid,
    })
    await save()
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await page.keyboard.press('ControlOrMeta+,')
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page
        .getByRole('radio', { name: mode === 'dark' ? '深色' : '淺色', exact: true })
        .click()
      for (const [name, checked] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = page.getByRole('switch', { name, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click()
      }
      await page.getByRole('button', { name: '返回', exact: true }).click()
      for (const [width, height] of [
        [1280, 760],
        [1024, 700],
      ] as const) {
        const viewportMethod = await contentSize(app, page, width, height)
        for (const name of [firstName, 'Mika']) {
          if (viewportMethod === 'electron-device-emulation')
            await expect
              .poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]))
              .toEqual([width, height])
          await expect(
            page.locator('[data-character-session]:not([hidden]) [data-region="sidebar"]'),
          ).toHaveCSS('position', width < 1100 ? 'absolute' : 'static')
          await expect(
            page.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true }),
          ).toBeVisible()
          if (!(await page.getByRole('button', { name: '切換角色', exact: true }).isVisible()))
            await page.getByRole('button', { name: '側邊欄', exact: true }).click()
          await page.getByRole('button', { name: '切換角色', exact: true }).click()
          await expect(page.getByRole('menu', { name: '角色', exact: true })).toBeVisible()
          const menu = page.getByRole('menu', { name: '角色', exact: true })
          await expect(menu.getByRole('img', { name: firstName, exact: true })).toHaveCSS(
            'background-color',
            mode === 'dark' ? 'rgb(127, 164, 255)' : 'rgb(58, 107, 214)',
          )
          await expect(menu.getByRole('img', { name: 'Mika', exact: true })).toHaveCSS(
            'background-color',
            mode === 'dark' ? 'rgb(229, 162, 188)' : 'rgb(176, 70, 107)',
          )
          await page.screenshot({
            path: test.info().outputPath(`S12-${mode}-${width}-${name}.png`),
          })
          await page.keyboard.press('Escape')
          await page.keyboard.press('ControlOrMeta+Shift+BracketRight')
        }
      }
    }
    expect(errors).toEqual([])
    proof.complete = true
    await save()
  } catch (error) {
    proof.failure = error instanceof Error ? error.message : String(error)
    if (page && !page.isClosed()) {
      await page
        .screenshot({ path: test.info().outputPath('windows-role-failure.png'), timeout: 5000 })
        .catch(() => {})
      proof.failureView = await page
        .locator('body')
        .innerText({ timeout: 5000 })
        .catch(() => 'Window unavailable')
    }
    await save()
    throw error
  } finally {
    if (mainPid)
      try {
        process.kill(mainPid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') cleanupErrors.push(error)
      }
    await app.close().catch((error) => cleanupErrors.push(error))
    console.log(`Windows native roles evidence profile: ${data}`)
  }
  expect(cleanupErrors).toEqual([])
})
