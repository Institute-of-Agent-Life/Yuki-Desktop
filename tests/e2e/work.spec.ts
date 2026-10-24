import { navigate } from '../fixtures/navigation'
import { expect, test, type Page } from '@playwright/test'
import {
  currentConnection,
  currentEvents,
  pairUI,
  recordBusinessState,
  yukiFixture,
} from '../fixtures/backend'
import type { Home, Work, WorkSteps, OriginalRequest } from '../../src/shared/api'
import { execFile } from 'node:child_process'
import { copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const readThirdWorkSqlite = `
import json, sqlite3, sys
from pathlib import Path

database = sqlite3.connect(Path(sys.argv[1]).resolve().as_uri() + '?mode=ro', uri=True)
database.row_factory = sqlite3.Row
database.execute('BEGIN')
identity = (sys.argv[2],)

def rows(query, parameters=identity):
    return [dict(row) for row in database.execute(query, parameters)]

tree = '''WITH RECURSIVE owned(id) AS (
    SELECT id FROM runtime_work WHERE id=?
    UNION ALL
    SELECT child.id FROM runtime_work child JOIN owned ON child.parent_work_id=owned.id
) '''
facts = {
    'work': rows('SELECT * FROM runtime_work WHERE id=?'),
    'inputs': rows('SELECT * FROM runtime_work_inputs WHERE work_id=? ORDER BY id'),
    'activation_scope': rows('''SELECT scope.* FROM runtime_work_scopes scope
        JOIN runtime_work work ON work.conversation_id=scope.conversation_id WHERE work.id=?'''),
    'recovery': rows('SELECT * FROM runtime_work_recovery WHERE work_id=?'),
    'journal': rows('''SELECT work_id, chain_id, contract, source_revision, phase, payload_json, updated
        FROM runtime_work_journal WHERE work_id=?'''),
    'executions': rows(tree + '''SELECT request_id, run_id, status, source_json, progress_json,
        completion_json, created_at, updated_at,
        (status='waiting' AND run_id IS NOT NULL AND
            coalesce(json_extract(progress_json, '$.ownership'), 'owned')!='observe')
            AS blocks_completion
        FROM sandbox_task_runs WHERE json_extract(source_json, '$.work_id') IN (SELECT id FROM owned)
        ORDER BY request_id'''),
    'children': rows(tree + '''SELECT child.*, work.state,
        (child.owner IS NOT NULL AND child.lease_until>(julianday('now')-2440587.5)*86400
            AND work.state NOT IN ('completed','failed','cancelled')) AS blocks_completion
        FROM runtime_subagents child JOIN runtime_work work ON work.id=child.work_id
        WHERE child.work_id IN (SELECT id FROM owned) AND child.work_id!=?
        ORDER BY child.work_id''', identity + identity),
}
database.close()
print(json.dumps(facts, ensure_ascii=False))
`

test('continues the original work through an actual reply and confirms cancellation with lost command responses', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture(),
    app = await rig.launch('work-device')
  let second: Awaited<ReturnType<typeof rig.launch>> | undefined
  let success = false
  let third: { characterId: string; requestId: string; eventId: number; workId: string } | undefined
  const recordThirdWork = async (page: Page, device: string) => {
    if (!third) return
    const facts = await page.evaluate(async (identity) => {
      const id = identity.characterId
      const commands = await window.yuki.client.workCommands(id)
      const related = commands.ok
        ? commands.value.filter((item) => item.command.workId === identity.workId)
        : []
      const requestIds = new Set([identity.requestId, ...related.map((item) => item.requestId)])
      const [work, steps, requests] = await Promise.all([
        window.yuki.client.read<Work>(id, { kind: 'work', workId: identity.workId }),
        window.yuki.client.read<WorkSteps>(id, { kind: 'steps', workId: identity.workId }),
        Promise.all(
          [...requestIds].map(async (requestId) => ({
            requestId,
            result: await window.yuki.client.read<OriginalRequest>(id, {
              kind: 'request',
              requestId,
            }),
          })),
        ),
      ])
      return { identity, commands, related, work, steps, requests }
    }, third)
    await writeFile(
      test.info().outputPath(`third-work-state-${device}.json`),
      JSON.stringify(facts, null, 2),
    )
  }
  try {
    const page = await app.firstWindow()
    await pairUI(page, rig.base, await rig.code())
    const name = (await currentConnection(page)).name
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await page
      .getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
      .fill('請建立原工作整合測試')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: '原工作整合測試', exact: true }) })
    await expect(card.getByText('等你回覆', { exact: true })).toBeVisible({ timeout: 20000 })
    const original = await page.evaluate(async () => {
      const list = await window.yuki.client.connections()
      if (!list.ok || !list.value[0]) throw new Error('No paired connection')
      const home = await window.yuki.client.read<Home>(list.value[0].characterId, { kind: 'home' })
      if (!home.ok || !home.value.works[0]) throw new Error('No actual work')
      return { characterId: list.value[0].characterId, work: home.value.works[0] }
    })
    await card.getByRole('button', { name: '查看詳情', exact: true }).click()
    const detail = page.getByRole('complementary', { name: '檢視器' })
    await expect(detail.getByText('需要你提供城市', { exact: true }).first()).toBeVisible()
    await detail.getByRole('button', { name: '在對話中回答', exact: true }).click()
    const reply = page.locator('[data-region="content"] [data-work-reply]')
    await reply.getByRole('textbox').fill('台北，請接續原工作')
    await fetch(`${rig.base}/__test/lose-next-work-response/inputs`, { method: 'POST' })
    await reply.getByRole('button', { name: '送出', exact: true }).click()
    await expect(card.getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    const finished = await page.evaluate(async ({ characterId, work }) => {
      const value = await window.yuki.client.read<Work>(characterId, {
        kind: 'work',
        workId: work.work_id,
      })
      if (!value.ok) throw new Error(value.code)
      return value.value
    }, original)
    expect(finished.work_id).toBe(original.work.work_id)
    expect(finished.conversation_id).toBe(original.work.conversation_id)
    expect(finished.generation).toBe(original.work.generation)
    expect(finished.budget.root_id).toBe(original.work.budget.root_id)
    expect(finished.budget.models).toBeGreaterThanOrEqual(original.work.budget.models)
    const facts = (await currentEvents(page)).items
    expect(facts.filter((item) => item.content === '台北，請接續原工作')).toHaveLength(1)
    await page.getByRole('button', { name: '取消回覆工作', exact: true }).click()
    await page.reload()
    await expect(card.getByText('已完成', { exact: true })).toBeVisible()
    const afterReload = await page.evaluate(async (id) => {
      const home = await window.yuki.client.read<Home>(id, { kind: 'home' })
      return home.ok ? home.value.works : null
    }, original.characterId)
    expect(afterReload).toEqual([])
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await page
      .getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
      .fill('再建立一項可取消的工作')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await navigate(page, '工作')
    const row = page.getByRole('button', { name: /等你回覆.*原工作整合測試/ })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.click()
    await detail.getByRole('button', { name: '取消工作', exact: true }).click()
    await page.getByRole('button', { name: '保持執行', exact: true }).click()
    await expect(detail.getByText('等你回覆', { exact: true })).toBeVisible()
    await detail.getByRole('button', { name: '取消工作', exact: true }).click()
    await fetch(`${rig.base}/__test/lose-next-work-response/cancel`, { method: 'POST' })
    await page.getByRole('button', { name: '仍然取消', exact: true }).click()
    await expect(detail.getByText('已取消', { exact: true })).toBeVisible({ timeout: 20000 })
    const cancellation = await page.evaluate(async (id) => {
      const commands = await window.yuki.client.workCommands(id)
      if (!commands.ok) throw Error(commands.code)
      return commands.value.find((item) => item.command.kind === 'cancel')!
    }, original.characterId)
    const cancellationReceipt = () =>
      page.evaluate(
        async ({ id, requestId }) => {
          const value = await window.yuki.client.read<OriginalRequest>(id, {
            kind: 'request',
            requestId,
          })
          if (!value.ok) throw Error(value.code)
          return value.value
        },
        { id: original.characterId, requestId: cancellation.requestId },
      )
    await expect.poll(async () => (await cancellationReceipt()).found).toBe(true)
    await writeFile(
      test.info().outputPath('original-cancellation-receipt.json'),
      JSON.stringify(
        { requestId: cancellation.requestId, receipt: await cancellationReceipt() },
        null,
        2,
      ),
    )
    const cancellationState = await page.evaluate(
      async ({ id, requestId }) => {
        const commands = await window.yuki.client.workCommands(id)
        if (!commands.ok) throw Error(commands.code)
        return commands.value.find((item) => item.requestId === requestId)!.state
      },
      { id: original.characterId, requestId: cancellation.requestId },
    )
    if (cancellationState !== 'result')
      await detail.getByRole('button', { name: '查詢', exact: true }).click()
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const commands = await window.yuki.client.workCommands(id)
          return commands.ok
            ? commands.value.map((item) => [item.command.kind, item.state, item.problem])
            : []
        }, original.characterId),
      )
      .toEqual([
        ['input', 'result', null],
        ['cancel', 'result', null],
      ])
    await page.screenshot({
      animations: 'disabled',
      path: test.info().outputPath('work-cancelled.png'),
    })
    await navigate(page, '對話')
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await page
      .getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true })
      .fill('兩台裝置同時處理的工作')
    await page.getByRole('button', { name: '送出', exact: true }).click()
    await navigate(page, '工作')
    await expect(row).toBeVisible({ timeout: 20000 })
    third = await page.evaluate(async (id) => {
      const outbox = await window.yuki.client.outbox(id)
      if (!outbox.ok) throw Error(outbox.code)
      const sent = outbox.value.find((item) => item.body.text === '兩台裝置同時處理的工作')
      if (!sent) throw Error('Original third Work request is missing')
      const request = await window.yuki.client.read<OriginalRequest>(id, {
        kind: 'request',
        requestId: sent.requestId,
      })
      if (!request.ok) throw Error(request.code)
      const home = await window.yuki.client.read<Home>(id, { kind: 'home' })
      if (!home.ok) throw Error(home.code)
      const work = home.value.works.find((item) => item.trigger_event_id === request.value.event_id)
      if (!request.value.event_id || !work)
        throw Error('Original third Work association is missing')
      return {
        characterId: id,
        requestId: sent.requestId,
        eventId: request.value.event_id,
        workId: work.work_id,
      }
    }, original.characterId)
    await writeFile(
      test.info().outputPath('third-work-identity.json'),
      JSON.stringify(third, null, 2),
    )
    await row.click()
    await detail.getByRole('button', { name: '取消工作', exact: true }).click()
    second = await rig.launch('another-work-device')
    const other = await second.firstWindow()
    await pairUI(other, rig.base, await rig.code())
    await navigate(other, '工作')
    await other.getByRole('button', { name: /等你回覆.*原工作整合測試/ }).click()
    const otherDetail = other.getByRole('complementary', { name: '檢視器' })
    await otherDetail.getByRole('textbox').fill('另一台裝置回答：台北')
    await otherDetail.getByRole('button', { name: '傳送給這項工作', exact: true }).click()
    const thirdInput = await other.evaluate(async ({ characterId, workId }) => {
      const commands = await window.yuki.client.workCommands(characterId)
      return {
        commands,
        input: commands.ok
          ? (commands.value.find(
              (item) =>
                item.command.workId === workId &&
                item.command.kind === 'input' &&
                item.command.text === '另一台裝置回答：台北',
            ) ?? null)
          : null,
      }
    }, third)
    await writeFile(
      test.info().outputPath('third-work-input.json'),
      JSON.stringify({ identity: third, ...thirdInput }, null, 2),
    )
    await expect(otherDetail.getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    // The original confirmation keeps the revision observed before the other device's reply.
    await page.getByRole('button', { name: '仍然取消', exact: true }).click()
    await expect(
      detail.getByText('工作狀態已改變，請確認最新狀態後再取消。', { exact: true }),
    ).toBeVisible()
    await expect(detail.getByText('已完成', { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const commands = await window.yuki.client.workCommands(id)
          return commands.ok ? commands.value.at(-1)?.problem : 'unreadable'
        }, original.characterId),
      )
      .toBe('version_conflict')
    success = true
  } finally {
    // Diagnostic copy only: preserve the same Work's facts before normal fixture cleanup.
    if (third) {
      const facts = await promisify(execFile)(process.env.YUKI_BACKEND_TEST_PYTHON!, [
        '-c',
        readThirdWorkSqlite,
        join(rig.root, 'yuki.sqlite3'),
        third.workId,
      ])
        .then(({ stdout }) => ({ identity: third, sqlite: JSON.parse(stdout) as unknown }))
        .catch((error: Error) => ({
          identity: third,
          error: { name: error.name, message: error.message },
        }))
      await writeFile(
        test.info().outputPath('third-work-sqlite.json'),
        JSON.stringify(facts, null, 2),
      ).catch(console.error)
    }
    await copyFile(
      join(rig.root, 'server.log'),
      test.info().outputPath('backend-server.log'),
    ).catch(console.error)
    for (const [device, instance] of [
      ['a', app],
      ['b', second],
    ] as const) {
      if (!instance) continue
      const page = await instance.firstWindow()
      await recordBusinessState(page, `work-state-${device}.json`).catch(console.error)
      await recordThirdWork(page, device).catch(console.error)
    }
    await second?.close()
    await app.close()
    await rig.close(success)
  }
})
