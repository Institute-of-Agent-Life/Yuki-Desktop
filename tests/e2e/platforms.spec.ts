import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'

/*
 * Settings → 平台 (task book 2026-11-13 §3.2 desktop, §4 failure cases 4, 6–10, §5 revision),
 * failure cases written before the code:
 * 4  A wrong Telegram token: its dialog shows no reason, or the refused token is saved anyway.
 * 6  After the platform refuses credentials, a corrected save cannot go through (it replays the
 *    refused request, or the dialog stays locked).
 * 7  Disabling does not reach the server, or the list still reads as running. Turning a saved
 *    platform on from the list's switch skips the platform's check, or a refusal there is not
 *    explained on the page with the platform's code, or leaves it reading as on.
 * 8  A save with an expired revision overwrites what another device just saved.
 * 9  A saved secret is shown, echoed into the page, or returned by the read.
 * 10 「QQ 登入」is offered without `SNOWLUMA_VNC_HOST`, or missing (or not opening the QQ display)
 *    with it; a server reached only by URL gets no commands to enable SnowLuma.
 *    QQ 官方 Bot: its limits are not in front of the operator before saving.
 * Layout (UI 液态玻璃统一): a platform is a card of its own instead of a settings row like the
 * model page's, a guide is spread over the page instead of folded in the dialog, or the rows'
 * type, row height and buttons differ from the model page's.
 * A lost apply response is retried with a new request ID instead of the original one.
 * A server that cannot write its settings directory still offers a save.
 * A server below Client API revision 11 shows a broken page instead of its actual revision.
 * Real backend; the only external calls are the platforms' own credential checks with refused
 * credentials (no paid service).
 */

// A deployment has its settings directory (the reference server starts without one).
async function deployment(options: Parameters<typeof yukiFixture>[0] = {}) {
  const rig = await yukiFixture({ modelConfiguration: true, ...options })
  await mkdir(join(rig.root, 'webui-config'), { recursive: true })
  return rig
}
async function platforms(page: Page) {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
  )
  await page.getByRole('tab', { name: '平台', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Telegram', exact: true })).toBeVisible()
}
// Each platform is a row on the list; its credentials are edited in a dialog opened from the row.
const row = (page: Page, name: string) => page.getByRole('group', { name, exact: true })
async function configure(page: Page, name: string, button = `設定 ${name}`) {
  await row(page, name).getByRole('button', { name: button, exact: true }).click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
// The settings panel slides in and a dialog grows out of its button; a screenshot waits for rest.
const settle = (page: Page) => page.waitForTimeout(800)
// The list, then the QQ dialog, in one language.
async function shoot(page: Page, language: string, button: string) {
  await settle(page)
  await page.screenshot({ path: test.info().outputPath(`platforms-${language}.png`) })
  const dialog = await configure(page, 'QQ', button)
  await settle(page)
  await page.screenshot({ path: test.info().outputPath(`platforms-${language}-qq.png`) })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}
async function readPlatforms(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.platforms.read(id)
    if (!result.ok) throw Error(result.code)
    return result.value
  }, id)
}
async function recordApplies(app: ElectronApplication, discardFirst = false) {
  await app.evaluate((_electron, discardFirst) => {
    const scope = globalThis as typeof globalThis & { applies: string[] }
    scope.applies = []
    const originalFetch = globalThis.fetch
    let discard = discardFirst
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      if (String(input).endsWith('/admin/v1/platforms/apply')) {
        scope.applies.push(JSON.parse(String(init!.body)).request_id)
        if (discard) {
          discard = false
          await response.arrayBuffer()
          throw new TypeError('fixture discards the completed HTTP reply')
        }
      }
      return response
    }
  }, discardFirst)
}
const applies = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as typeof globalThis & { applies: string[] }).applies)

