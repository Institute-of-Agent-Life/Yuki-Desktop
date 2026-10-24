import { navigate } from '../fixtures/navigation'
import { activeCharacterName } from '../fixtures/active-character'
import { crashElectron } from '../fixtures/electron-process'
import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  currentConnection,
  ledgerEvents,
  pairUI,
  waitForMainEnded,
  yukiFixture,
} from '../fixtures/backend'
import { captureWorkspace, contentSize } from '../fixtures/visual'

test('real workspace handles long conversations, separate entries, work details and immutable long file names across themes', async () => {
  test.setTimeout(240000)
  const rig = await yukiFixture({ maxInputCharacters: 6000 }),
    app = await rig.launch('workspace-content')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const composer = page.getByRole('textbox', {
      name: `和 ${await activeCharacterName(page)} 說點什麼`,
      exact: true,
    })
    const original = await currentConnection(page)
    const longPlainText = '長'.repeat(6001)
    await composer.fill(longPlainText)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    const plainRequest = await page.evaluate(
      async ({ id, text }) => {
        const result = await window.yuki.client.outbox(id)
        if (!result.ok) throw Error(result.code)
        return result.value.find((item) => item.body.text === text)!
      },
      { id: original.characterId, text: longPlainText },
    )
    expect(plainRequest.eventId).toBeGreaterThan(0)
    expect(
      (await ledgerEvents(rig.base))
        .filter((event) => event.event_id === plainRequest.eventId)
        .map((event) => event.content),
    ).toEqual([longPlainText])
    const rejection = await waitForMainEnded(page, original.characterId, plainRequest.requestId)
    expect(rejection.turn).toMatchObject({
      state: 'ended',
      outcome: 'input_too_long',
    })
    expect(rejection.turn).not.toHaveProperty('error_category')
    expect(rejection.event_id).toBe(plainRequest.eventId)
    expect(rejection.result_event_ids).toHaveLength(1)
    const originalAdmissions = await app.evaluate(
      ({ app }, { path, eventId }) => {
        const { createRequire } = process.getBuiltinModule('node:module')
        const require = createRequire(app.getAppPath() + '/package.json')
        const Database = require('better-sqlite3') as typeof import('better-sqlite3')
        const db = new Database(path, { readonly: true })
        try {
          return db
            .prepare('SELECT COUNT(*) AS count FROM ordinary_turn_admissions WHERE event_id=?')
            .get(eventId) as { count: number }
        } finally {
          db.close()
        }
      },
      { path: join(rig.root, 'yuki.sqlite3'), eventId: plainRequest.eventId! },
    )
    expect(originalAdmissions.count).toBe(0)
    const notice = page.locator(`article[data-event-id="${rejection.result_event_ids![0]}"]`)
    await expect(
      notice.getByText('消息过长，请控制在 6000 个字符以内。', { exact: true }),
    ).toBeVisible()
    const originalNotice = (await ledgerEvents(rig.base)).find(
      (event) => event.event_id === rejection.result_event_ids![0],
    )!
    expect(originalNotice).toMatchObject({
      content: '消息过长，请控制在 6000 个字符以内。',
      direction: 'outbound',
      author_kind: 'yuki',
      conversation_id: original.conversationId,
    })
    const longText =
      '# 長文字與中英混排\n\n' +
      '中英混排內容 Mixed writing retains its real source. '.repeat(150).slice(0, 5000) +
      '\n\n```typescript\nconst original = "保留原來源"\n```'
    expect(longText.length).toBeGreaterThan(5000)
    await composer.fill(longText)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    const richRequest = await page.evaluate(
      async ({ id, text }) => {
        const result = await window.yuki.client.outbox(id)
        if (!result.ok) throw Error(result.code)
        return result.value.find((item) => item.body.text === text)!
      },
      { id: original.characterId, text: longText },
    )
    const replied = await waitForMainEnded(page, original.characterId, richRequest.requestId)
    expect(replied.event_id).toBe(richRequest.eventId)
    expect(replied.turn).toMatchObject({ state: 'ended', outcome: 'chat' })
    expect(replied.turn).not.toHaveProperty('error_category')
    expect(replied.result_event_ids).toHaveLength(1)
    await expect(
      page
        .locator(`article[data-event-id="${replied.result_event_ids![0]}"]`)
        .getByText('Desktop reference reply', { exact: true }),
    ).toBeVisible()
    await writeFile(
      test.info().outputPath('long-input-original-receipts.json'),
      JSON.stringify(
        {
          maxInputCharacters: 6000,
          rejected: {
            requestId: plainRequest.requestId,
            length: longPlainText.length,
            receipt: rejection,
            mainAdmissions: originalAdmissions.count,
          },
          accepted: { requestId: richRequest.requestId, length: longText.length, receipt: replied },
        },
        null,
        2,
      ),
    )
    await composer.fill('視覺核對的未送出草稿')
    await captureWorkspace(
      app,
      page,
      'state-chat-longtext',
      async () => {
        await page.keyboard.press('ControlOrMeta+1')
        await expect(
          page.getByRole('heading', { name: '長文字與中英混排', exact: true }),
        ).toBeVisible()
        await page
          .getByRole('heading', { name: '長文字與中英混排', exact: true })
          .scrollIntoViewIfNeeded()
        await expect(composer).toBeVisible()
      },
      {
        verify: async () => {
          const heading = page.getByRole('heading', { name: '長文字與中英混排', exact: true })
          await heading.scrollIntoViewIfNeeded()
          await expect(heading).toBeInViewport({ ratio: 1 })
          await expect(composer).toBeInViewport({ ratio: 1 })
          await expect(page.getByRole('button', { name: '送出', exact: true })).toBeInViewport({
            ratio: 1,
          })
          await expect(page.getByRole('button', { name: '送出', exact: true })).toBeEnabled()
        },
      },
    )
    const qq = await fetch(`${rig.base}/__test/qq-entry?long_text=true`, { method: 'POST' })
    expect(qq.status).toBe(200)
    await captureWorkspace(
      app,
      page,
      'state-entry-readonly',
      async () => {
        await navigate(page, /^QQ ·/)
        await expect(page.getByText('QQ 原入口的真實帳本內容', { exact: true })).toBeVisible()
        await expect(page.locator('textarea')).toHaveCount(0)
      },
      {
        verify: async () => {
          await expect(
            page.getByRole('button', { name: '在桌面對話中提到這段', exact: true }),
          ).toBeInViewport({ ratio: 1 })
          await expect(page.locator('textarea')).toHaveCount(0)
        },
      },
    )
    await contentSize(app, page, 1440, 900)
    await page.getByRole('button', { name: '回到桌面對話', exact: true }).click()
    await expect(composer).toHaveValue('視覺核對的未送出草稿')
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await composer.fill('請建立原工作整合測試')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: '原工作整合測試', exact: true }) })
    await expect(card.getByText('等你回覆', { exact: true })).toBeVisible({ timeout: 20000 })
    await captureWorkspace(
      app,
      page,
      'state-chat-waiting',
      async () => {
        await page.keyboard.press('ControlOrMeta+1')
        await expect(card.getByText('等你回覆', { exact: true })).toBeVisible()
      },
      {
        verify: async () => {
          await card.scrollIntoViewIfNeeded()
          await expect(card).toBeInViewport({ ratio: 1 })
        },
      },
    )
    await captureWorkspace(app, page, 'state-works-waiting', async () => {
      await page.keyboard.press('ControlOrMeta+2')
      await expect(page.getByRole('button', { name: /等你回覆.*原工作整合測試/ })).toBeVisible()
    })
    const detail = page.getByRole('complementary', { name: '檢視器', exact: true })
    await captureWorkspace(app, page, 'state-work-inspector', async () => {
      await page.keyboard.press('ControlOrMeta+2')
      await page.getByRole('button', { name: /等你回覆.*原工作整合測試/ }).click()
      await expect(detail.getByText('需要你提供城市', { exact: true }).first()).toBeVisible()
    })
    await contentSize(app, page, 1180, 760)
    for (const [name, destination] of [
      ['調整側邊欄', 1179],
      ['調整檢視器', 1],
    ] as const) {
      const divider = page.getByRole('separator', { name, exact: true })
      const box = (await divider.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(destination, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up()
      expect(
        (await page.locator('[data-region="content"]').boundingBox())!.width,
      ).toBeGreaterThanOrEqual(520)
    }
    await page.screenshot({
      path: test
        .info()
        .outputPath(
          `${process.platform}-${await page.evaluate(() => devicePixelRatio)}x-contrast-state-columns-1180.png`,
        ),
    })
    await contentSize(app, page, 1440, 900)
    const delivered = (await (
      await fetch(`${rig.base}/__test/artifacts?long_names=true`, { method: 'POST' })
    ).json()) as { name: string; sha256: string; artifact_id: string }[]
    const name = delivered[0]!.name
    expect(name.length).toBe(40)
    expect(delivered[0]!.artifact_id).not.toBe(delivered[1]!.artifact_id)
    await captureWorkspace(
      app,
      page,
      'flow-09-files-original',
      async () => {
        await page.keyboard.press('ControlOrMeta+4')
        const versions = page.getByRole('button').and(page.getByTitle(name, { exact: true }))
        await expect(versions).toHaveCount(2)
        for (const item of delivered.slice(0, 2))
          await expect(versions.filter({ hasText: item.artifact_id })).toHaveCount(1)
        await expect(
          page
            .getByRole('region', { name: '成果預覽' })
            .getByRole('heading', { name: 'First artifact', exact: true }),
        ).toBeVisible()
      },
      {
        verify: async () => {
          await expect(
            page
              .getByRole('region', { name: '成果預覽' })
              .getByRole('button', { name: '存到…', exact: true }),
          ).toBeInViewport({ ratio: 1 })
        },
      },
    )
    const destination = join(rig.root, name)
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, destination)
    await page
      .getByRole('region', { name: '成果預覽' })
      .getByRole('button', { name: '存到…', exact: true })
      .click()
    await expect
      .poll(async () => {
        try {
          return createHash('sha256')
            .update(await readFile(destination))
            .digest('hex')
        } catch {
          return ''
        }
      })
      .toBe(delivered[0]!.sha256)
    success = true
  } finally {
    if (!success) await crashElectron(app).catch(() => {})
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test(
  'real noVNC shell keeps control and return actions visible across themes and short workspaces',
  { tag: '@unix-manager' },
  async () => {
    test.setTimeout(180000)
    const rig = await yukiFixture({ computer: true }),
      app = await rig.launch('workspace-computer')
    let success = false
    try {
      const page = await app.firstWindow()
      await pairUI(page, rig.base, await rig.code())
      const computer = async () => {
        await page.keyboard.press('ControlOrMeta+3')
        await expect(page.getByRole('button', { name: '截圖存檔', exact: true })).toBeEnabled()
      }
      await captureWorkspace(app, page, 'state-computer-viewing', computer)
      await contentSize(app, page, 1440, 900)
      await page.getByRole('button', { name: '接手', exact: true }).click()
      await expect(
        page.getByRole('button', {
          name: `交回給 ${await activeCharacterName(page)}`,
          exact: true,
        }),
      ).toBeEnabled()
      await captureWorkspace(app, page, 'flow-04-computer-human', async () => {
        await computer()
        await expect(
          page.getByRole('button', {
            name: `交回給 ${await activeCharacterName(page)}`,
            exact: true,
          }),
        ).toBeInViewport({
          ratio: 1,
        })
      })
      await captureWorkspace(
        app,
        page,
        'flow-05-return-sheet',
        async () => {
          await computer()
          await page
            .getByRole('button', { name: `交回給 ${await activeCharacterName(page)}`, exact: true })
            .click()
          await expect(
            page.getByRole('dialog', {
              name: `交回給 ${await activeCharacterName(page)}`,
              exact: true,
            }),
          ).toBeVisible()
        },
        {
          cleanup: async () => {
            await page
              .getByRole('dialog', {
                name: `交回給 ${await activeCharacterName(page)}`,
                exact: true,
              })
              .getByRole('button', { name: '取消', exact: true })
              .click()
          },
          verify: async () => {
            const sheet = page.getByRole('dialog', {
              name: `交回給 ${await activeCharacterName(page)}`,
              exact: true,
            })
            await expect(sheet.getByRole('button', { name: '交回', exact: true })).toBeInViewport({
              ratio: 1,
            })
            await expect(sheet.getByRole('button', { name: '取消', exact: true })).toBeInViewport({
              ratio: 1,
            })
          },
        },
      )
      await page
        .getByRole('button', { name: `交回給 ${await activeCharacterName(page)}`, exact: true })
        .click()
      await page
        .getByRole('dialog', { name: `交回給 ${await activeCharacterName(page)}`, exact: true })
        .getByRole('button', { name: '交回', exact: true })
        .click()
      await expect(page.getByRole('button', { name: '接手', exact: true })).toBeVisible()
      success = true
    } finally {
      if (!success) await crashElectron(app).catch(() => {})
      await app.close().catch(() => {})
      await rig.close(success)
    }
  },
)
