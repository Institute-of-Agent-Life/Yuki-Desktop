import { navigate } from '../fixtures/navigation'
import { activeCharacterName } from '../fixtures/active-character'
import { expect, test, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AutomationPage, Connection, MemoryPage } from '../../src/shared/api'
import { expectContainedText } from '../fixtures/contained-text'
import { pairUI, waitForMainEnded } from '../fixtures/backend'
import { launchShell } from '../fixtures/shell-app'

async function connection(page: Page) {
  return page.evaluate(async () => {
    const result = await window.yuki.client.connections()
    if (!result.ok || !result.value[0]) throw Error('Original owner missing')
    return result.value[0]
  })
}
async function commands(page: Page, owner: Connection) {
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.characterCommands(id)
    if (!result.ok) throw Error(result.code)
    return result.value
  }, owner.characterId)
}

test('Windows native character data keeps original memory receipts across crashes and rejects stale arrangement changes', async () => {
  test.skip(process.platform !== 'win32', 'Requires an actual Windows interactive desktop')
  const base = process.env.YUKI_DESKTOP_NATIVE_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires a fresh isolated reference server with the character fixture')
  test.setTimeout(180000)
  expect(process.env.YUKI_ELECTRON_EXECUTABLE).toBeTruthy()
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(base!).hostname)
  const data = await mkdtemp(join(tmpdir(), 'yuki-windows-character-data-'))
  const post = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}/__test/${path}`, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    expect(response.ok, await response.clone().text()).toBe(true)
    return response
  }
  const code = async () => ((await (await post('link-code')).json()) as { code: string }).code
  const marker = randomUUID()
  const sourceText = `這是記憶的原始依據 ${marker}`
  const retainedText = `A 保留的修正草稿 ${marker}`
  const otherText = `另一台已核對的修正 ${marker}`
  const recoveredText = `回應遺失後保留同一次修正 ${marker}`
  let a = await launchShell(join(data, 'character-a'))
  let mainA: number | undefined = await a.evaluate(() => process.pid)
  const b = await launchShell(join(data, 'character-b'))
  const mainB = await b.evaluate(() => process.pid)
  const cleanupErrors: unknown[] = []
  const proof: Record<string, unknown> = { data, stages: [] }
  const stages = proof.stages as unknown[]
  const save = () =>
    writeFile(
      test.info().outputPath('windows-character-data.json'),
      JSON.stringify(proof, null, 2) + '\n',
    )
  try {
    let pa = await a.firstWindow()
    const pb = await b.firstWindow()
    await pa.waitForLoadState('domcontentloaded')
    await pb.waitForLoadState('domcontentloaded')
    const native = await a.evaluate(({ app, BrowserWindow }) => ({
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
      pid: mainA,
      browserPid: mainA,
      platform: 'win32',
      arch: 'x64',
      packaged: true,
      executable: process.env.YUKI_ELECTRON_EXECUTABLE,
      sandboxed: true,
      noSandbox: false,
    })
    proof.native = native
    const errors: string[] = []
    pa.on('pageerror', (error) => errors.push(error.message))
    pb.on('pageerror', (error) => errors.push(error.message))
    await pairUI(pa, base!, await code(), 'Windows 記憶主裝置', 20000)
    const owner = await connection(pa)
    const composer = pa.getByRole('textbox', {
      name: `和 ${await activeCharacterName(pa)} 說點什麼`,
    })
    await composer.fill(sourceText)
    await pa.getByRole('button', { name: '送出', exact: true }).click()
    await expect(composer).toHaveValue('')
    const sent = await pa.evaluate(
      async ({ id, text }) => {
        const result = await window.yuki.client.outbox(id)
        if (!result.ok) throw Error(result.code)
        const item = result.value.find((item) => item.body.text === text)
        if (!item?.eventId) throw Error('Original accepted request is missing')
        return { requestId: item.requestId, eventId: item.eventId }
      },
      { id: owner.characterId, text: sourceText },
    )
    const receipt = await waitForMainEnded(pa, owner.characterId, sent.requestId)
    expect(receipt.event_id).toBe(sent.eventId)
    expect(receipt.result_event_ids).toHaveLength(1)
    await expect(
      pa
        .locator(`article[data-event-id="${receipt.result_event_ids![0]}"]`)
        .getByText('Desktop reference reply', { exact: true }),
    ).toBeVisible()
    const seed = await post('character-data')
    const seeded = await seed.json()
    expect(seed.status, JSON.stringify(seeded)).toBe(200)
    expect(seeded.source_event_id).toBe(sent.eventId)
    expect(owner.persistentCredentials).toBe(true)
    proof.owner = owner
    proof.seeded = seeded
    await save()
    await navigate(pa, `關於 ${await activeCharacterName(pa)}`)
    await expect(pa.getByRole('button', { name: '已核對的記錄 52', exact: false })).toBeVisible()
    await expect(pa.getByRole('button', { name: /^已核對的記錄 / })).toHaveCount(50)
    await pa.screenshot({
      path: test.info().outputPath('about-memory.png'),
      animations: 'disabled',
    })
    await pa.getByRole('button', { name: '載入更多記憶' }).click()
    await expect(pa.getByRole('button', { name: /^已核對的記錄 / })).toHaveCount(52)
    await pa.getByRole('button', { name: '已核對的記錄 52', exact: false }).click()
    await pa.getByRole('button', { name: sourceText, exact: true }).click()
    await expect(
      pa.getByRole('textbox', { name: `和 ${await activeCharacterName(pa)} 說點什麼` }),
    ).toBeVisible()
    await expect(pa.locator(`article[data-event-id="${seeded.source_event_id}"]`)).toContainText(
      sourceText,
    )
    await navigate(pa, `關於 ${await activeCharacterName(pa)}`)
    await pairUI(pb, base!, await code(), 'Windows 記憶觀察裝置', 20000)
    const otherOwner = await connection(pb)
    expect(otherOwner.deviceId).not.toBe(owner.deviceId)
    expect(otherOwner.personId).toBe(owner.personId)
    expect(otherOwner.bindingId).toBe(owner.bindingId)
    expect(otherOwner.conversationId).toBe(owner.conversationId)
    proof.otherOwner = otherOwner
    await navigate(pb, `關於 ${await activeCharacterName(pb)}`)
    for (const page of [pa, pb]) {
      await page.getByRole('button', { name: '已核對的記錄 52', exact: false }).click()
      await page.getByRole('button', { name: '更正', exact: true }).click()
    }
    await pa.getByRole('textbox', { name: '更正後的記憶' }).fill(retainedText)
    await pb.getByRole('textbox', { name: '更正後的記憶' }).fill(otherText)
    await pb.getByRole('button', { name: '送出更正' }).click()
    await expect(pb.getByRole('dialog')).not.toBeVisible()
    await pa.getByRole('button', { name: '送出更正' }).click()
    await expect(pa.getByRole('dialog')).toContainText('這則記憶已變更')
    proof.memoryConflictLayout = await expectContainedText(
      pa.getByRole('dialog').getByRole('status'),
    )
    await expect(pa.getByRole('textbox', { name: '更正後的記憶' })).toHaveValue(retainedText)
    await pa.screenshot({ path: test.info().outputPath('windows-memory-conflict.png') })
    await pa.getByRole('button', { name: '重新讀取記憶', exact: true }).click()
    await expect(pa.getByRole('button', { name: new RegExp(`^${otherText}`) })).toBeVisible()
    await pa.getByRole('button', { name: '更正', exact: true }).click()
    await pa.getByRole('textbox', { name: '更正後的記憶' }).fill(recoveredText)
    await post('lose-next-memory-response')
    await pa.getByRole('button', { name: '送出更正' }).click()
    await pa.getByRole('button', { name: '取消', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await commands(pa, owner)).find(
            (item) => item.command.kind === 'memory' && item.command.text === recoveredText,
          )?.state,
      )
      .toBe('submitted')
    const submitted = (await commands(pa, owner)).find(
      (item) => item.command.kind === 'memory' && item.command.text === recoveredText,
    )!
    expect(submitted.state).toBe('submitted')
    stages.push({ stage: 'memory-committed-response-lost', submitted, nativePid: mainA })
    await save()
    const exited = new Promise<void>((resolve) => a.process().once('exit', () => resolve()))
    expect(process.kill(mainA!, 'SIGKILL')).toBe(true)
    mainA = undefined
    await exited
    await a.close()
    await post('release-original-queries')
    a = await launchShell(join(data, 'character-a'))
    mainA = await a.evaluate(() => process.pid)
    pa = await a.firstWindow()
    await expect(
      pa.getByRole('textbox', {
        name: `和 ${await activeCharacterName(pa)} 說點什麼`,
        exact: true,
      }),
    ).toBeVisible()
    expect(await connection(pa)).toEqual(owner)
    pa.on('pageerror', (error) => errors.push(error.message))
    await navigate(pa, `關於 ${await activeCharacterName(pa)}`)
    await expect(pa.getByRole('button', { name: new RegExp(`^${recoveredText}`) })).toBeVisible()
    await expect
      .poll(() =>
        pa.evaluate(async (id) => {
          const result = await window.yuki.client.characterCommands(id)
          return result.ok
            ? result.value
                .filter((item) => item.command.kind === 'memory' && item.problem === null)
                .map((item) => item.state)
            : []
        }, owner.characterId),
      )
      .toEqual(['result'])
    const recovered = await pa.evaluate(
      async ({ id, text }) => {
        const result = await window.yuki.client.read<MemoryPage>(id, {
          kind: 'memory',
          about: 'me',
        })
        return result.ok ? result.value.items.filter((fact) => fact.text === text) : []
      },
      { id: owner.characterId, text: recoveredText },
    )
    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.fact_id).not.toBe(seeded.fact_ids[51])
    const settled = (await commands(pa, owner)).filter(
      (item) => item.requestId === submitted.requestId,
    )
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({
      requestId: submitted.requestId,
      command: submitted.command,
      payloadHash: submitted.payloadHash,
      state: 'result',
      problem: null,
    })
    stages.push({
      stage: 'original-memory-request-recovered-after-real-crash',
      submitted,
      settled: settled[0],
      recovered,
      nativePid: mainA,
    })
    await save()
    await pa.getByRole('button', { name: new RegExp(`^${recoveredText}`) }).click()
    await pa.getByRole('button', { name: '請她忘記這件事' }).click()
    await pa.getByRole('button', { name: '確認忘記' }).click()
    await expect(pa.getByRole('dialog')).not.toBeVisible()
    await expect(pa.getByRole('button', { name: new RegExp(`^${recoveredText}`) })).toHaveCount(0)
    await pa.getByRole('tab', { name: '她自己', exact: true }).click()
    await pa.getByRole('button', { name: /^我會先核對依據/ }).click()
    await expect(pa.getByRole('button', { name: '更正', exact: true })).toHaveCount(0)
    await pa.getByRole('tab', { name: '安排', exact: true }).click()
    await pa.getByRole('button', { name: '暫停', exact: true }).click()
    await expect(pa.getByRole('button', { name: '恢復', exact: true })).toBeVisible()
    await pa.getByRole('button', { name: '恢復', exact: true }).click()
    await expect(pa.getByRole('button', { name: '暫停', exact: true })).toBeVisible()
    const originalArrangement = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.read<AutomationPage>(id, {
        kind: 'automations',
        scope: 'mine',
      })
      if (!result.ok || !result.value.items[0]) throw Error('Original arrangement missing')
      return result.value.items[0]
    }, owner.characterId)
    expect(originalArrangement.automation_id).toBe(seeded.automation_id)
    await pa.getByRole('button', { name: '刪除安排', exact: true }).click()
    await pb.getByRole('tab', { name: '安排', exact: true }).click()
    await pb.getByRole('button', { name: '暫停', exact: true }).click()
    await expect(pb.getByRole('button', { name: '恢復', exact: true })).toBeVisible()
    await pa.getByRole('dialog').getByRole('button', { name: '刪除安排', exact: true }).click()
    await expect(pa.getByRole('dialog')).not.toBeVisible()
    await expect(pa.getByRole('button', { name: '恢復', exact: true })).toBeVisible()
    await expect(
      pa.getByText('資料已在另一台裝置更新，請重新讀取。', { exact: true }),
    ).toBeVisible()
    await pa.getByRole('button', { name: '刪除安排', exact: true }).click()
    await pa.getByRole('dialog').getByRole('button', { name: '刪除安排', exact: true }).click()
    await expect(pa.getByRole('dialog')).not.toBeVisible()
    await expect(pa.getByText('已取消', { exact: true })).toBeVisible()
    const arrangements = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.read<AutomationPage>(id, {
        kind: 'automations',
        scope: 'mine',
      })
      return result.ok ? result.value.items : []
    }, owner.characterId)
    expect(arrangements).toHaveLength(1)
    expect(arrangements[0]?.state).toBe('cancelled')
    expect(arrangements[0]?.automation_id).toBe(originalArrangement.automation_id)
    const staleResume = await pb.evaluate(
      async ({ id, arrangement }) => {
        const result = await window.yuki.client.characterCommand(id, {
          kind: 'automation',
          automationId: arrangement.automation_id,
          expectedRevision: arrangement.revision,
          action: 'resume',
        })
        if (!result.ok) throw Error(result.code)
        return result.value
      },
      { id: owner.characterId, arrangement: originalArrangement },
    )
    expect(staleResume).toMatchObject({ state: 'result', problem: 'version_conflict' })
    await expect(pa.getByText('已取消', { exact: true })).toBeVisible()
    await expect(pa.getByRole('button', { name: '恢復', exact: true })).toHaveCount(0)
    const automationCommands = (await commands(pa, owner)).filter(
      (item) => item.command.kind === 'automation',
    )
    expect(
      automationCommands.some(
        (item) =>
          item.command.kind === 'automation' &&
          item.command.action === 'delete' &&
          item.problem === 'version_conflict',
      ),
    ).toBe(true)
    stages.push({
      stage: 'arrangement-revisions-and-cancellation',
      originalArrangement,
      arrangements,
      automationCommands,
      staleResume,
    })
    await save()
    await pa.screenshot({ path: test.info().outputPath('windows-arrangement-cancelled.png') })
    await pa.getByRole('tab', { name: '能力', exact: true }).click()
    await expect(pa.getByText('目前沒有已啟用的擴充。')).toBeVisible()
    await expect(pa.getByText('目前沒有環境工具清單。')).toBeVisible()
    await pa.getByRole('button', { name: '編輯名稱與簡介' }).click()
    await pa.getByRole('textbox', { name: '名稱', exact: true }).fill('新名稱')
    await pb.getByRole('button', { name: '編輯名稱與簡介' }).click()
    await pb.getByRole('textbox', { name: '名稱', exact: true }).fill('另一裝置的名稱')
    await pb.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(pb.getByRole('heading', { name: '另一裝置的名稱', exact: true })).toBeVisible()
    await pa.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(pa.getByRole('textbox', { name: '名稱', exact: true })).toHaveValue('新名稱')
    await expect(
      pa.getByText('資料已在其他地方更新。你的輸入仍保留，儲存仍使用編輯前的版本。'),
    ).toBeVisible()
    await pa.getByRole('button', { name: '放棄並重新讀取' }).click()
    await pa.getByRole('button', { name: '編輯名稱與簡介' }).click()
    await pa.getByRole('textbox', { name: '名稱', exact: true }).fill('新名稱')
    await pa.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(pa.getByRole('heading', { name: '新名稱', exact: true })).toBeVisible()
    const after = await pa.evaluate(async () => {
      const result = await window.yuki.client.connections()
      return result.ok ? result.value[0] : null
    })
    expect(after?.characterId).toBe(owner.characterId)
    expect(after?.personId).toBe(owner.personId)
    await pa.screenshot({
      path: test.info().outputPath('about-capabilities.png'),
      animations: 'disabled',
    })
    await post('revoke-character-device', { device_id: owner.deviceId })
    const denied = await pa.evaluate(async (id) => {
      const result = await window.yuki.client.read(id, { kind: 'character' })
      return result.ok ? 'unexpected-success' : result.code
    }, owner.characterId)
    expect(denied).toBe('unauthenticated')
    await expect(pa.getByRole('button', { name: '編輯名稱與簡介' })).toHaveCount(0)
    await pb.getByRole('button', { name: '編輯名稱與簡介' }).click()
    await pb.getByRole('textbox', { name: '簡介', exact: true }).fill('另一台有效裝置仍可編輯')
    await pb.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(pb.getByText('另一台有效裝置仍可編輯', { exact: true })).toBeVisible()
    await pb.getByRole('tab', { name: '安排', exact: true }).click()
    await pb.getByRole('tab', { name: '她的安排', exact: true }).click()
    await expect(pb.getByRole('button', { name: '刪除安排', exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
    stages.push({
      stage: 'profile-cas-keeps-identity-and-device-revocation-preserves-other-access',
      after,
    })
    proof.complete = true
    await save()
  } finally {
    await post('release-original-queries').catch((error) => cleanupErrors.push(error))
    for (const pid of [mainA, mainB])
      if (pid)
        try {
          process.kill(pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') cleanupErrors.push(error)
        }
    await a.close().catch((error) => cleanupErrors.push(error))
    await b.close().catch((error) => cleanupErrors.push(error))
    console.log(`Windows native character evidence profile: ${data}`)
  }
  expect(cleanupErrors).toEqual([])
})
