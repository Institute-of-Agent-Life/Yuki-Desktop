import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { crashElectron } from '../fixtures/electron-process'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { Connection, Home, Work } from '../../src/shared/api'
import {
  recordBusinessState,
  currentEvents,
  pairUI,
  waitForAcceptedMessage,
  waitForMainEnded,
  waitForWorkState,
  yukiFixture,
} from '../fixtures/backend'
import { captureWorkspace, contentSize } from '../fixtures/visual'

const detail = (page: Page) => page.getByRole('complementary', { name: '檢視器', exact: true })
const card = (page: Page, id?: string) =>
  (id ? page.locator(`[data-character-session="${id}"]`) : page).getByRole('article').filter({
    has: page.getByRole('heading', { name: '原工作整合測試', exact: true }),
  })
async function open(page: Page, id?: string) {
  if (id)
    await expect(
      page.locator(`[data-character-session="${id}"] [data-region="toolbar"]`),
    ).toBeVisible()
  await card(page, id).getByRole('button', { name: '查看詳情', exact: true }).click()
}
async function create(page: Page, base: string) {
  expect((await fetch(`${base}/__test/work-scenario`, { method: 'POST' })).ok).toBe(true)
  const connection = await page.evaluate(async (base) => {
    const list = await window.yuki.client.connections()
    if (!list.ok) throw Error(list.code)
    const connection = list.value.find(
      (item) => item.baseUrl.replace(/\/+$/, '') === base.replace(/\/+$/, ''),
    )
    if (!connection) throw Error('Paired role missing')
    return connection
  }, base)
  await page
    .getByRole('textbox', { name: `和 ${connection.name} 說點什麼`, exact: true })
    .fill('請建立原工作整合測試')
  await page.getByRole('button', { name: '送出', exact: true }).click()
  const submitted = await waitForAcceptedMessage(
    page,
    connection.characterId,
    '請建立原工作整合測試',
  )
  const receipt = await waitForMainEnded(page, connection.characterId, submitted.requestId)
  expect(receipt.event_id).toBe(submitted.eventId)
  if (!receipt.work) throw Error('Original Work association is missing')
  await expect(card(page).getByText('等你回覆', { exact: true })).toBeVisible({ timeout: 20000 })
  return page.evaluate(
    async ({ connection, workId }) => {
      const home = await window.yuki.client.read<Home>(connection.characterId, { kind: 'home' })
      if (!home.ok) throw Error(home.code)
      const work = home.value.works.find((item) => item.work_id === workId)
      if (!work) throw Error('Original Work is missing from Home')
      return { connection, work }
    },
    { connection, workId: receipt.work.work_id },
  )
}
async function readWork(page: Page, connection: Connection, work: Work) {
  return page.evaluate(
    async ({ id, workId }) => {
      const value = await window.yuki.client.read<Work>(id, { kind: 'work', workId })
      if (!value.ok) throw Error(value.code)
      return value.value
    },
    { id: connection.characterId, workId: work.work_id },
  )
}
async function diskFault(app: ElectronApplication, path: string, enabled: boolean) {
  await app.evaluate(
    async ({ app }, { path, enabled }) => {
      const { createRequire } = process.getBuiltinModule('node:module')
      const require = createRequire(app.getAppPath() + '/package.json')
      const Database = require('better-sqlite3') as typeof import('better-sqlite3')
      const db = new Database(path)
      try {
        db.exec(
          enabled
            ? "CREATE TRIGGER test_inline_disk_full BEFORE UPDATE ON work_question_drafts BEGIN SELECT RAISE(ABORT,'fixture disk full'); END"
            : 'DROP TRIGGER test_inline_disk_full',
        )
      } finally {
        db.close()
      }
    },
    { path, enabled },
  )
}

