import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { activeCharacterName } from '../fixtures/active-character'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'

/*
 * Desktop in three languages (task book 2026-11-13 §3.4), failure cases written before the code:
 * 26 After switching, the application menu, tray, notifications or dialogs keep the old language,
 *    or only a restart applies the new one.
 * 28 The Simplified interface renders with Traditional (TC) glyphs: `<html lang>` stays zh-Hant
 *    or the effective font stack and the font actually used are TC.
 * 29 Switching changes the display time zone, a receipt note sent to the server, or a default
 *    file name (clipboard picture, computer screenshot).
 * The E2E suite itself runs as a zh-Hant system (tests/fixtures/isolated-desktop.ts).
 */

interface Recorded {
  tray: string[]
  notices: { title: string; body: string }[]
  dialogs: { title: string; message: string; buttons: string[] }[]
  saves: string[]
}
type Recorder = typeof globalThis & { recorded: Recorded }

// A 1×1 PNG, the clipboard picture and the screenshot bytes.
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function record(app: ElectronApplication) {
  await app.evaluate(
    ({ BrowserWindow, Notification, Tray, clipboard, dialog, nativeImage }, png) => {
      const state = globalThis as Recorder
      state.recorded = { tray: [], notices: [], dialogs: [], saves: [] }
      const setContextMenu = Tray.prototype.setContextMenu
      Tray.prototype.setContextMenu = function (menu) {
        state.recorded.tray = menu ? menu.items.map((item) => item.label) : []
        setContextMenu.call(this, menu)
      }
      Notification.prototype.show = function () {
        state.recorded.notices.push({ title: this.title, body: this.body })
      }
      dialog.showMessageBox = (async (
        owner: Electron.BaseWindow | Electron.MessageBoxOptions,
        options?: Electron.MessageBoxOptions,
      ) => {
        const shown = (options ?? owner) as Electron.MessageBoxOptions
        state.recorded.dialogs.push({
          title: shown.title ?? '',
          message: shown.message,
          buttons: shown.buttons ?? [],
        })
        return { response: 0, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      dialog.showSaveDialog = (async (
        owner: Electron.BaseWindow | Electron.SaveDialogOptions,
        options?: Electron.SaveDialogOptions,
      ) => {
        state.recorded.saves.push(((options ?? owner) as Electron.SaveDialogOptions).defaultPath!)
        return { canceled: true, filePath: '' }
      }) as typeof dialog.showSaveDialog
      clipboard.readImage = () => nativeImage.createFromDataURL(`data:image/png;base64,${png}`)
      // Notifications for the selected Yuki appear only while its window is not in front.
      for (const window of BrowserWindow.getAllWindows()) window.isFocused = () => false
    },
    png,
  )
}
const recorded = (app: ElectronApplication) => app.evaluate(() => (globalThis as Recorder).recorded)
const menuLabels = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((item) => item.label))

async function chooseLanguage(page: Page, label: string, value: string) {
  await page.getByRole('tab', { name: /^(一般|General)$/ }).click()
  await page.getByLabel(label, { exact: true }).selectOption(value)
}

test('switching language relocalizes the running app and keeps time zone, receipts and file names', async () => {
  test.setTimeout(150000)
  const rig = await yukiFixture()
  const app = await rig.launch('languages')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const name = await activeCharacterName(page)
    const connection = await currentConnection(page)
    await record(app)
    const platform = await page.evaluate(async () => (await window.yuki.boot()).platform)
    const darwin = platform === 'darwin'

    // A message whose time is shown in the chosen zone, distinct from the machine's own.
    const composer = page.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
    await composer.fill('語言切換前的訊息')
    await composer.press('Enter')
    await expect(page.getByText('Desktop reference reply', { exact: true })).toBeVisible()
    const cdp = await app.context().newCDPSession(page)
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/Los_Angeles' })
    const time = page.locator('article[aria-label="你的訊息"] time').first()
    const timestamp = (await time.getAttribute('datetime'))!
    const taipei = (locale: string) =>
      page.evaluate(
        ({ timestamp, locale }) =>
          new Date(timestamp).toLocaleString(locale, {
            timeZone: 'Asia/Taipei',
            hour: '2-digit',
            minute: '2-digit',
          }),
        { timestamp, locale },
      )
    await expect(time).toHaveText(await taipei('zh-Hant'))
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant')

    // The tray, built in Traditional Chinese.
    await page.keyboard.press('ControlOrMeta+,')
    const trayLabel = `關閉視窗後保留在${darwin ? '選單列' : '系統匣'}`
    await page.getByRole('switch', { name: trayLabel, exact: true }).click()
    await expect.poll(async () => (await recorded(app)).tray).toContain('顯示視窗')
    expect(await menuLabels(app)).toContain('檔案')
    await page.screenshot({ path: test.info().outputPath('settings-zh-Hant.png') })

    // English, live.
    await chooseLanguage(page, '介面語言', 'en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByLabel('Interface Language', { exact: true })).toHaveValue('en')
    expect(await menuLabels(app)).toEqual(
      darwin
        ? ['Yuki', 'File', 'Edit', 'View', 'Window', 'Help']
        : ['File', 'Edit', 'View', 'Window', 'Help'],
    )
    expect((await recorded(app)).tray).toEqual([`Open ${name}`, 'Show Window', '', 'Quit'])
    await page.screenshot({ path: test.info().outputPath('settings-en.png') })
    // Dialogs shown from now on.
    await page.evaluate(() => window.yuki.client.external('https://example.com/guide'))
    expect((await recorded(app)).dialogs.at(-1)).toEqual({
      title: 'Open External Link',
      message: 'Open example.com in your browser?',
      buttons: ['Cancel', 'Open'],
    })
    // The time zone stays the chosen one; only the format follows the language.
    const preferences = await page.evaluate(async () => (await window.yuki.boot()).preferences)
    expect(preferences).toMatchObject({ language: 'en', timeZone: 'Asia/Taipei' })
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(time).toHaveText(await taipei('en'))
    expect(await time.getAttribute('datetime')).toBe(timestamp)

    // Notifications built after the switch.
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await composer.fill('切換到英文後開始的工作')
    await composer.press('Enter')
    await expect
      .poll(async () => (await recorded(app)).notices, { timeout: 30000 })
      .toContainEqual({ title: `${name} · Waiting for your reply`, body: '需要你提供城市' })

    // Data keeps its own words: default file names do not follow the interface.
    const pasted = await page.evaluate(() => window.yuki.client.pasteAvatar())
    expect(pasted).toMatchObject({ ok: true, value: { filename: '剪貼簿圖片.png' } })
    await page.evaluate(
      async ({ id, png }) =>
        window.yuki.client.saveScreenshot(
          id,
          Uint8Array.from(atob(png), (character) => character.charCodeAt(0)),
        ),
      { id: connection.characterId, png },
    )
    expect((await recorded(app)).saves.at(-1)).toBe(`${connection.name} 電腦截圖.png`)

    // Simplified Chinese, live, with SC glyphs.
    await page.keyboard.press('ControlOrMeta+,')
    await chooseLanguage(page, 'Interface Language', 'zh-Hans')
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans')
    await expect(page.getByRole('tab', { name: '通用', exact: true })).toBeVisible()
    expect(await menuLabels(app)).toEqual(
      darwin
        ? ['Yuki', '文件', '编辑', '显示', '窗口', '帮助']
        : ['文件', '编辑', '显示', '窗口', '帮助'],
    )
    expect((await recorded(app)).tray).toEqual([`打开 ${name}`, '显示窗口', '', '退出'])
    const heading = page.getByRole('heading', { name: '通用', exact: true })
    const fonts = await heading.evaluate((element) => ({
      lang: document.documentElement.lang,
      stack: getComputedStyle(element).fontFamily,
    }))
    const { nodeId } = await cdp
      .send('DOM.getDocument')
      .then(({ root }) =>
        cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#settings-panel h2' }),
      )
    await cdp.send('CSS.enable')
    // Font names come localized (蘋方-簡); PostScript names (PingFangSC-Regular) do not.
    const used = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map(
      ({ familyName, postScriptName }) => ({ familyName, postScriptName }),
    )
    await writeFile(
      test.info().outputPath('zh-Hans-fonts.json'),
      JSON.stringify({ platform, ...fonts, used }, null, 2),
    )
    const stack = fonts.stack.split(',').map((family) => family.trim().replace(/^["']|["']$/g, ''))
    const firstTraditional = stack.findIndex((family) => /\bTC\b|JhengHei/.test(family))
    const firstSimplified = stack.findIndex((family) => /\bSC\b|YaHei/.test(family))
    expect(firstSimplified).toBeGreaterThanOrEqual(0)
    expect(firstTraditional === -1 || firstSimplified < firstTraditional).toBe(true)
    const traditional = /PingFangTC|CJKtc|SansTC|JhengHei/i
    expect(used.filter((font) => traditional.test(font.postScriptName))).toEqual([])
    if (darwin)
      expect(used.map((font) => font.postScriptName)).toContainEqual(
        expect.stringMatching(/^PingFangSC-/),
      )
    await page.screenshot({ path: test.info().outputPath('settings-zh-Hans.png') })

    // The choice is kept as the preference; the zone is still the one chosen before.
    expect(await page.evaluate(async () => (await window.yuki.boot()).preferences)).toMatchObject({
      language: 'zh-Hans',
      timeZone: 'Asia/Taipei',
    })
    await writeFile(
      test.info().outputPath('languages.json'),
      JSON.stringify({ platform, name, recorded: await recorded(app) }, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test(
  'the quit dialog follows the language while the return receipt note stays as written',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(120000)
    const rig = await yukiFixture({ computer: true })
    let app = await rig.launch('language-quit'),
      success = false
    const buttons = join(rig.root, 'quit-buttons.json')
    try {
      let page = await app.firstWindow()
      await pairUI(page, rig.base, await rig.code())
      const name = await activeCharacterName(page)
      const { characterId } = await currentConnection(page)
      await page.evaluate(() => window.yuki.preferences({ language: 'en' }))
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      await navigate(page, `${name} 的電腦`)
      await page.getByRole('button', { name: '接手', exact: true }).click()
      await expect(page.getByRole('button', { name: '貼上文字到遠端畫面' })).toBeEnabled()
      await app.evaluate(({ dialog, app }, path) => {
        dialog.showMessageBox = (async (
          owner: Electron.BaseWindow | Electron.MessageBoxOptions,
          options?: Electron.MessageBoxOptions,
        ) => {
          const shown = (options ?? owner) as Electron.MessageBoxOptions
          process.getBuiltinModule('node:fs').writeFileSync(
            path,
            JSON.stringify({
              title: shown.title,
              buttons: shown.buttons,
              message: shown.message,
            }),
          )
          return { response: 0, checkboxChecked: false }
        }) as typeof dialog.showMessageBox
        app.quit()
      }, buttons)
      await new Promise<void>((resolve) => app.once('close', () => resolve()))
      expect(JSON.parse(await readFile(buttons, 'utf8'))).toEqual({
        title: "You're controlling Yuki's computer",
        message: `You're controlling ${name}'s computer`,
        buttons: ['Return and Quit', 'Keep Control and Quit', 'Cancel'],
      })
      app = await rig.launch('language-quit')
      page = await app.firstWindow()
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      const commands = await page.evaluate(async (id) => {
        const result = await window.yuki.client.computerCommands(id)
        if (!result.ok) throw Error(result.code)
        return result.value.map((item) => item.command)
      }, characterId)
      expect(commands).toContainEqual(
        expect.objectContaining({ action: 'return', note: '使用者交回控制並結束 App。' }),
      )
      success = true
    } finally {
      await app.close().catch(() => {})
      await rig.close(success)
    }
  },
)
