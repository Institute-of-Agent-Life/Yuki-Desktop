import { activeCharacterName } from '../fixtures/active-character'
import { crashElectron } from '../fixtures/electron-process'
import { expect, test } from '@playwright/test'
import { copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Home, Work } from '../../src/shared/api'
import {
  recordBusinessState,
  currentEvents,
  ledgerEvents,
  pairUI,
  currentConnection,
  waitForAcceptedMessage,
  waitForMainEnded,
  waitForWorkState,
  yukiFixture,
} from '../fixtures/backend'
import { forwardProxy } from '../fixtures/forward-proxy'
import { transportGate } from '../fixtures/transport'
import { captureWorkspace, contentSize } from '../fixtures/visual'

test('a real thirty second transport outage preserves the draft and converges another device original events', async () => {
  test.setTimeout(150000)
  const rig = await yukiFixture()
  const gate = await transportGate(rig.base)
  const a = await rig.launch('outage-device-a')
  const b = await rig.launch('outage-device-b')
  let success = false
  try {
    const pa = await a.firstWindow()
    const pb = await b.firstWindow()
    await pairUI(pa, gate.base, await rig.code())
    await pairUI(pb, rig.base, await rig.code())
    const composer = pa.getByRole('textbox', {
      name: `和 ${await activeCharacterName(pa)} 說點什麼`,
      exact: true,
    })
    await composer.fill('斷線之前的原訊息')
    await pa.getByRole('button', { name: '送出', exact: true }).click()
    const connection = await currentConnection(pa)
    const original = await waitForAcceptedMessage(pa, connection.characterId, '斷線之前的原訊息')
    await expect(pa.locator(`article[data-event-id="${original.eventId}"]`)).toContainText(
      '斷線之前的原訊息',
    )
    await expect(pb.getByText('斷線之前的原訊息', { exact: true })).toBeVisible()
    const draft = '三十秒連線中斷仍保留的草稿'
    await composer.fill(draft)
    const started = performance.now()
    gate.disconnect()
    const offline = pa.getByRole('status').filter({ hasText: '無法取得伺服器回應。' }).first()
    await expect(offline).toBeVisible()
    await expect(offline).toContainText('本機內容已保留。')
    await expect(pa.getByRole('button', { name: '重新連線', exact: true })).toBeVisible()
    await pa.getByRole('button', { name: '重新連線', exact: true }).click()
    await expect(composer).toHaveValue(draft)
    await expect(pa.getByText('斷線之前的原訊息', { exact: true })).toHaveCount(1)
    const missed = '另一台裝置在斷線期間送出的原事件'
    await pb
      .getByRole('textbox', { name: `和 ${await activeCharacterName(pb)} 說點什麼`, exact: true })
      .fill(missed)
    await pb.getByRole('button', { name: '送出', exact: true }).click()
    await expect
      .poll(async () => {
        const events = await ledgerEvents(rig.base)
        return events.filter((item) => item.content === missed).length
      })
      .toBe(1)
    await expect(pb.getByText('Desktop reference reply', { exact: true }).first()).toBeVisible({
      timeout: 20000,
    })
    await captureWorkspace(
      a,
      pa,
      'state-chat-offline',
      async () => {
        await pa.keyboard.press('ControlOrMeta+1')
        await expect(offline).toBeVisible()
        await expect(composer).toHaveValue(draft)
      },
      {
        verify: async () => {
          await expect(offline).toBeInViewport({ ratio: 1 })
          await expect(composer).toBeInViewport({ ratio: 1 })
          await expect(pa.getByText(missed, { exact: true })).toHaveCount(0)
        },
      },
    )
    while (performance.now() - started < 30000)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.ceil(30000 - (performance.now() - started))),
      )
    const duration = performance.now() - started
    expect(duration).toBeGreaterThanOrEqual(30000)
    expect(gate.counts.dropped).toBeGreaterThan(0)
    await expect(composer).toHaveValue(draft)
    await expect(pa.getByText(missed, { exact: true })).toHaveCount(0)
    gate.reconnect()
    await expect(pa.getByText(missed, { exact: true })).toHaveCount(1, { timeout: 20000 })
    await expect(offline).toHaveCount(0)
    await expect(pa.getByText('斷線之前的原訊息', { exact: true })).toHaveCount(1)
    await expect(composer).toHaveValue(draft)
    await pa.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    await expect(pb.getByText(draft, { exact: true })).toBeVisible()
    const facts = await ledgerEvents(rig.base)
    for (const text of ['斷線之前的原訊息', missed, draft]) {
      const events = facts.filter((item) => item.content === text)
      expect(events).toHaveLength(1)
      for (const page of [pa, pb])
        await expect(page.locator(`article[data-event-id="${events[0]!.event_id}"]`)).toHaveCount(1)
    }
    const report = test.info().outputPath('transport-outage.json')
    await writeFile(
      report,
      JSON.stringify({ durationMs: duration, ...gate.counts }, null, 2) + '\n',
    )
    await test.info().attach('transport-outage', {
      path: report,
      contentType: 'application/json',
    })
    success = true
  } finally {
    gate.reconnect()
    if (!success)
      for (const [index, app] of [a, b].entries()) {
        await recordBusinessState(await app.firstWindow(), `business-state-${index}.json`).catch(
          console.error,
        )
        await crashElectron(app).catch(() => {})
      }
    await Promise.all([a.close().catch(() => {}), b.close().catch(() => {})])
    await gate.close()
    await rig.close(success)
  }
})

