import { expect, test, type Page } from '@playwright/test'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { PromptDraft, PromptCommandItem, MemoryPage } from '../../src/shared/api'
import { pairUI, yukiFixture } from '../fixtures/backend'

const editor = (page: Page, key = 'system_prompt') =>
  page.getByRole('textbox', { name: `${key}.md 內容`, exact: true })
const save = (page: Page) =>
  page.locator('[data-region="toolbar"]').getByRole('button', { name: '儲存', exact: true })
async function connection(page: Page) {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok || !result.value[0]) throw Error('missing original connection')
    return result.value[0]
  })
}
async function drafts(page: Page): Promise<PromptDraft[]> {
  const { characterId } = await connection(page)
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.promptDrafts(id)
    if (!result.ok) throw Error(result.code)
    return result.value
  }, characterId)
}
async function commands(page: Page): Promise<PromptCommandItem[]> {
  const { characterId } = await connection(page)
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.promptCommands(id)
    if (!result.ok) throw Error(result.code)
    return result.value
  }, characterId)
}
async function memories(page: Page) {
  const { characterId } = await connection(page)
  return page.evaluate(async (id) => {
    const facts = []
    for (const about of ['me', 'self'] as const) {
      let cursor: string | undefined
      do {
        const response = await window.yuki.client.read<MemoryPage>(id, {
          kind: 'memory',
          about,
          cursor,
        })
        if (!response.ok) throw Error(response.code)
        facts.push(...response.value.items)
        cursor = response.value.next_cursor ?? undefined
      } while (cursor)
    }
    return facts
  }, characterId)
}
async function open(page: Page) {
  await page.getByRole('button', { name: '關於 Yuki', exact: true }).click()
  await page.getByRole('button', { name: '編輯提示詞', exact: true }).click()
  await expect(editor(page)).toBeVisible()
}
async function edit(page: Page, content: string, key = 'system_prompt') {
  await expect(editor(page, key)).toHaveAttribute('aria-readonly', 'false')
  await editor(page, key).click()
  await page.keyboard.press('Meta+A')
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    if (index) await page.keyboard.press('Enter')
    await page.keyboard.insertText(lines[index]!)
  }
  await expect
    .poll(async () => (await drafts(page)).find((item) => item.key === key)?.draft)
    .toBe(content)
}

