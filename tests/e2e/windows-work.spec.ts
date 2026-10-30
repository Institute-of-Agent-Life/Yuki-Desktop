import { activeCharacterName } from '../fixtures/active-character'
import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Connection, Home, OriginalRequest, Work } from '../../src/shared/api'
import { currentEvents, pairUI } from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { launchShell } from '../fixtures/shell-app'

async function connection(page: Page) {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok || !result.value[0]) throw Error('Original connection missing')
    return result.value[0]
  })
}
async function work(page: Page, owner: Connection, workId: string) {
  return page.evaluate(
    async ({ id, workId }) => {
      const result = await window.yuki.client.read<Work>(id, { kind: 'work', workId })
      if (!result.ok) throw Error(result.code)
      return result.value
    },
    { id: owner.characterId, workId },
  )
}
async function commands(page: Page, owner: Connection) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.workCommands(id)
    if (!result.ok) throw Error(result.code)
    return result.value
  }, owner.characterId)
}
const detail = (page: Page) => page.getByRole('complementary', { name: '詳情', exact: true })
const card = (page: Page) =>
  page.getByRole('article').filter({
    has: page.getByRole('heading', { name: '原工作整合測試', exact: true }),
  })

test('Windows original work survives draft and receipt crashes while the server completes it with the App closed', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires a fresh isolated reference server with the work scenario')
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-original-work-'))
  const proxy = await forwardProxy(base!, '/windows-original-work')
  const post = async (path: string) => {
    const result = await fetch(`${base}/__test/${path}`, { method: 'POST' })
    expect(result.ok).toBe(true)
    return result
  }
  const code = async () => ((await (await post('link-code')).json()) as { code: string }).code
  let app = await launchShell(join(data, 'profile'))
  let mainPid: number | undefined = await app.evaluate(() => process.pid)
  const observer = await launchShell(join(data, 'observer'))
  const observerPid = await observer.evaluate(() => process.pid)
  const cleanupErrors: unknown[] = []
  try {
    let page = await app.firstWindow()
    const otherPage = await observer.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await otherPage.waitForLoadState('domcontentloaded')
    await pairUI(page, proxy.base, await code(), 'Windows 原工作入口', 20000)
    await pairUI(otherPage, base!, await code(), 'Windows 原工作觀察裝置', 20000)
    const owner = await connection(page),
      other = await connection(otherPage)
    expect(owner.persistentCredentials).toBe(true)
    expect(other.deviceId).not.toBe(owner.deviceId)
    expect(other.personId).toBe(owner.personId)
    expect(other.bindingId).toBe(owner.bindingId)
    expect(other.conversationId).toBe(owner.conversationId)
    const native = await app.evaluate(({ app, BrowserWindow }) => ({
      pid: process.pid,
      browserPid: app.getAppMetrics().find((item) => item.type === 'Browser')?.pid,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      executable: app.getPath('exe'),
      sandboxed: app
        .getAppMetrics()
        .find((item) => item.pid === BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId())
        ?.sandboxed,
      noSandbox: app.commandLine.hasSwitch('no-sandbox'),
    }))
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
    await post('work-scenario')
    const marker = randomUUID()
    const trigger = `Windows 原工作與回執恢復 ${marker}`
    const answerText = `台北\n請沿原工作接續 ${marker}`
    const supplementText = `暫未送出的補充\n保留獨立內容 ${marker}`
    await page
      .getByRole('textbox', { name: `和 ${await activeCharacterName(page)} 說點什麼`, exact: true })
      .fill(trigger)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await expect(card(page).getByText('等你回覆', { exact: true })).toBeVisible({ timeout: 20000 })
    const original = await page.evaluate(async (id) => {
      const result = await window.yuki.client.read<Home>(id, { kind: 'home' })
      if (!result.ok || result.value.works.length !== 1) throw Error('Expected one original work')
      return result.value.works[0]!
    }, owner.characterId)
    expect(original.conversation_id).toBe(owner.conversationId)
    expect(original.waiting_question).toBeTruthy()
    const question = {
      conversationId: original.waiting_question!.conversation_id,
      eventId: original.waiting_question!.event_id,
    }
    const proof: Record<string, unknown> = { native, owner, other, original, stages: [] }
    const stages = proof.stages as unknown[]
    const save = () =>
      writeFile(
        test.info().outputPath('windows-original-work.json'),
        JSON.stringify(proof, null, 2) + '\n',
      )
    const reopen = async () => {
      app = await launchShell(join(data, 'profile'))
      mainPid = await app.evaluate(() => process.pid)
      page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      expect(await connection(page)).toEqual(owner)
    }
    const crash = async () => {
      const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
      expect(process.kill(mainPid!, 'SIGKILL')).toBe(true)
      mainPid = undefined
      await exited
      await app.close()
    }
    const persistedDrafts = () =>
      page.evaluate(
        async ({ id, workId, question }) => {
          const supplement = await window.yuki.client.workDraft(id, workId)
          const answer = await window.yuki.client.workDraft(id, workId, undefined, question)
          if (!supplement.ok || !answer.ok) throw Error('Draft read failed')
          return { supplement: supplement.value, answer: answer.value }
        },
        { id: owner.characterId, workId: original.work_id, question },
      )
    await card(page).getByRole('button', { name: '查看詳情', exact: true }).click()
    await detail(page)
      .getByRole('textbox', { name: '補充給：原工作整合測試', exact: true })
      .fill(supplementText)
    await detail(page).getByRole('button', { name: '回覆', exact: true }).click()
    await detail(page).getByRole('textbox', { name: '回答這個問題', exact: true }).fill(answerText)
    await expect.poll(persistedDrafts).toEqual({ supplement: supplementText, answer: answerText })
    expect(await commands(page, owner)).toEqual([])
    stages.push({ stage: 'distinct-drafts-persisted-before-crash', nativePid: mainPid, question })
    await save()
    await page.screenshot({ path: test.info().outputPath('windows-work-waiting-drafts.png') })
    await crash()
    expect((await work(otherPage, other, original.work_id)).state).toBe('waiting_user')
    await reopen()
    await card(page).getByRole('button', { name: '查看詳情', exact: true }).click()
    await expect(
      detail(page).getByRole('textbox', { name: '補充給：原工作整合測試', exact: true }),
    ).toHaveValue(supplementText)
    await detail(page).getByRole('button', { name: '回覆', exact: true }).click()
    await expect(
      detail(page).getByRole('textbox', { name: '回答這個問題', exact: true }),
    ).toHaveValue(answerText)
    await expect.poll(persistedDrafts).toEqual({ supplement: supplementText, answer: answerText })
    // Delay only the scripted provider so its two continuation calls finish after this
    // real desktop process is gone. The production Work/Host/mailbox run unchanged.
    await post('model-delay/3')
    proxy.faults.loseNextSuffix = `/works/${original.work_id}/inputs`
    await detail(page).getByRole('button', { name: '送出回答', exact: true }).click()
    await expect.poll(() => proxy.lostStatuses.length).toBe(1)
    expect(proxy.lostStatuses).toEqual([200])
    const pending = (await commands(page, owner))[0]!
    expect(pending).toMatchObject({
      state: 'submitted',
      command: { kind: 'input', workId: original.work_id, text: answerText },
    })
    const beforeClose = await work(otherPage, other, original.work_id)
    expect(['completed', 'failed', 'cancelled']).not.toContain(beforeClose.state)
    stages.push({
      stage: 'input-committed-response-lost-before-app-death',
      command: pending,
      beforeClose,
      nativePid: mainPid,
    })
    await save()
    await crash()
    await expect
      .poll(async () => (await work(otherPage, other, original.work_id)).state, { timeout: 30000 })
      .toBe('completed')
    const finishedWithoutApp = await work(otherPage, other, original.work_id)
    expect(finishedWithoutApp).toMatchObject({
      work_id: original.work_id,
      conversation_id: original.conversation_id,
      generation: original.generation,
      budget: { root_id: original.budget.root_id, model_limit: original.budget.model_limit },
    })
    expect(finishedWithoutApp.steps_token).not.toBe(original.steps_token)
    await expect(card(otherPage).getByText('已完成', { exact: true })).toBeVisible()
    stages.push({
      stage: 'server-completed-original-work-while-app-closed',
      finished: finishedWithoutApp,
    })
    await save()
    proxy.faults.holdReceipts = false
    await reopen()
    await expect(card(page)).toHaveCount(1)
    await expect(card(page).getByText('已完成', { exact: true })).toBeVisible()
    await expect.poll(async () => (await commands(page, owner))[0]?.state).toBe('result')
    const confirmed = (await commands(page, owner))[0]!
    expect(await commands(page, owner)).toHaveLength(1)
    expect(confirmed).toMatchObject({
      requestId: pending.requestId,
      payloadHash: pending.payloadHash,
      command: pending.command,
      problem: null,
    })
    const receipt = await page.evaluate(
      async ({ id, requestId }) => {
        const result = await window.yuki.client.read<OriginalRequest>(id, {
          kind: 'request',
          requestId,
        })
        if (!result.ok) throw Error(result.code)
        return result.value
      },
      { id: owner.characterId, requestId: pending.requestId },
    )
    expect(receipt).toMatchObject({
      found: true,
      status: 'succeeded',
      target: original.work_id,
      payload_hash: pending.payloadHash,
      result: confirmed.result,
    })
    expect(
      proxy.calls.filter(
        (call) => call.method === 'POST' && call.path.endsWith(`/works/${original.work_id}/inputs`),
      ),
    ).toHaveLength(1)
    expect(proxy.calls.some((call) => call.path.endsWith(`/requests/${pending.requestId}`))).toBe(
      true,
    )
    const drafts = await persistedDrafts()
    expect(drafts).toEqual({ supplement: supplementText, answer: '' })
    const events = (await currentEvents(page)).items
    expect(events.filter((event) => event.content === trigger)).toHaveLength(1)
    expect(events.filter((event) => event.content === answerText)).toHaveLength(1)
    expect(events.filter((event) => event.content === supplementText)).toHaveLength(0)
    expect(
      events.filter(
        (event) => event.direction === 'outbound' && event.content === '已依原工作完成',
      ),
    ).toHaveLength(1)
    await card(page).getByRole('button', { name: '查看詳情', exact: true }).click()
    const supplement = detail(page).getByRole('textbox', {
      name: '補充給：原工作整合測試',
      exact: true,
    })
    await expect(supplement).toHaveValue(supplementText)
    await expect(supplement).toHaveAttribute('readonly', '')
    await expect(detail(page).getByText('已完成', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('windows-work-original-receipt.png') })
    await page.keyboard.press('Control+2')
    const row = page.getByRole('button', { name: /已完成.*原工作整合測試/ })
    await expect(row).toHaveCount(1)
    await row.click()
    await expect(detail(page).getByText('已完成', { exact: true })).toBeVisible()
    expect((await work(page, owner, original.work_id)).work_id).toBe(original.work_id)
    stages.push({
      stage: 'cold-app-reconciled-original-receipt-once',
      confirmed,
      receipt,
      drafts,
      finalWork: await work(page, owner, original.work_id),
      inputPostCount: 1,
    })
    proof.complete = true
    await save()
    await page.screenshot({ path: test.info().outputPath('windows-work-ended-list.png') })
  } finally {
    for (const pid of [mainPid, observerPid])
      if (pid)
        try {
          process.kill(pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') cleanupErrors.push(error)
        }
    await app.close().catch((error) => cleanupErrors.push(error))
    await observer.close().catch((error) => cleanupErrors.push(error))
    await proxy.close()
    console.log(`Windows original work evidence profile: ${data}`)
  }
  expect(cleanupErrors).toEqual([])
})