test('an accepted original message remains visible until history catches up without reviving deleted events', async () => {
  const rig = await yukiFixture()
  const proxy = await forwardProxy(rig.base, '/held-history')
  const app = await rig.launch('accepted-before-history')
  let success = false
  let historyPath: string | undefined
  try {
    const page = await app.firstWindow()
    await pairUI(page, proxy.base, await rig.code())
    const connection = await currentConnection(page)
    const name = await activeCharacterName(page)
    const initial = await currentEvents(page)
    await expect(page.locator(`article[data-event-id="${initial.latest_event_id}"]`)).toHaveCount(1)
    historyPath = proxy.calls.find(({ path }) =>
      new URL(path, rig.base).pathname.endsWith(
        `/conversations/${connection.conversationId}/events`,
      ),
    )?.path
    expect(historyPath).toBeDefined()
    proxy.faults.holdResponses.add(historyPath!)
    const heldHistory = proxy.waitForHeldResponse(historyPath!)
    const text = '已接納但尚未同步到歷史的原訊息'
    await page.getByRole('textbox', { name: `和 ${name} 說點什麼`, exact: true }).fill(text)
    await page.getByRole('button', { name: '送出', exact: true }).click()
    const original = await waitForAcceptedMessage(page, connection.characterId, text)
    await heldHistory
    const canonical = page.locator(`article[data-event-id="${original.eventId}"]`)
    await expect(canonical).toHaveCount(0)
    await expect(page.getByText(text, { exact: true })).toHaveCount(1)
    const receipt = await waitForMainEnded(page, connection.characterId, original.requestId)
    expect(receipt.event_id).toBe(original.eventId)
    const verified = await page.evaluate(
      ({ characterId, requestId }) => window.yuki.client.verify(characterId, requestId),
      { characterId: connection.characterId, requestId: original.requestId },
    )
    expect(verified).toMatchObject({
      ok: true,
      value: { state: 'result', eventId: original.eventId, requestId: original.requestId },
    })
    await expect(page.getByText(text, { exact: true })).toHaveCount(1)
    proxy.releaseResponses(historyPath!)
    await expect(canonical).toContainText(text)
    await expect(page.getByText(text, { exact: true })).toHaveCount(1)
    expect(
      proxy.calls.filter(
        ({ method, requestId }) => method === 'POST' && requestId === original.requestId,
      ),
    ).toHaveLength(1)
    expect(
      (await ledgerEvents(rig.base)).filter((event) => event.event_id === original.eventId),
    ).toHaveLength(1)
    for (const eventId of [original.eventId, ...(receipt.result_event_ids ?? [])]) {
      const removed = await fetch(`${rig.base}/__test/events/${eventId}`, { method: 'DELETE' })
      expect(removed.status).toBe(200)
    }
    await page.reload()
    await expect(page.locator(`article[data-event-id="${initial.latest_event_id}"]`)).toHaveCount(1)
    const history = await currentEvents(page)
    expect(Math.max(...history.items.map((event) => event.event_id))).toBeLessThan(original.eventId)
    expect(history.latest_event_id).toBeGreaterThanOrEqual(original.eventId)
    await expect(page.getByText(text, { exact: true })).toHaveCount(0)
    const outbox = await page.evaluate(
      (id) => window.yuki.client.outbox(id),
      connection.characterId,
    )
    expect(outbox).toMatchObject({
      ok: true,
      value: [{ requestId: original.requestId, eventId: original.eventId, state: 'result' }],
    })
    success = true
  } finally {
    if (historyPath) proxy.releaseResponses(historyPath)
    await app.close()
    await proxy.close()
    await rig.close(success)
  }
})