test('inline answers and supplements retain distinct multiline drafts, survive a crash and recover a failed atomic send', async () => {
  test.setTimeout(240000)
  const rig = await yukiFixture({ character: true })
  let app = await rig.launch('inline-work'),
    success = false
  try {
    let page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    await contentSize(app, page, 1440, 900)
    const original = await create(page, rig.base)
    await open(page)
    const supplementText = '另外保留的補充草稿\n第二行沒有被壓平',
      answerText = '台北\n請沿原工作接續。'
    let supplement = detail(page).getByRole('textbox', {
      name: '補充給：原工作整合測試',
      exact: true,
    })
    expect(
      await supplement.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        radius: getComputedStyle(element).borderRadius,
      })),
    ).toEqual({ height: 28, radius: '6px' })
    await supplement.fill('另外保留的補充草稿')
    await supplement.press('Shift+Enter')
    await page.keyboard.insertText('第二行沒有被壓平')
    await detail(page).getByRole('button', { name: '回覆', exact: true }).click()
    let answer = detail(page).getByRole('textbox', { name: '回答這個問題', exact: true })
    await expect(answer).toBeFocused()
    await answer.fill('台北')
    await answer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
    await answer.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 })
    await answer.press('Shift+Enter')
    await page.keyboard.insertText('請沿原工作接續。')
    await expect(supplement).toHaveValue(supplementText)
    await expect(answer).toHaveValue(answerText)
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const value = await window.yuki.client.workCommands(id)
          return value.ok ? value.value.length : -1
        }, original.connection.characterId),
      )
      .toBe(0)
    await answer.press('Escape')
    await expect(detail(page).getByRole('button', { name: '回覆', exact: true })).toBeFocused()
    await detail(page).getByRole('button', { name: '回覆', exact: true }).click()
    await expect(answer).toHaveValue(answerText)
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await expect(answer).toBeVisible()
    await expect(answer).toHaveValue(answerText)
    await expect(supplement).toHaveValue(supplementText)
    await captureWorkspace(
      app,
      page,
      'work-inline-answer',
      async () => {
        await expect(answer).toBeVisible()
        await expect(answer).toHaveValue(answerText)
        await expect(supplement).toHaveValue(supplementText)
      },
      {
        verify: async () => {
          await answer.scrollIntoViewIfNeeded()
          await expect(answer).toBeInViewport({ ratio: 1 })
          await expect(
            detail(page).getByRole('button', { name: '送出回答', exact: true }),
          ).toBeInViewport({ ratio: 1 })
        },
      },
    )
    await contentSize(app, page, 1440, 900)
    await crashElectron(app)
    await app.close().catch(() => {})
    app = await rig.launch('inline-work')
    page = await app.firstWindow()
    await open(page)
    await detail(page).getByRole('button', { name: '回覆', exact: true }).click()
    answer = detail(page).getByRole('textbox', { name: '回答這個問題', exact: true })
    supplement = detail(page).getByRole('textbox', { name: '補充給：原工作整合測試', exact: true })
    await expect(answer).toHaveValue(answerText)
    await expect(supplement).toHaveValue(supplementText)
    const box = join(
      rig.root,
      'inline-work',
      'connections',
      original.connection.characterId,
      'outbox',
      original.connection.personId,
      original.connection.bindingId + '.sqlite3',
    )
    await diskFault(app, box, true)
    await detail(page).getByRole('button', { name: '送出回答', exact: true }).click()
    await expect(detail(page).getByText('尚未送出，已保留內容。', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('work-inline-storage-error.png') })
    await expect(answer).toHaveValue(answerText)
    expect((await readWork(page, original.connection, original.work)).state).toBe('waiting_user')
    expect(
      await page.evaluate(async (id) => {
        const result = await window.yuki.client.workCommands(id)
        return result.ok ? result.value : null
      }, original.connection.characterId),
    ).toEqual([])
    await diskFault(app, box, false)
    await fetch(`${rig.base}/__test/lose-next-work-response/inputs`, { method: 'POST' })
    await detail(page).getByRole('button', { name: '送出回答', exact: true }).click()
    const finished = await waitForWorkState(
      page,
      original.connection.characterId,
      original.work.work_id,
      'completed',
    )
    await expect(detail(page).getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    expect(finished.work_id).toBe(original.work.work_id)
    expect(finished.generation).toBe(original.work.generation)
    expect(finished.budget.root_id).toBe(original.work.budget.root_id)
    expect(finished.budget.model_limit).toBe(original.work.budget.model_limit)
    await expect(supplement).toHaveValue(supplementText)
    await expect(supplement).toHaveAttribute('readonly', '')
    await detail(page).getByRole('button', { name: '複製未送出的補充', exact: true }).click()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(supplementText)
    await captureWorkspace(
      app,
      page,
      'work-retained-supplement',
      async () => {
        await expect(supplement).toHaveValue(supplementText)
      },
      {
        verify: async () => {
          await supplement.scrollIntoViewIfNeeded()
          await expect(supplement).toBeInViewport({ ratio: 1 })
        },
      },
    )
    const events = (await currentEvents(page)).items
    expect(events.filter((event) => event.content === answerText)).toHaveLength(1)
    expect(events.filter((event) => event.content === supplementText)).toHaveLength(0)
    success = true
  } finally {
    const page = app.windows()[0]
    if (!success && page)
      await recordBusinessState(page, 'work-inline-business-state.json').catch(console.error)
    await app.close().catch(() => {})
    await rig.close(success)
  }
})

