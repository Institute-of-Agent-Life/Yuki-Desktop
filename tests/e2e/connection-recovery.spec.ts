import { activeCharacterName } from '../fixtures/active-character'
import { crashElectron } from '../fixtures/electron-process'
import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import type { Home, Work } from '../../src/shared/api'
import { recordBusinessState, ledgerEvents, pairUI, yukiFixture } from '../fixtures/backend'
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
    await expect(pb.getByText('斷線之前的原訊息', { exact: true })).toBeVisible()
    const draft = '三十秒連線中斷仍保留的草稿'
    await composer.fill(draft)
    const started = performance.now()
    gate.disconnect()
    const offline = pa
      .getByRole('status')
      .filter({ hasText: '無法連到伺服器，已保留本機內容。' })
      .first()
    await expect(offline).toBeVisible()
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

test('two actual devices submit different answers to one work and recover their original receipts', async () => {
  test.setTimeout(120000)
  const rig = await yukiFixture()
  const a = await rig.launch('concurrent-input-a')
  const b = await rig.launch('concurrent-input-b')
  let success = false
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
    for (const page of [pa, pb])
      await expect(
        page
          .getByRole('article')
          .filter({ has: page.getByRole('heading', { name: '原工作整合測試', exact: true }) })
          .getByText('等你回覆', { exact: true }),
      ).toBeVisible({ timeout: 20000 })
    const original = await pa.evaluate(async () => {
      const connections = await window.yuki.client.connections()
      if (!connections.ok || !connections.value[0]) throw Error('Missing paired connection')
      const characterId = connections.value[0].characterId
      const home = await window.yuki.client.read<Home>(characterId, { kind: 'home' })
      if (!home.ok || home.value.works.length !== 1) throw Error('Expected one original work')
      return { characterId, work: home.value.works[0]! }
    })
    const answers = ['裝置A回答：台北，沿原工作繼續', '裝置B補充：還要保留原版本成果']
    const details = [pa, pb].map((page) =>
      page.getByRole('complementary', { name: '檢視器', exact: true }),
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
    for (const page of [pa, pb])
      await expect
        .poll(
          () =>
            page.evaluate(async (id) => {
              const commands = await window.yuki.client.workCommands(id)
              return commands.ok ? commands.value.map((item) => [item.state, item.problem]) : []
            }, original.characterId),
          { timeout: 20000 },
        )
        .toEqual([['result', null]])
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
  } finally {
    if (!success)
      for (const [index, app] of [a, b].entries()) {
        await recordBusinessState(await app.firstWindow(), `business-state-${index}.json`).catch(
          console.error,
        )
        await crashElectron(app).catch(() => {})
      }
    await Promise.all([a.close().catch(() => {}), b.close().catch(() => {})])
    await rig.close(success)
  }
})