test('two actual devices submit different answers to one work and recover their original receipts', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture()
  const a = await rig.launch('concurrent-input-a')
  const b = await rig.launch('concurrent-input-b')
  let success = false
  let identity:
    { characterId: string; requestId: string; eventId: number; workId: string } | undefined
  const observedCommands: unknown[] = []
  const recordLedger = (events: Awaited<ReturnType<typeof ledgerEvents>>, phase: string) =>
    writeFile(
      test.info().outputPath(`concurrent-${phase}-ledger.json`),
      JSON.stringify(
        {
          observedAt: new Date().toISOString(),
          identity,
          events: events.map(
            ({
              event_id,
              conversation_id,
              author_kind,
              author_person_id,
              direction,
              observed_at,
            }) => ({
              event_id,
              conversation_id,
              author_kind,
              author_person_id,
              direction,
              observed_at,
            }),
          ),
        },
        null,
        2,
      ),
    )
  try {
    const pa = await a.firstWindow()
    const pb = await b.firstWindow()
    await pairUI(pa, rig.base, await rig.code())
    await pairUI(pb, rig.base, await rig.code())
    await fetch(`${rig.base}/__test/work-scenario`, { method: 'POST' })
    await pa
      .getByRole('textbox', { name: `和 ${await activeCharacterName(pa)} 說點什麼`, exact: true })
      .fill('兩台裝置共同補充原工作')
    await pa.getByRole('button', { name: '送出', exact: true }).click()
    const connection = await currentConnection(pa)
    const submitted = await waitForAcceptedMessage(
      pa,
      connection.characterId,
      '兩台裝置共同補充原工作',
    )
    const receipt = await waitForMainEnded(pa, connection.characterId, submitted.requestId)
    expect(receipt.event_id).toBe(submitted.eventId)
    if (!receipt.work) throw Error('Original Work association is missing')
    identity = {
      characterId: connection.characterId,
      requestId: submitted.requestId,
      eventId: submitted.eventId,
      workId: receipt.work.work_id,
    }
    for (const page of [pa, pb])
      await expect(
        page
          .getByRole('article')
          .filter({ has: page.getByRole('heading', { name: '原工作整合測試', exact: true }) })
          .getByText('等你回覆', { exact: true }),
      ).toBeVisible({ timeout: 20000 })
    const original = await pa.evaluate(
      async ({ characterId, workId }) => {
        const home = await window.yuki.client.read<Home>(characterId, { kind: 'home' })
        if (!home.ok || home.value.works.length !== 1) throw Error('Expected one original work')
        const work = home.value.works.find((item) => item.work_id === workId)
        if (!work) throw Error('Original Work is missing from Home')
        return { characterId, work }
      },
      { characterId: connection.characterId, workId: receipt.work.work_id },
    )
    const answers = ['裝置A回答：台北，沿原工作繼續', '裝置B補充：還要保留原版本成果']
    const details = [pa, pb].map((page) =>
      page.getByRole('complementary', { name: '詳情', exact: true }),
    )
    for (const [index, page] of [pa, pb].entries()) {
      await page.keyboard.press('ControlOrMeta+2')
      await page.getByRole('button', { name: /等你回覆.*原工作整合測試/ }).click()
      await details[index]!.getByRole('textbox').fill(answers[index]!)
    }
    // Keep the scripted provider in flight while both real API inputs reach the original mailbox.
    await fetch(`${rig.base}/__test/model-delay/2`, { method: 'POST' })
    await fetch(`${rig.base}/__test/lose-next-work-response/inputs`, { method: 'POST' })
    await Promise.all(
      details.map((detail) =>
        detail.getByRole('button', { name: '傳送給這項工作', exact: true }).click(),
      ),
    )
    for (const [index, page] of [pa, pb].entries())
      await expect
        .poll(
          async () => {
            const result = await page.evaluate(async (id) => {
              const commands = await window.yuki.client.workCommands(id)
              return {
                states: commands.ok ? commands.value.map((item) => [item.state, item.problem]) : [],
                commands: commands.ok
                  ? commands.value.map(({ command, ...item }) => ({
                      ...item,
                      kind: command.kind,
                      workId: command.workId,
                    }))
                  : commands,
              }
            }, original.characterId)
            observedCommands[index] = { observedAt: new Date().toISOString(), ...result }
            return result.states
          },
          { timeout: 20000 },
        )
        .toEqual([['result', null]])
    await writeFile(
      test.info().outputPath('concurrent-accepted-local.json'),
      JSON.stringify({ identity, devices: observedCommands }, null, 2),
    ).catch(console.error)
    await waitForWorkState(pb, original.characterId, original.work.work_id, 'completed')
    for (const detail of details)
      await expect(detail.getByText('已完成', { exact: true })).toBeVisible({ timeout: 20000 })
    const results = await Promise.all(
      [pa, pb].map((page) =>
        page.evaluate(async ({ characterId, work }) => {
          const value = await window.yuki.client.read<Work>(characterId, {
            kind: 'work',
            workId: work.work_id,
          })
          const commands = await window.yuki.client.workCommands(characterId)
          if (!value.ok || !commands.ok) throw Error('Original work or receipt unavailable')
          return { work: value.value, commands: commands.value }
        }, original),
      ),
    )
    expect(results[0]!.work).toEqual(results[1]!.work)
    const finished = results[0]!.work
    expect(finished.work_id).toBe(original.work.work_id)
    expect(finished.conversation_id).toBe(original.work.conversation_id)
    expect(finished.generation).toBe(original.work.generation)
    expect(finished.budget.root_id).toBe(original.work.budget.root_id)
    expect(finished.budget.models).toBeGreaterThanOrEqual(original.work.budget.models)
    expect(finished.budget.tools).toBeGreaterThanOrEqual(original.work.budget.tools)
    const commands = results.flatMap((item) => item.commands)
    expect(new Set(commands.map((item) => item.requestId)).size).toBe(2)
    const receipts = commands.map(({ result }) => {
      if (
        !result ||
        typeof result !== 'object' ||
        !('event_id' in result) ||
        typeof result.event_id !== 'number' ||
        !('input_id' in result) ||
        typeof result.input_id !== 'number'
      )
        throw Error('Missing original input receipt')
      return { eventId: result.event_id, inputId: result.input_id }
    })
    expect(new Set(receipts.map((item) => item.eventId)).size).toBe(2)
    expect(new Set(receipts.map((item) => item.inputId)).size).toBe(2)
    const events = await ledgerEvents(rig.base)
    for (const [index, page] of [pa, pb].entries()) {
      await contentSize(index === 0 ? a : b, page, 1440, 900)
      await page.keyboard.press('ControlOrMeta+1')
      for (const answer of answers) {
        const rows = events.filter((item) => item.content === answer)
        expect(rows).toHaveLength(1)
        await expect(page.locator(`article[data-event-id="${rows[0]!.event_id}"]`)).toHaveCount(1)
      }
      const dpr = await page.evaluate(() => devicePixelRatio)
      const theme = await page.locator('html').getAttribute('data-theme')
      await page.screenshot({
        path: test
          .info()
          .outputPath(
            `${process.platform}-${dpr}x-${theme}-state-concurrent-work-device-${index + 1}.png`,
          ),
      })
    }
    await writeFile(
      test.info().outputPath('concurrent-work.json'),
      JSON.stringify({ original, results }, null, 2) + '\n',
    )
    success = true
    await recordLedger(events, 'final').catch(console.error)
  } finally {
    await writeFile(
      test.info().outputPath(`concurrent-${success ? 'final' : 'failure'}-local.json`),
      JSON.stringify({ identity, devices: observedCommands }, null, 2),
    ).catch(console.error)
    await copyFile(
      join(rig.root, 'server.log'),
      test.info().outputPath(`concurrent-${success ? 'final' : 'failure'}-backend.log`),
    ).catch(console.error)
    for (const [index, app] of [a, b].entries()) {
      await app
        .firstWindow()
        .then((page) => recordBusinessState(page, `business-state-${index}.json`))
        .catch(console.error)
      if (!success) await crashElectron(app).catch(() => {})
    }
    if (!success)
      await ledgerEvents(rig.base)
        .then((events) => recordLedger(events, 'failure'))
        .catch(console.error)
    await Promise.all([a.close().catch(() => {}), b.close().catch(() => {})])
    await rig.close(success)
  }
})