test('a refused Telegram token is explained and not saved; a corrected save goes through', async () => {
  test.setTimeout(120000)
  const rig = await deployment(),
    app = await rig.launch('platforms-telegram')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const { characterId } = await currentConnection(page)
    await recordApplies(app)
    await platforms(page)
    await expect(row(page, 'Telegram').getByText('未設定', { exact: true })).toBeVisible()
    // Nothing saved yet: the list offers no switch for it.
    await expect(row(page, 'Telegram').getByRole('switch')).toHaveCount(0)
    let dialog = await configure(page, 'Telegram')
    const token = '123456:yuki-e2e-refused-token'
    await dialog.getByLabel('Bot Token', { exact: true }).fill(token)
    await dialog.getByRole('switch', { name: '啟用 Telegram', exact: true }).click()
    await dialog.getByRole('button', { name: '儲存', exact: true }).click()
    // 4: the platform's own refusal, readable, with its code, in the dialog that sent it.
    await expect(dialog.getByText('Telegram 拒絕了這個 Bot Token', { exact: false })).toBeVisible()
    await expect(dialog.getByText('平台錯誤碼：401', { exact: true })).toBeVisible()
    await settle(page)
    await page.screenshot({ path: test.info().outputPath('platforms-telegram-refused.png') })
    const refused = await readPlatforms(page, characterId)
    expect(refused.platforms.telegram).toMatchObject({
      configured: false,
      enabled: false,
      saved_secrets: [],
    })

    // 6 and 7: a corrected save is a new request; disabled, the token is kept without running.
    await dialog.getByRole('switch', { name: '啟用 Telegram', exact: true }).click()
    await dialog.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByText('已儲存並套用。', { exact: true })).toBeVisible()
    await expect(dialog).toBeHidden()
    const requests = await applies(app)
    expect(requests).toHaveLength(2)
    expect(new Set(requests).size).toBe(2)
    const saved = await readPlatforms(page, characterId)
    expect(saved.platforms.telegram).toMatchObject({
      configured: true,
      enabled: false,
      saved_secrets: ['bot_token'],
    })
    await expect(row(page, 'Telegram').getByText('未啟用', { exact: true })).toBeVisible()
    // 9: the saved token is only ever marked as saved.
    expect(JSON.stringify(saved)).not.toContain(token)
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(token)
    dialog = await configure(page, 'Telegram')
    await expect(dialog.getByLabel('Bot Token', { exact: true })).toHaveValue('')
    await expect(dialog.getByLabel('Bot Token', { exact: true })).toHaveAttribute(
      'placeholder',
      '已儲存',
    )
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // 7: turned on from the list, the refused token is checked again and stays off.
    const toggle = row(page, 'Telegram').getByRole('switch', {
      name: '啟用 Telegram',
      exact: true,
    })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(page.getByText('Telegram 拒絕了這個 Bot Token', { exact: false })).toBeVisible()
    await expect(page.getByText('平台錯誤碼：401', { exact: true })).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(row(page, 'Telegram').getByText('未啟用', { exact: true })).toBeVisible()
    expect(await applies(app)).toHaveLength(3)
    expect((await readPlatforms(page, characterId)).platforms.telegram).toMatchObject({
      configured: true,
      enabled: false,
    })
    await settle(page)
    await page.screenshot({ path: test.info().outputPath('platforms-telegram-list-refused.png') })
    await writeFile(
      test.info().outputPath('platforms-telegram.json'),
      JSON.stringify({ requests, refused, saved }, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('an expired revision does not overwrite the save another device made', async () => {
  test.setTimeout(120000)
  const rig = await deployment(),
    app = await rig.launch('platforms-conflict')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const { characterId } = await currentConnection(page)
    await platforms(page)
    const card = await configure(page, 'Lark')
    await card.getByLabel('App ID', { exact: true }).fill('cli_lark_draft')
    await card.getByLabel('App Secret', { exact: true }).fill('lark-draft-secret')
    const concurrent = await page.evaluate(async (id) => {
      const current = await window.yuki.client.platforms.read(id)
      if (!current.ok) throw Error(current.code)
      return window.yuki.client.platforms.apply(id, {
        requestId: crypto.randomUUID(),
        expectedRevision: current.value.revision,
        platform: 'feishu',
        enabled: false,
        settings: { app_id: 'cli_other_device' },
        secrets: { app_secret: 'other-device-secret' },
      })
    }, characterId)
    expect(concurrent.ok && concurrent.value.success).toBe(true)
    await card.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(card.getByText('設定已在其他地方變更', { exact: false })).toBeVisible()
    const kept = await readPlatforms(page, characterId)
    expect(kept.platforms.feishu.settings).toEqual({ app_id: 'cli_other_device' })
    expect(kept.platforms.lark.configured).toBe(false)
    await card.getByRole('button', { name: '重新載入', exact: true }).click()
    await expect(card.getByText('設定已在其他地方變更', { exact: false })).not.toBeVisible()
    await expect(card.getByLabel('App ID', { exact: true })).toHaveValue('cli_lark_draft')
    await card.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByText('已儲存並套用。', { exact: true })).toBeVisible()
    await expect(card).toBeHidden()
    const after = await readPlatforms(page, characterId)
    expect(after.platforms.feishu.settings).toEqual({ app_id: 'cli_other_device' })
    expect(after.platforms.lark).toMatchObject({
      configured: true,
      settings: { app_id: 'cli_lark_draft' },
    })
    await page.screenshot({ path: test.info().outputPath('platforms-conflict.png') })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('a lost apply response is confirmed with the original request ID', async () => {
  test.setTimeout(120000)
  const rig = await deployment(),
    app = await rig.launch('platforms-lost-response')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const { characterId } = await currentConnection(page)
    await recordApplies(app, true)
    await platforms(page)
    const card = await configure(page, '飛書')
    await card.getByLabel('App ID', { exact: true }).fill('cli_feishu')
    await card.getByLabel('App Secret', { exact: true }).fill('feishu-secret')
    await card.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(card.getByText('平台設定等待確認', { exact: false })).toBeVisible()
    await card.getByRole('button', { name: '重新確認', exact: true }).click()
    await expect(page.getByText('已儲存並套用。', { exact: true })).toBeVisible()
    await expect(card).toBeHidden()
    const requests = await applies(app)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toBe(requests[0])
    expect((await readPlatforms(page, characterId)).platforms.feishu).toMatchObject({
      configured: true,
      saved_secrets: ['app_secret'],
    })
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('a server that cannot write its settings directory offers no save', async () => {
  test.setTimeout(120000)
  const rig = await deployment(),
    app = await rig.launch('platforms-read-only')
  const directory = join(rig.root, 'webui-config')
  let success = false
  try {
    await mkdir(directory, { recursive: true })
    await chmod(directory, 0o555)
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await platforms(page)
    await expect(page.getByText('伺服器目前無法寫入設定', { exact: false })).toBeVisible()
    for (const name of ['Telegram', '飛書', 'Lark']) {
      const dialog = await configure(page, name)
      await expect(dialog.getByRole('button', { name: '儲存', exact: true })).toBeDisabled()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }
    await settle(page)
    await page.screenshot({ path: test.info().outputPath('platforms-read-only.png') })
    success = true
  } finally {
    await chmod(directory, 0o755)
    await app.close()
    await rig.close(success)
  }
})

test('QQ offers the official Bot with its limits, or SnowLuma with the server commands, in three languages', async () => {
  test.setTimeout(150000)
  const rig = await deployment(),
    app = await rig.launch('platforms-languages')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await platforms(page)
    const qq = await configure(page, 'QQ')
    const mode = qq.getByRole('radiogroup', { name: 'QQ 接入方式', exact: true })
    await mode.getByRole('radio', { name: '官方 Bot', exact: true }).click()
    // The limits stand before the save.
    const limits = qq.getByRole('list', { name: '官方 Bot 的限制', exact: true })
    await expect(limits).toContainText('群裡預設只收到 @')
    await expect(limits).toContainText('群裡不能主動發訊息')
    await expect(limits).toContainText('時間窗口')
    expect(
      await limits.evaluate(
        (list, save) => !!(list.compareDocumentPosition(save!) & Node.DOCUMENT_POSITION_FOLLOWING),
        await qq.getByRole('button', { name: '儲存', exact: true }).elementHandle(),
      ),
    ).toBe(true)
    await settle(page)
    await page.screenshot({ path: test.info().outputPath('platforms-qq-official.png') })

    await mode.getByRole('radio', { name: 'SnowLuma', exact: true }).click()
    // 10: no VNC host, no 「QQ 登入」; a server reached by URL gets the commands to run there.
    await expect(qq.getByRole('button', { name: '開啟 QQ 登入', exact: true })).toHaveCount(0)
    await qq.getByLabel('SnowLuma 映像', { exact: true }).fill('registry.example.com/me/snowluma:1')
    const script = qq.locator('code')
    await expect(script).toContainText("image='registry.example.com/me/snowluma:1'")
    await expect(script).toContainText('docker compose up -d bot snowluma')
    await expect(qq.getByText('SNOWLUMA_VNC_HOST', { exact: false }).first()).toBeVisible()
    await settle(page)
    await page.screenshot({ path: test.info().outputPath('platforms-snowluma.png') })
    await page.keyboard.press('Escape')
    await expect(qq).toBeHidden()
    await shoot(page, 'zh-Hant', '設定 QQ')

    for (const [language, general, tab, label, button] of [
      ['zh-Hans', '一般', '平台', '界面语言', '设置 QQ'],
      ['en', '通用', 'Platforms', 'Interface Language', 'Set Up QQ'],
    ] as const) {
      await page.getByRole('tab', { name: general, exact: true }).click()
      await page
        .getByLabel(language === 'zh-Hans' ? '介面語言' : '界面语言', { exact: true })
        .selectOption(language)
      await expect(page.locator('html')).toHaveAttribute('lang', language)
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(language)
      await page.getByRole('tab', { name: tab, exact: true }).click()
      await shoot(page, language, button)
    }
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test(
  'with a configured QQ display, 「QQ 登入」opens it in the computer window',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(120000)
    const rig = await deployment({ computer: true, snowluma: true }),
      app = await rig.launch('platforms-qq-login')
    let success = false
    try {
      const page = await app.firstWindow()
      await pairUI(page, rig.base, await rig.code())
      await platforms(page)
      const qq = await configure(page, 'QQ')
      await qq
        .getByRole('radiogroup', { name: 'QQ 接入方式', exact: true })
        .getByRole('radio', { name: 'SnowLuma', exact: true })
        .click()
      await qq.getByRole('button', { name: '開啟 QQ 登入', exact: true }).click()
      await expect(page.getByRole('region', { name: 'QQ 登入', exact: true })).toBeVisible()
      await expect(page.getByRole('radio', { name: 'QQ 登入', exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      await page.screenshot({ path: test.info().outputPath('platforms-qq-login.png') })
      success = true
    } finally {
      await app.close()
      await rig.close(success)
    }
  },
)

// Type, spacing and buttons of the first settings row and its button on the open settings page.
const rowMetrics = (page: Page) =>
  page
    .locator('#settings-panel [data-settings-row]')
    .first()
    .evaluate((row) => {
      const style = (node: Element) => getComputedStyle(node)
      const label = row.firstElementChild!,
        small = label.querySelector('small')!,
        button = row.querySelector('button:not([role=switch])')!,
        group = row.parentElement!
      return {
        row: {
          minHeight: style(row).minHeight,
          padding: style(row).padding,
          gap: style(row).gap,
        },
        label: { font: style(label).fontSize, line: style(label).lineHeight },
        description: { font: style(small).fontSize, line: style(small).lineHeight },
        button: {
          height: button.getBoundingClientRect().height,
          font: style(button).fontSize,
          radius: style(button).borderRadius,
          padding: style(button).padding,
        },
        group: { radius: style(group).borderRadius, background: style(group).backgroundColor },
        left: group.getBoundingClientRect().left,
      }
    })

test('the platform list and its dialogs match the model page in light and dark, frosted and opaque', async () => {
  test.setTimeout(240000)
  const rig = await deployment(),
    app = await rig.launch('platforms-looks')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await platforms(page)
    // One saved platform, so the list shows a row with its switch.
    const telegram = await configure(page, 'Telegram')
    await telegram.getByLabel('Bot Token', { exact: true }).fill('123456:yuki-e2e-look-token')
    await telegram.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(telegram).toBeHidden()
    const looks = [
      ['light', '淺色', '透明磨砂'],
      ['light-opaque', '淺色', '不透明'],
      ['dark', '深色', '透明磨砂'],
      ['dark-opaque', '深色', '不透明'],
    ] as const
    const metrics: Record<string, unknown> = {}
    for (const [look, theme, material] of looks) {
      await page.getByRole('tab', { name: '外觀', exact: true }).click()
      await page.getByRole('radio', { name: theme, exact: true }).click()
      await page
        .getByRole('radiogroup', { name: '視窗材質', exact: true })
        .getByRole('radio', { name: material, exact: true })
        .click()
      await expect(page.locator('html')).toHaveAttribute(
        'data-opaque',
        String(material === '不透明'),
      )
      await page.getByRole('tab', { name: '模型', exact: true }).click()
      await expect(page.getByRole('heading', { name: '模型連接' })).toBeVisible()
      await settle(page)
      await page.screenshot({ path: test.info().outputPath(`compare-${look}-model.png`) })
      const model = await rowMetrics(page)
      // A model dialog in the same look, to set the platform dialogs beside.
      await page.getByRole('button', { name: '新增連接', exact: true }).click()
      const adding = page.getByRole('dialog', { name: '新增連接', exact: true })
      await expect(adding).toBeVisible()
      await settle(page)
      await page.screenshot({ path: test.info().outputPath(`compare-${look}-model-dialog.png`) })
      await page.keyboard.press('Escape')
      await expect(adding).toBeHidden()
      await page.getByRole('tab', { name: '平台', exact: true }).click()
      await expect(row(page, 'Telegram')).toBeVisible()
      await settle(page)
      await page.screenshot({ path: test.info().outputPath(`compare-${look}-platforms.png`) })
      const list = await rowMetrics(page)
      // The same settings row and button as the model page, not a card of its own.
      expect({ ...list, group: list.group.radius }).toEqual({
        ...model,
        group: model.group.radius,
      })
      expect(list.group.background).toBe(model.group.background)
      expect(await page.locator('#settings-panel details').count()).toBe(0)
      metrics[look] = { model, platforms: list }
      for (const [name, mode] of [
        ['Telegram', undefined],
        ['飛書', undefined],
        ['Lark', undefined],
        ['QQ', '官方 Bot'],
        ['QQ', 'SnowLuma'],
      ] as const) {
        const dialog = await configure(page, name)
        if (mode) await dialog.getByRole('radio', { name: mode, exact: true }).click()
        // The guide is folded inside the dialog, one sentence a step.
        const guide = dialog.locator('details').first()
        await guide.locator('summary').click()
        await settle(page)
        await page.screenshot({
          path: test.info().outputPath(`dialog-${look}-${name}${mode ? `-${mode}` : ''}.png`),
        })
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
      }
    }
    await writeFile(
      test.info().outputPath('platforms-looks.json'),
      JSON.stringify(metrics, null, 2),
    )
    success = true
  } finally {
    await app.close()
    await rig.close(success)
  }
})

test('a server below Client API revision 11 shows the platform page as unavailable with its revision', async () => {
  test.setTimeout(150000)
  const previous = process.env.YUKI_BACKEND_PREVIOUS_ROOT,
    python = process.env.YUKI_BACKEND_PREVIOUS_PYTHON
  test.skip(
    !previous || !python,
    'Requires YUKI_BACKEND_PREVIOUS_ROOT/PYTHON: a backend checkout below revision 11.',
  )
  const rig = await deployment()
  let app = await rig.launch('platforms-revision')
  let older: ReturnType<typeof spawn> | undefined
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await app.close()
    // The same instance, its data and address, now served by the previous backend.
    await fetch(`${rig.base}/__test/shutdown`, { method: 'POST' })
    await expect
      .poll(
        () =>
          fetch(`${rig.base}/healthz`).then(
            () => 'up',
            () => 'down',
          ),
        { timeout: 30000 },
      )
      .toBe('down')
    const url = new URL(rig.base)
    older = spawn(
      python!,
      [
        '-m',
        'tests.support.desktop_reference_server',
        '--root',
        rig.root,
        '--state-file',
        join(rig.root, 'ready.json'),
        '--port',
        url.port,
        '--base-path',
        '/role/yuki',
      ],
      {
        cwd: previous,
        env: {
          ...process.env,
          PYTHONPATH: [join(previous!, 'src'), previous!].join(delimiter),
          YUKI_AUTHORITY_FIXTURE: '1',
        },
        stdio: 'ignore',
      },
    )
    await expect
      .poll(
        () =>
          fetch(`${rig.base}/client/v1/meta`)
            .then((response) => response.json())
            .then(
              (body: { data: { api_revision: number } }) => body.data.api_revision,
              () => 0,
            ),
        { timeout: 30000 },
      )
      .toBe(10)
    app = await rig.launch('platforms-revision')
    const reopened = await app.firstWindow()
    await platformsTab(reopened)
    await expect(
      reopened.getByText('這個 Yuki 的 Client API revision 為 10，平台設定需要 11 以上', {
        exact: false,
      }),
    ).toBeVisible()
    await settle(reopened)
    await reopened.screenshot({ path: test.info().outputPath('platforms-revision-10.png') })
    success = true
  } finally {
    await app.close()
    older?.kill('SIGTERM')
    await rig.close(success)
  }
})

async function platformsTab(page: Page) {
  const tab = page.getByRole('tab', { name: '平台', exact: true })
  await expect(async () => {
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('yuki:command', { detail: 'settings' })),
    )
    await expect(tab).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 30000 })
  await tab.click()
}