test('real prompt editor keeps CAS baselines, compares conflicts, supports undo and protects navigation', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ character: true, prompts: true }),
    a = await rig.launch('prompt-a'),
    b = await rig.launch('prompt-b')
  let success = false
  try {
    const pa = await a.firstWindow(),
      pb = await b.firstWindow(),
      errors: string[] = []
    pa.on('pageerror', (error) => errors.push(error.message))
    pb.on('pageerror', (error) => errors.push(error.message))
    await pairUI(pa, rig.base, await rig.code())
    await pairUI(pb, rig.base, await rig.code())
    await pa.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('保留記憶與歷史的原依據')
    await pa.getByRole('button', { name: '送出', exact: true }).click()
    await expect(pa.getByText('真實帳本回覆', { exact: true })).toBeVisible()
    const seeded = await fetch(`${rig.base}/__test/character-data`, { method: 'POST' })
    expect(seeded.status).toBe(200)
    const beforeMemories = await memories(pa),
      beforeConnection = await connection(pa)
    expect(beforeMemories).toHaveLength(53)
    const beforeFacts = await (await fetch(`${rig.base}/__test/prompt-facts`)).json()
    await open(pa)
    await open(pb)
    const initial = (await drafts(pa)).find((item) => item.key === 'system_prompt')!
    expect(initial.baseContent).toBe(await readFile(join(rig.root, 'system_prompt.md'), 'utf8'))
    expect(initial.draft).toBe(initial.baseContent)
    await expect(pa.locator('.cm-persona-placeholder')).toContainText('{{YUKI_PERSONA_CORE}}')
    const mine = 'A 草稿\r\n{{YUKI_PERSONA_CORE}}',
      theirs = 'B 已儲存\r\n{{YUKI_PERSONA_CORE}}'
    await edit(pa, mine)
    await edit(pb, theirs)
    await save(pb).click()
    await expect(save(pb)).toBeDisabled()
    await expect(pa.getByRole('button', { name: '比較差異', exact: true })).toBeVisible()
    expect((await drafts(pa)).find((item) => item.key === 'system_prompt')).toMatchObject({
      baseRevision: initial.baseRevision,
      baseContent: initial.baseContent,
      draft: mine,
      remote: { content: theirs },
    })
    await save(pa).click()
    await expect(
      pa.getByText('儲存未完成：伺服器版本已改變，請先處理差異', { exact: true }),
    ).toBeVisible()
    expect(await readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(theirs)
    const failed = (await commands(pa)).at(-1)!
    expect(failed.command).toMatchObject({ expectedRevision: initial.baseRevision })
    await pa.getByRole('button', { name: '比較差異', exact: true }).click()
    await expect(
      pa
        .getByRole('region', { name: '伺服器目前版本（唯讀）' })
        .or(pa.locator('section[aria-label="伺服器目前版本（唯讀）"]')),
    ).toContainText('B 已儲存')
    await expect(pa.locator('section[aria-label="你的草稿（唯讀預覽）"]')).toContainText('A 草稿')
    await pa.screenshot({
      path: test.info().outputPath('prompt-conflict-diff.png'),
      animations: 'disabled',
    })
    await pa.getByRole('button', { name: '關閉', exact: true }).click()
    await pa.getByRole('button', { name: '以我的版本覆蓋…', exact: true }).click()
    await expect(pa.getByRole('dialog', { name: '以我的版本覆蓋？' })).toBeVisible()
    await pa.keyboard.press('Enter')
    expect(await readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(theirs)
    if (await pa.getByRole('dialog', { name: '以我的版本覆蓋？' }).isVisible())
      await pa.getByRole('button', { name: '取消', exact: true }).click()
    await pa.getByRole('button', { name: '以我的版本覆蓋…', exact: true }).click()
    await pa.getByRole('button', { name: '覆蓋', exact: true }).click()
    await expect.poll(() => readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(mine)
    await expect(save(pa)).toBeDisabled()
    await expect
      .poll(async () => (await drafts(pb)).find((item) => item.key === 'system_prompt')?.draft)
      .toBe(mine)
    const third = 'B 新版\r\n{{YUKI_PERSONA_CORE}}',
      fourth = 'A 可復原的草稿\r\n{{YUKI_PERSONA_CORE}}'
    await edit(pa, fourth)
    await edit(pb, third)
    await save(pb).click()
    await expect(pa.getByRole('button', { name: '放棄我的修改', exact: true })).toBeVisible()
    await pa.getByRole('button', { name: '放棄我的修改', exact: true }).click()
    await expect
      .poll(async () => (await drafts(pa)).find((item) => item.key === 'system_prompt')?.draft)
      .toBe(third)
    await editor(pa).click()
    await pa.keyboard.press('Meta+Z')
    await expect
      .poll(async () => (await drafts(pa)).find((item) => item.key === 'system_prompt')?.draft)
      .toBe(fourth)
    const rebased = (await drafts(pa)).find((item) => item.key === 'system_prompt')!
    expect(rebased.baseContent).toBe(third)
    await pa.keyboard.press('Meta+Shift+Z')
    await expect
      .poll(async () => (await drafts(pa)).find((item) => item.key === 'system_prompt')?.draft)
      .toBe(third)
    const merged = 'B 新版上合併的草稿\r\n{{YUKI_PERSONA_CORE}}',
      remoteMerge = 'B 新版待合併\r\n{{YUKI_PERSONA_CORE}}'
    await edit(pa, merged)
    await edit(pb, remoteMerge)
    await save(pb).click()
    await pa.getByRole('button', { name: '比較差異', exact: true }).click()
    await pa.getByRole('button', { name: '在新版上重新編輯', exact: true }).click()
    await expect
      .poll(
        async () => (await drafts(pa)).find((item) => item.key === 'system_prompt')?.baseContent,
      )
      .toBe(remoteMerge)
    expect((await drafts(pa)).find((item) => item.key === 'system_prompt')?.draft).toBe(merged)
    await save(pa).click()
    await expect.poll(() => readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(merged)
    await edit(pa, '保留但還未送出\r\n{{YUKI_PERSONA_CORE}}')
    await pa.getByRole('tab', { name: 'persona.md', exact: true }).click()
    await expect(pa.getByRole('dialog', { name: '要儲存變更嗎？' })).toBeVisible()
    await pa.getByRole('button', { name: '取消', exact: true }).click()
    await expect(editor(pa)).toBeVisible()
    await pa.getByRole('tab', { name: 'persona.md', exact: true }).click()
    await pa.getByRole('dialog').getByRole('button', { name: '不儲存', exact: true }).click()
    await expect(editor(pa, 'persona')).toBeVisible()
    await edit(pa, 'PERSONA 修改\n真實角色資料', 'persona')
    await pa.keyboard.press('Meta+S')
    await expect
      .poll(() => readFile(join(rig.root, 'persona.md'), 'utf8'))
      .toBe('PERSONA 修改\n真實角色資料')
    await pa.keyboard.press('Meta+F')
    await expect(pa.locator('.cm-search input[name="search"]')).toBeVisible()
    await pa.locator('.cm-search input[name="search"]').fill('修改')
    await pa.locator('.cm-search input[name="search"]').press('Enter')
    await expect(pa.locator('.cm-searchMatch')).toHaveCount(1)
    await pa.keyboard.press('Escape')
    await expect(pa.locator('.cm-search')).not.toBeVisible()
    await edit(pa, '離頁前未儲存', 'persona')
    await pa.keyboard.press('Meta+,')
    await expect(pa.getByRole('dialog', { name: '要儲存變更嗎？' })).toBeVisible()
    await pa.getByRole('dialog').getByRole('button', { name: '不儲存', exact: true }).click()
    await expect(pa.getByRole('switch', { name: '永遠不透明', exact: true })).toBeVisible()
    await pa.getByRole('button', { name: '返回', exact: true }).click()
    await open(pa)
    await pa.getByRole('tab', { name: 'persona.md', exact: true }).click()
    await edit(pa, '離頁前未儲存', 'persona')
    await pa.getByRole('button', { name: '設定', exact: true }).click()
    await expect(pa.getByRole('dialog', { name: '要儲存變更嗎？' })).toBeVisible()
    await pa.getByRole('button', { name: '取消', exact: true }).click()
    await a.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    await expect(pa.getByRole('dialog', { name: '要儲存變更嗎？' })).toBeVisible()
    await pa.getByRole('button', { name: '取消', exact: true }).click()
    expect(a.windows()).toHaveLength(1)
    await pa
      .locator('[data-region="toolbar"]')
      .getByRole('button', { name: '關於 Yuki', exact: true })
      .click()
    await pa.getByRole('dialog').getByRole('button', { name: '儲存', exact: true }).click()
    await expect(pa.getByRole('button', { name: '編輯提示詞', exact: true })).toBeVisible()
    expect(await readFile(join(rig.root, 'persona.md'), 'utf8')).toBe('離頁前未儲存')
    const afterFacts = await (await fetch(`${rig.base}/__test/prompt-facts`)).json()
    expect(afterFacts.events).toBe(beforeFacts.events)
    expect(afterFacts.presences).toEqual(beforeFacts.presences)
    expect(await memories(pa)).toEqual(beforeMemories)
    expect(await connection(pa)).toEqual(beforeConnection)
    await pa.getByRole('button', { name: '對話', exact: true }).click()
    await pa.getByRole('textbox', { name: '和 Yuki 說點什麼' }).fill('驗證新前綴')
    await pa.getByRole('button', { name: '送出', exact: true }).click()
    await expect(pa.getByText('真實帳本回覆', { exact: true })).toHaveCount(2)
    const facts = await (await fetch(`${rig.base}/__test/prompt-facts`)).json()
    expect(facts.prefixes.at(-1)).toContain('B 新版')
    expect(facts.prefixes.at(-1)).toContain('離頁前未儲存')
    await open(pa)
    const visualContent = [
      '# 提示詞驗證',
      ...Array.from(
        { length: 56 },
        (_, index) =>
          `資料來源 ${index + 1}：使用目前角色的真實來源與原工作回執。 [文件](https://example.invalid/reference)`,
      ),
      '{{YUKI_PERSONA_CORE}}',
    ].join('\r\n')
    await edit(pa, visualContent)
    await save(pa).click()
    await expect(editor(pa)).toHaveAttribute('aria-readonly', 'false')
    for (const mode of ['light', 'dark', 'opaque', 'contrast'] as const) {
      await a.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900),
      )
      await expect.poll(() => pa.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 900])
      await pa.getByRole('button', { name: '設定', exact: true }).click()
      await pa.getByRole('tab', { name: mode === 'dark' ? '深色' : '淺色', exact: true }).click()
      for (const [label, checked] of [
        ['永遠不透明', mode === 'opaque'],
        ['增加對比', mode === 'contrast'],
        ['減少動態', true],
      ] as const) {
        const toggle = pa.getByRole('switch', { name: label, exact: true })
        if ((await toggle.getAttribute('aria-checked')) !== String(checked)) await toggle.click()
      }
      await pa.getByRole('button', { name: '返回', exact: true }).click()
      await open(pa)
      for (const [width, height] of [
        [1440, 900],
        [1100, 760],
        [960, 492],
      ] as const) {
        await a.evaluate(
          ({ BrowserWindow }, size) => {
            const win = BrowserWindow.getAllWindows()[0]!
            win.setMinimumSize(960, 492)
            win.setContentSize(size.width, size.height)
          },
          { width, height },
        )
        await expect
          .poll(() => pa.evaluate(() => [innerWidth, innerHeight]))
          .toEqual([width, height])
        await expect(save(pa)).toBeInViewport({ ratio: 1 })
        await expect(editor(pa)).toBeVisible()
        await expect(editor(pa)).toHaveCSS('font-size', '13px')
        await expect(editor(pa)).toHaveCSS('line-height', '22px')
        await pa.screenshot({
          path: test.info().outputPath(`darwin-2x-${mode}-prompts-${width}x${height}.png`),
          animations: 'disabled',
        })
      }
    }
    await a.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900),
    )
    await expect.poll(() => pa.evaluate(() => [innerWidth, innerHeight])).toEqual([1440, 900])
    await edit(pa, '撤銷擁有者時仍保留的本機草稿\r\n{{YUKI_PERSONA_CORE}}')
    await fetch(`${rig.base}/__test/revoke-character-owner`, { method: 'POST' })
    await expect(editor(pa)).not.toBeVisible()
    await pa.getByRole('button', { name: '對話', exact: true }).click()
    await expect(pa.getByRole('textbox', { name: '和 Yuki 說點什麼' })).toBeVisible()
    expect(errors).toEqual([])
    success = true
  } finally {
    a.process().kill('SIGKILL')
    b.process().kill('SIGKILL')
    await a.close().catch(() => {})
    await b.close().catch(() => {})
    await rig.close(success)
  }
})