test('another real device can finish the work without discarding this device’s unsent answer, including a cold reopen', async () => {
  test.setTimeout(180000)
  const rig = await yukiFixture(),
    b = await rig.launch('inline-answer-b')
  let a = await rig.launch('inline-answer-a'),
    success = false
  try {
    let pa = await a.firstWindow()
    const pb = await b.firstWindow()
    await pairUI(pa, rig.base, await rig.code())
    await pairUI(pb, rig.base, await rig.code())
    const original = await create(pa, rig.base),
      unsent = '這台裝置尚未送出的原問題回答'
    await open(pa)
    await detail(pa).getByRole('button', { name: '回覆', exact: true }).click()
    await detail(pa).getByRole('textbox', { name: '回答這個問題', exact: true }).fill(unsent)
    await open(pb)
    await detail(pb).getByRole('button', { name: '回覆', exact: true }).click()
    await detail(pb)
      .getByRole('textbox', { name: '回答這個問題', exact: true })
      .fill('另一台裝置回答：台北')
    await detail(pb).getByRole('button', { name: '送出回答', exact: true }).click()
    await waitForWorkState(pb, original.connection.characterId, original.work.work_id, 'completed')
    await expect(detail(pa).getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    await expect(
      detail(pa).getByRole('textbox', { name: '未送出的回答 1', exact: true }),
    ).toHaveValue(unsent)
    await detail(pa).getByRole('button', { name: '複製回答', exact: true }).click()
    expect(await a.evaluate(({ clipboard }) => clipboard.readText())).toBe(unsent)
    await a.close()
    a = await rig.launch('inline-answer-a')
    pa = await a.firstWindow()
    await open(pa)
    await expect(
      detail(pa).getByRole('textbox', { name: '未送出的回答 1', exact: true }),
    ).toHaveValue(unsent)
    const kept = await pa.evaluate(async ({ connection, work }) => {
      const value = await window.yuki.client.workQuestionDrafts(
        connection.characterId,
        work.work_id,
      )
      return value.ok ? value.value : []
    }, original)
    expect(kept).toEqual([
      {
        question: {
          conversationId: original.work.waiting_question!.conversation_id,
          eventId: original.work.waiting_question!.event_id,
        },
        text: unsent,
      },
    ])
    const events = (await currentEvents(pa)).items
    expect(events.filter((event) => event.content === unsent)).toHaveLength(0)
    await pa.screenshot({ path: test.info().outputPath('retained-original-answer.png') })
    success = true
  } finally {
    if (!success)
      await recordBusinessState(await a.firstWindow(), 'business-state-a.json').catch(console.error)
    if (!success)
      await recordBusinessState(await b.firstWindow(), 'business-state-b.json').catch(console.error)
    await a.close().catch(() => {})
    await b.close()
    await rig.close(success)
  }
})

test('two real roles keep both inline draft scopes separate through actual role switches and a cold reopen', async () => {
  test.setTimeout(180000)
  const first = await yukiFixture(),
    second = await yukiFixture()
  let app = await first.launch('inline-role-drafts'),
    success = false
  const fields = async (page: Page, id: string) => {
    await expect(
      page.locator(`[data-character-session="${id}"] [data-region="toolbar"]`),
    ).toBeVisible()
    const answer = detail(page).getByRole('textbox', { name: '回答這個問題', exact: true })
    if (!(await answer.count()))
      await detail(page).getByRole('button', { name: '回覆', exact: true }).click()
    return {
      answer,
      supplement: detail(page).getByRole('textbox', {
        name: '補充給：原工作整合測試',
        exact: true,
      }),
    }
  }
  try {
    let page = await app.firstWindow()
    await pairUI(page, first.base, await first.code())
    const firstWork = await create(page, first.base)
    await open(page, firstWork.connection.characterId)
    let inputs = await fields(page, firstWork.connection.characterId)
    await inputs.answer.fill('只有第一角色的原問題草稿')
    await inputs.supplement.fill('只有第一角色的補充')
    await page.keyboard.press('ControlOrMeta+,')
    await page.getByRole('tab', { name: '所有 Yuki', exact: true }).click()
    await page.getByRole('button', { name: '連接…', exact: true }).click()
    await pairUI(page, second.base, await second.code())
    const secondWork = await create(page, second.base)
    await open(page, secondWork.connection.characterId)
    inputs = await fields(page, secondWork.connection.characterId)
    await expect(inputs.answer).toHaveValue('')
    await expect(inputs.supplement).toHaveValue('')
    await inputs.answer.fill('只有第二角色的原問題草稿')
    await inputs.supplement.fill('只有第二角色的補充')
    await page.keyboard.press('ControlOrMeta+Shift+[')
    inputs = await fields(page, firstWork.connection.characterId)
    await expect(inputs.answer).toHaveValue('只有第一角色的原問題草稿')
    await expect(inputs.supplement).toHaveValue('只有第一角色的補充')
    await page.keyboard.press('ControlOrMeta+Shift+]')
    inputs = await fields(page, secondWork.connection.characterId)
    await expect(inputs.answer).toHaveValue('只有第二角色的原問題草稿')
    await expect(inputs.supplement).toHaveValue('只有第二角色的補充')
    await app.close()
    app = await first.launch('inline-role-drafts')
    page = await app.firstWindow()
    await open(page, secondWork.connection.characterId)
    inputs = await fields(page, secondWork.connection.characterId)
    await expect(inputs.answer).toHaveValue('只有第二角色的原問題草稿')
    await expect(inputs.supplement).toHaveValue('只有第二角色的補充')
    await page.keyboard.press('ControlOrMeta+Shift+[')
    await open(page, firstWork.connection.characterId)
    inputs = await fields(page, firstWork.connection.characterId)
    await expect(inputs.answer).toHaveValue('只有第一角色的原問題草稿')
    await expect(inputs.supplement).toHaveValue('只有第一角色的補充')
    success = true
  } finally {
    if (!success) {
      const page = await app.firstWindow().catch(() => undefined)
      if (page) {
        await page
          .screenshot({ path: test.info().outputPath('role-draft-failure.png') })
          .catch(() => {})
        const facts = await page
          .evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[data-character-session]')].map((root) => ({
              id: root.dataset.characterSession,
              hidden: root.hidden,
              inert: root.inert,
              articles: [...root.querySelectorAll('article')].map((article) => ({
                text: article.textContent?.slice(0, 300),
                rect: article.getBoundingClientRect().toJSON(),
              })),
            })),
          )
          .catch(() => null)
        await writeFile(
          test.info().outputPath('role-draft-failure.json'),
          JSON.stringify(facts, null, 2),
        )
      }
    }
    await app.close()
    await first.close(success)
    await second.close(success)
  }
})