test('prompt drafts survive an App crash and an original running write resumes after a real backend crash', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture({ character: true, prompts: true })
  let app = await rig.launch('prompt-cold'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await open(page)
    const content = '冷啟動草稿\r\n{{YUKI_PERSONA_CORE}}'
    await edit(page, content)
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    app = await rig.launch('prompt-cold')
    page = await app.firstWindow()
    await open(page)
    await expect(page.getByRole('dialog', { name: '恢復未儲存的草稿？' })).toBeVisible()
    await page.getByRole('button', { name: '恢復草稿', exact: true }).click()
    expect((await drafts(page)).find((item) => item.key === 'system_prompt')?.draft).toBe(content)
    await fetch(`${rig.base}/__test/crash-after-prompt-write`, { method: 'POST' })
    await save(page).click()
    await expect.poll(async () => (await commands(page)).at(-1)?.state).toBe('submitted')
    await expect.poll(() => readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(content)
    const original = (await commands(page)).at(-1)!,
      inode = (await stat(join(rig.root, 'system_prompt.md'))).ino
    await rig.restart()
    await expect
      .poll(
        async () =>
          (await commands(page)).find((item) => item.requestId === original.requestId)?.state,
        { timeout: 20000 },
      )
      .toBe('result')
    expect((await commands(page)).filter((item) => item.command.kind === 'save')).toHaveLength(1)
    expect((await stat(join(rig.root, 'system_prompt.md'))).ino).toBe(inode)
    await expect(save(page)).toBeDisabled()
    const next = '回應遺失後由原回執確認\r\n{{YUKI_PERSONA_CORE}}'
    await edit(page, next)
    await fetch(`${rig.base}/__test/lose-next-prompt-response/system_prompt`, { method: 'POST' })
    await save(page).click()
    await expect
      .poll(async () => {
        const item = (await commands(page)).at(-1)
        return item?.state === 'submitted' && !!item.problem
      })
      .toBe(true)
    await expect.poll(() => readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(next)
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    await fetch(`${rig.base}/__test/release-original-queries`, { method: 'POST' })
    app = await rig.launch('prompt-cold')
    page = await app.firstWindow()
    await open(page)
    const recovery = page.getByRole('dialog', { name: '恢復未儲存的草稿？' })
    if (await recovery.isVisible())
      await page.getByRole('button', { name: '恢復草稿', exact: true }).click()
    await expect.poll(async () => (await commands(page)).at(-1)?.state).toBe('result')
    expect((await commands(page)).filter((item) => item.command.kind === 'save')).toHaveLength(2)
    expect(await readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(next)
    await expect(save(page)).toBeDisabled()
    success = true
  } finally {
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('actual invalid companion file reports written but inactive and explicit reload repairs the pair', async () => {
  const rig = await yukiFixture({ character: true, prompts: true }),
    app = await rig.launch('prompt-apply')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await open(page)
    await fetch(`${rig.base}/__test/prompt-external/persona`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    })
    const content = '沒有佔位符仍允許儲存'
    await edit(page, content)
    await save(page).click()
    await expect(page.getByText('已寫入但未生效，請按重新載入。', { exact: true })).toBeVisible()
    expect(await readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(content)
    const command = (await commands(page)).at(-1)!
    expect(command).toMatchObject({
      state: 'result',
      problem: 'precondition_failed',
      details: { written: true },
    })
    await page.getByRole('button', { name: '重新載入', exact: true }).click()
    await expect(
      page.getByText('提示詞文件內容無法載入。請修正伺服器上的兩份文件後再試。', { exact: true }),
    ).toBeVisible()
    await fetch(`${rig.base}/__test/prompt-external/persona`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'REPAIRED_PERSONA' }),
    })
    await page.getByRole('button', { name: '重新載入', exact: true }).click()
    await expect(
      page.getByText('這份提示詞沒有 {{YUKI_PERSONA_CORE}}，人格核心不會被插入。', { exact: true }),
    ).toBeVisible()
    const facts = await (await fetch(`${rig.base}/__test/prompt-facts`)).json()
    expect(facts.active.system_prompt).toBe(
      (await drafts(page)).find((item) => item.key === 'system_prompt')?.remote.revision,
    )
    await expect(save(page)).toBeDisabled()
    const settled = (await drafts(page)).find((item) => item.key === 'system_prompt')!
    expect(settled.draft).toBe(settled.baseContent)
    success = true
  } finally {
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('environment-backed deployment is honestly read-only in the actual editor', async () => {
  const rig = await yukiFixture({ character: true, prompts: 'readonly' }),
    app = await rig.launch('prompt-readonly')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await open(page)
    await expect(page.getByText(/目前的提示詞由 SYSTEM_PROMPT 環境變數提供/)).toBeVisible()
    const before = (await drafts(page)).find((item) => item.key === 'system_prompt')!
    await editor(page).click()
    await page.keyboard.type('must not modify')
    expect((await drafts(page)).find((item) => item.key === 'system_prompt')).toEqual(before)
    await expect(save(page)).toBeDisabled()
    expect(await commands(page)).toHaveLength(0)
    success = true
  } finally {
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('typing during a delayed initial read neither opens recovery nor replaces the newer remote revision', async () => {
  const rig = await yukiFixture({ character: true, prompts: true }),
    a = await rig.launch('prompt-race-a'),
    b = await rig.launch('prompt-race-b')
  let success = false
  try {
    const pa = await a.firstWindow(),
      pb = await b.firstWindow()
    await pairUI(pa, rig.base, await rig.code())
    await pairUI(pb, rig.base, await rig.code())
    await open(pa)
    await open(pb)
    const initial = (await drafts(pa)).find((item) => item.key === 'system_prompt')!
    await pa
      .locator('[data-region="toolbar"]')
      .getByRole('button', { name: '關於 Yuki', exact: true })
      .click()
    await a.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        promptReadFault?: { original: typeof fetch; started: boolean; release?: () => void }
      }
      const fault: { original: typeof fetch; started: boolean; release?: () => void } = {
        original: globalThis.fetch,
        started: false,
        release: undefined as undefined | (() => void),
      }
      state.promptReadFault = fault
      let first = true
      globalThis.fetch = async (input, init) => {
        const response = await fault.original(input, init)
        if (
          first &&
          String(input).endsWith('/client/v1/character/prompts') &&
          (!init?.method || init.method === 'GET')
        ) {
          first = false
          fault.started = true
          await new Promise<void>((resolve) => {
            fault.release = resolve
          })
        }
        return response
      }
    })
    await pa.getByRole('button', { name: '編輯提示詞', exact: true }).click()
    await expect
      .poll(() =>
        a.evaluate(() =>
          Boolean(
            (globalThis as typeof globalThis & { promptReadFault?: { started: boolean } })
              .promptReadFault?.started,
          ),
        ),
      )
      .toBe(true)
    const mine = '第一個字就在讀取期間輸入\r\n{{YUKI_PERSONA_CORE}}',
      theirs = 'B 新遠端版本\r\n{{YUKI_PERSONA_CORE}}'
    await edit(pa, mine)
    await edit(pb, theirs)
    await save(pb).click()
    await expect(pa.getByRole('button', { name: '比較差異', exact: true })).toBeVisible()
    await a.evaluate(() => {
      ;(
        globalThis as typeof globalThis & { promptReadFault?: { release?: () => void } }
      ).promptReadFault?.release?.()
    })
    await expect(editor(pa)).toHaveAttribute('aria-readonly', 'false')
    await expect(pa.getByRole('dialog', { name: '恢復未儲存的草稿？' })).not.toBeVisible()
    expect((await drafts(pa)).find((item) => item.key === 'system_prompt')).toMatchObject({
      baseRevision: initial.baseRevision,
      baseContent: initial.baseContent,
      draft: mine,
      remote: { content: theirs },
    })
    await save(pa).click()
    await expect(
      pa.getByText('儲存未完成：伺服器版本已改變，請先處理差異', { exact: true }),
    ).toBeVisible()
    expect(await readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(theirs)
    success = true
  } finally {
    await a
      .evaluate(() => {
        const state = globalThis as typeof globalThis & {
          promptReadFault?: { original: typeof fetch; release?: () => void }
        }
        if (state.promptReadFault) {
          state.promptReadFault.release?.()
          globalThis.fetch = state.promptReadFault.original
          delete state.promptReadFault
        }
      })
      .catch(() => {})
    a.process().kill('SIGKILL')
    b.process().kill('SIGKILL')
    await a.close().catch(() => {})
    await b.close().catch(() => {})
    await rig.close(success)
  }
})

test('cross-platform LF and CRLF changes preserve raw drafts through discard, undo and the next save', async () => {
  const rig = await yukiFixture({ character: true, prompts: true }),
    app = await rig.launch('prompt-newlines')
  let success = false
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await open(page)
    const mine = '原有 CRLF 草稿\r\n{{YUKI_PERSONA_CORE}}',
      remote = '遠端 LF 版本\n{{YUKI_PERSONA_CORE}}'
    await edit(page, mine)
    const external = await fetch(`${rig.base}/__test/prompt-external/system_prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: remote }),
    })
    expect(external.status).toBe(200)
    const reloaded = await fetch(`${rig.base}/__test/prompt-operator-reload`, { method: 'POST' })
    expect(reloaded.status).toBe(200)
    await page.getByRole('button', { name: '放棄我的修改', exact: true }).click()
    await expect
      .poll(async () => (await drafts(page)).find((item) => item.key === 'system_prompt')?.draft)
      .toBe(remote)
    await editor(page).click()
    await page.keyboard.press('Meta+Z')
    await expect
      .poll(async () => (await drafts(page)).find((item) => item.key === 'system_prompt')?.draft)
      .toBe(mine)
    expect((await drafts(page)).find((item) => item.key === 'system_prompt')?.baseContent).toBe(
      remote,
    )
    await page.keyboard.press('Meta+Shift+Z')
    await expect
      .poll(async () => (await drafts(page)).find((item) => item.key === 'system_prompt')?.draft)
      .toBe(remote)
    const next = '從 LF 繼續編輯\n{{YUKI_PERSONA_CORE}}\n新增一行'
    await edit(page, next)
    await save(page).click()
    await expect.poll(() => readFile(join(rig.root, 'system_prompt.md'), 'utf8')).toBe(next)
    success = true
  } finally {
    app.process().kill('SIGKILL')
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('a crashed renderer can quit normally and reopen the original unsaved draft', async () => {
  const rig = await yukiFixture({ character: true, prompts: true })
  let app = await rig.launch('prompt-renderer-crash'),
    success = false,
    appProcess = app.process()
  try {
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await open(page)
    const content = 'Renderer 崩潰仍屬於原入口的草稿\r\n{{YUKI_PERSONA_CORE}}'
    await edit(page, content)
    const crashed = page.waitForEvent('crash')
    await (
      await app.browserWindow(page)
    ).evaluate((win) => win.webContents.forcefullyCrashRenderer())
    await crashed
    await app
      .evaluate(({ app }) => {
        app.quit()
      })
      .catch(() => {})
    await expect.poll(() => appProcess.exitCode).toBe(0)
    app = await rig.launch('prompt-renderer-crash')
    appProcess = app.process()
    page = await app.firstWindow()
    await open(page)
    await expect(page.getByRole('dialog', { name: '恢復未儲存的草稿？' })).toBeVisible()
    await page.getByRole('button', { name: '恢復草稿', exact: true }).click()
    expect((await drafts(page)).find((item) => item.key === 'system_prompt')?.draft).toBe(content)
    success = true
  } finally {
    appProcess.kill('SIGKILL')
    await app.close().catch(() => {})
    await rig.close(success)
  }
})
