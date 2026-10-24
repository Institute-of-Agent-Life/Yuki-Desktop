import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { currentConnection, pairUI, yukiFixture } from '../fixtures/backend'
import { navigate } from '../fixtures/navigation'
import type { OriginalRequest } from '../../src/shared/api'
import type { ConnectorOperation, ConnectorState } from '../../src/shared/connector'
import { nativeProbe } from './native-probe'
import { agents } from './native-navigation'

const execute = promisify(execFile)
type Available = Extract<ConnectorState, { available: true }>
type Installation = {
  dataDirectory: string
  runtime: { executable: string; arguments: string[] }
}
type NativeOperation = {
  id: string
  action: string
  actor_person_id: string
  work_id: string
  run_id: string
  session_id: string
  execution_id: string
  task_status: string
  result: { session_id: string }
  completion: { status: string; text: string } | null
}
type Facts = {
  event_id: number
  work: { id: string; state: string; sent_messages: number; conversation_id: string } | null
  operations: NativeOperation[]
  events: { event_id: string; kind: string; payload: { payload?: { item?: NativeItem } } }[]
  deliveries: {
    operation_id: string
    event_id: number
    original_event_id: number
    conversation_id: string
    original_conversation_id: string
    source_conversation_id: string
    status: string
    author_kind: string
    direction: string
    content: string
  }[]
  connections: { device_id: string; connection_id: string }[]
}
type NativeItem = {
  type: string
  status: string
  exitCode: number
  cwd: string
  command: string
}

async function state(page: Page, id: string): Promise<Available> {
  return page.evaluate(async (id) => {
    const result = await window.yuki.connector.state(id)
    if (!result.ok) throw Error(result.code)
    if (!result.value.available) throw Error('Connector is not installed')
    return result.value
  }, id)
}
async function installation(app: ElectronApplication, profile: string): Promise<Installation> {
  const selected = (await app.evaluate(({ app }) => {
    const { createRequire } = process.getBuiltinModule('node:module')
    const { join } = process.getBuiltinModule('node:path')
    const require = createRequire(join(app.getAppPath(), 'package.json'))
    const Database = require('better-sqlite3')
    const db = new Database(join(app.getPath('userData'), 'desktop.sqlite3'), { readonly: true })
    try {
      const row = db
        .prepare('SELECT value FROM preferences WHERE key=?')
        .get('agent-connector-installation')
      if (!row) throw Error('Missing actual selected installation')
      return JSON.parse(row.value)
    } finally {
      db.close()
    }
  })) as Installation
  const owner = await realpath(profile)
  for (const path of [selected.dataDirectory, selected.runtime.executable]) {
    const part = relative(owner, await realpath(path))
    expect(isAbsolute(part) || part === '..' || part.startsWith('..' + sep)).toBe(false)
  }
  return selected
}
async function cli(selected: Installation, args: string[]) {
  const result = await execute(
    selected.runtime.executable,
    [...selected.runtime.arguments, '--data-dir', selected.dataDirectory, ...args],
    { windowsHide: true, timeout: 45_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  )
  return result.stdout
}
async function python(selected: Installation, script: string, args: string[]) {
  const module = selected.runtime.arguments.indexOf('-m')
  expect(selected.runtime.arguments.slice(module)).toEqual(['-m', 'yuki_agent_connector'])
  const result = await execute(
    selected.runtime.executable,
    [...selected.runtime.arguments.slice(0, module), '-c', script, ...args],
    { windowsHide: true, timeout: 45_000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  )
  return result.stdout
}
async function openOriginal(page: Page, work: string, operation: string) {
  await page.getByRole('button', { name: '重新讀取原操作', exact: true }).click()
  const label = page.getByText(new RegExp(`^prompt\\s*Work ${work} ·`))
  await label.locator('..').getByRole('button', { name: '查看原回執', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: `原操作 ${operation}`, exact: true }),
  ).toBeVisible()
}
async function operation(page: Page, character: string, id: string): Promise<ConnectorOperation> {
  return page.evaluate(
    async ({ character, id }) => {
      const result = await window.yuki.connector.operation(character, id)
      if (!result.ok) throw Error(result.code)
      return result.value
    },
    { character, id },
  )
}

const nativeCleanup = `
import asyncio, json, sys
from pathlib import Path
from yuki_agent_connector.config import Instance
from yuki_agent_connector.drivers.codex import CodexRPC, native_status
async def ignore(message): pass
async def main():
    binary, cwd, session, execution = sys.argv[1:]
    rpc = CodexRPC(Instance(id='isolated-ui-cleanup', driver='codex', label='Isolated UI cleanup', command=binary, cwd=cwd), ignore)
    try:
        async with asyncio.timeout(30):
            await rpc.start()
            thread = (await rpc.call('thread/read', {'threadId':session, 'includeTurns':True}))['thread']
            assert Path(thread['cwd']).resolve() == Path(cwd).resolve()
            turns = [turn['id'] for turn in thread['turns']]
            assert turns == [execution], 'New isolated thread has unexpected native turns'
            status = native_status(thread)
            if status == 'running':
                await rpc.call('turn/interrupt', {'threadId':session, 'turnId':execution})
            await rpc.call('thread/archive', {'threadId':session})
            print(json.dumps({'thread_id':session, 'turn_ids':turns, 'cwd':cwd, 'status_before_cleanup':status, 'archived':True}))
    finally:
        await rpc.stop()
asyncio.run(main())
`

test('one real Codex turn survives Desktop quit and connector disconnection under its original Work and operation', async () => {
  if (process.env.YUKI_REAL_CODEX_UI !== '1')
    throw Error(
      'Explicit paid acceptance requires YUKI_REAL_CODEX_UI=1; ordinary CI never runs tests/live',
    )
  expect(process.platform).toBe('win32')
  const binary = process.env.YUKI_CODEX_BINARY
  expect(binary && isAbsolute(binary)).toBeTruthy()
  expect(process.env.YUKI_BACKEND_TEST_ROOT).toBeTruthy()
  expect(process.env.YUKI_BACKEND_TEST_PYTHON).toBeTruthy()
  const bundled: { version: string; protocol: number } = JSON.parse(
    await readFile('.cache/connector-runtime/manifest.json', 'utf8'),
  )
  const rig = await yukiFixture({ native: true })
  const profile = join(rig.root, 'native-first-use')
  const project = join(rig.root, 'isolated-native-project')
  await mkdir(project)
  const marker = `YUKI_REAL_UI_${randomUUID().replaceAll('-', '')}`
  const release = join(project, 'release')
  const probe = nativeProbe(project, marker)
  const command = probe.command
  await writeFile(probe.path, probe.content, 'utf8')
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(
      `${rig.base}/__test/${path}`,
      body === undefined
        ? undefined
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    )
    expect(response.ok).toBe(true)
    return response.json() as Promise<T>
  }
  let lastFacts: Facts | undefined
  const facts = async () => {
    lastFacts = await request<Facts>('native-facts')
    return lastFacts
  }
  await request('native-scenario', { marker })
  let app = await rig.launch('native-first-use')
  let selected: Installation | undefined
  let original: NativeOperation | undefined
  let page = await app.firstWindow()
  let success = false
  const failures: unknown[] = []
  try {
    await pairUI(page, rig.base, await rig.code())
    const connection = await currentConnection(page)
    await agents(page)
    await page
      .getByRole('textbox', { name: '電腦名稱', exact: true })
      .fill('Isolated live Codex acceptance')
    await page
      .getByRole('checkbox', { name: '我允許這個 Yuki 連接本機 Agent', exact: true })
      .check()
    const connect = page.getByRole('button', { name: '連接本機 Codex', exact: true })
    await connect.click()
    await expect(page.getByText('目前本人', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(connect).toBeEnabled({ timeout: 60_000 })
    selected = await installation(app, profile)
    const candidates = page.getByRole('combobox', { name: 'Codex 安裝', exact: true })
    if (await candidates.count()) {
      const value = await candidates
        .locator('option')
        .evaluateAll(
          (options, command) =>
            options
              .filter((option) => option.textContent?.includes(command))
              .map((option) => (option as HTMLOptionElement).value),
          binary!,
        )
      expect(value).toHaveLength(1)
      await candidates.selectOption(value[0]!)
    } else await expect(page.getByText(binary!, { exact: true })).toBeVisible()
    // Explicit OS-boundary adapter only; current IPC/configuration still run normally.
    await app.evaluate(({ dialog }, project) => {
      const original = dialog.showOpenDialog
      dialog.showOpenDialog = async (...args: Parameters<typeof original>) => {
        const options = args[args.length - 1] as Electron.OpenDialogOptions
        if (!options.properties?.includes('openDirectory'))
          throw Error('Expected the actual project chooser')
        dialog.showOpenDialog = original
        return { canceled: false, filePaths: [project] }
      }
    }, project)
    await page.getByRole('button', { name: '選擇資料夾', exact: true }).click()
    await page.getByRole('button', { name: '使用此專案並啟動背景連接', exact: true }).click()
    await expect
      .poll(async () => (await state(page, connection.characterId)).admission?.connected, {
        timeout: 30_000,
      })
      .toBe(true)
    await expect(page.getByText('Codex 原生連線已建立', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    const connected = await state(page, connection.characterId)
    expect(connected.version).toBe(bundled.version)
    expect(connected.protocol).toBe(bundled.protocol)
    expect(connected.protocol).toBe(3)
    expect(connected.admission?.matched).toBe(true)
    expect(connected.admission?.serverProtocol).toBe(3)
    expect(connected.service).toMatchObject({ installed: true, running: true })
    expect(connected.instances).toHaveLength(1)
    const local = connected.instances[0]!
    expect(resolve(local.command!)).toBe(resolve(binary!))
    expect(resolve(local.cwd!)).toBe(resolve(project))
    const admitted = connected.admission!.instances!.find((item) => item.localId === local.id)!
    expect(admitted).toMatchObject({ online: true, status: 'available' })
    await expect(page.getByText('Codex 原生連線已建立', { exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('first-use-ready.png') })
    await page.getByRole('combobox', { name: '任務 Agent', exact: true }).selectOption(admitted.id)
    const prompt = `${marker}. This is an isolated live acceptance. Work only in ${project}. Before execution, request the native command runner's normal one-command write approval for exactly this command and cwd: ${command}. The script needs to write only inside ${project}. After approval, execute that exact PowerShell command once with this cwd. Copy it verbatim; the existing script writes a marker and waits for a test release file before reading it back. Continue waiting on that same original command as needed. Keep approval limited to this command and directory, without session-wide or persistent policy amendments. Do not run other commands, inspect files outside this directory, access the network, alter configuration or services. After the command returns the marker, finish with exactly ${marker}.`
    await page.getByRole('textbox', { name: '原生任務要求', exact: true }).fill(prompt)
    await page.getByRole('button', { name: '交給 Yuki 執行', exact: true }).click()
    const approvals = new Set<string>()
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const value = await facts()
      original = value.operations.find((item) => item.action === 'prompt')
      if (original) {
        const view = await operation(page, connection.characterId, original.id)
        for (const event of view.events ?? []) {
          if (
            !['permission', 'question'].includes(event.kind) ||
            !event.permission_id ||
            approvals.has(event.permission_id)
          )
            continue
          expect(event.kind).toBe('permission')
          const payload = event.payload as {
            native_method?: string
            native_request?: {
              cwd: string
              commandActions: { command: string }[]
              availableDecisions: string[]
            }
          }
          expect(payload.native_method).toBe('item/commandExecution/requestApproval')
          const approval = payload.native_request!
          expect(resolve(approval.cwd)).toBe(resolve(project))
          expect(approval.commandActions.map((item) => item.command)).toEqual([command])
          expect(approval.availableDecisions).toContain('accept')
          await openOriginal(page, original.work_id, original.id)
          await page.getByRole('button', { name: 'accept', exact: true }).click()
          approvals.add(event.permission_id)
        }
      }
      try {
        if ((await readFile(join(project, 'started.txt'), 'utf8')) === marker) break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    expect(await readFile(join(project, 'started.txt'), 'utf8')).toBe(marker)
    expect(original).toBeTruthy()
    await expect
      .poll(
        async () =>
          (await facts()).operations.find((item) => item.action === 'prompt')?.execution_id,
        { timeout: 30_000 },
      )
      .toBeTruthy()
    const before = await facts()
    expect(before.operations.filter((item) => item.action === 'prompt')).toHaveLength(1)
    original = before.operations.find((item) => item.action === 'prompt')!
    expect(original!.task_status).toBe('waiting')
    expect(original!.completion).toBeNull()
    const owner = (await rig.state()).owner_person_id
    expect(original!.actor_person_id).toBe(owner)
    const outbox = await page.evaluate(async (id) => {
      const value = await window.yuki.client.outbox(id)
      if (!value.ok) throw Error(value.code)
      return value.value
    }, connection.characterId)
    const originalInput = outbox.find((item) => item.body.text === prompt)!
    expect(originalInput.eventId).toBe(before.event_id)
    await expect.poll(async () => (await currentConnection(page)).persistentCredentials).toBe(true)
    const mainPid = await app.evaluate(() => process.pid)
    await app.close()
    await expect
      .poll(() => {
        try {
          process.kill(mainPid, 0)
          return true
        } catch {
          return false
        }
      })
      .toBe(false)
    const background = JSON.parse(await cli(selected, ['status', '--json']))
    expect(background.service).toMatchObject({ installed: true, running: true })
    const oldConnection = before.connections.find((item) => item.device_id === connected.deviceId)!
    expect(await request('native-disconnect', { device_id: connected.deviceId })).toEqual(
      oldConnection,
    )
    await expect
      .poll(
        async () => {
          const id = (await facts()).connections.find(
            (item) => item.device_id === connected.deviceId,
          )?.connection_id
          return typeof id === 'string' && id.length > 0 && id !== oldConnection.connection_id
        },
        { timeout: 30_000 },
      )
      .toBe(true)
    const newConnection = (await facts()).connections.find(
      (item) => item.device_id === connected.deviceId,
    )!
    app = await rig.launch('native-first-use')
    page = await app.firstWindow()
    await expect
      .poll(async () => (await currentConnection(page)).characterId)
      .toBe(connection.characterId)
    await agents(page)
    const recovered = await state(page, connection.characterId)
    expect(recovered.deviceId).toBe(connected.deviceId)
    expect(recovered.instances.map((item) => item.id)).toEqual([local.id])
    await openOriginal(page, original!.work_id, original!.id)
    const resumed = (await facts()).operations.find((item) => item.id === original!.id)!
    expect([resumed.run_id, resumed.session_id, resumed.execution_id]).toEqual([
      original!.run_id,
      original!.session_id,
      original!.execution_id,
    ])
    expect(await operation(page, connection.characterId, original!.id)).toMatchObject({
      id: original!.id,
      work_id: original!.work_id,
    })
    await writeFile(release, 'release only this isolated task', 'utf8')
    await expect
      .poll(async () => (await facts()).work?.state, { timeout: 120_000 })
      .toBe('completed')
    const final = await facts()
    const promptOperations = final.operations.filter((item) => item.action === 'prompt')
    expect(promptOperations).toHaveLength(1)
    const completed = promptOperations[0]!
    expect(completed.id).toBe(original!.id)
    expect(completed.completion).toMatchObject({ status: 'succeeded', text: marker })
    expect(await readFile(join(project, 'result.txt'), 'utf8')).toBe(marker)
    expect(
      (await readFile(join(project, 'invocations.txt'), 'utf8')).trim().split(/\r?\n/),
    ).toEqual([marker])
    const items = final.events.flatMap((event) =>
      event.payload.payload?.item ? [event.payload.payload.item] : [],
    )
    expect(
      items.some(
        (item) =>
          item.type === 'commandExecution' &&
          item.status === 'completed' &&
          item.exitCode === 0 &&
          resolve(item.cwd) === resolve(project),
      ),
    ).toBe(true)
    expect(final.work?.sent_messages).toBe(1)
    expect(final.deliveries).toHaveLength(1)
    const delivery = final.deliveries[0]!
    expect(delivery).toMatchObject({
      status: 'succeeded',
      author_kind: 'yuki',
      direction: 'outbound',
      original_event_id: delivery.event_id,
      conversation_id: connection.conversationId,
      source_conversation_id: connection.conversationId,
      original_conversation_id: connection.conversationId,
    })
    expect(JSON.parse(delivery.content)).toEqual({
      status: 'succeeded',
      text: marker,
      operation_id: original!.id,
    })
    await openOriginal(page, original!.work_id, original!.id)
    await expect(page.getByText(marker, { exact: true }).first()).toBeVisible()
    await navigate(page, '工作')
    await page.getByRole('button', { name: new RegExp(marker) }).click()
    const detail = page.getByRole('complementary', { name: '檢視器', exact: true })
    await expect(detail.getByRole('heading', { name: marker, exact: true })).toBeVisible()
    await expect(detail.getByText('已完成', { exact: true }).first()).toBeVisible()
    const originalReceipt = await page.evaluate(
      async ({ character, requestId }) => {
        const receipt = await window.yuki.client.read<OriginalRequest>(character, {
          kind: 'request',
          requestId,
        })
        if (!receipt.ok) throw Error(receipt.code)
        return receipt.value
      },
      { character: connection.characterId, requestId: originalInput.requestId },
    )
    expect(originalReceipt).toMatchObject({
      found: true,
      operation_kind: 'message',
      target: connection.conversationId,
      payload_hash: originalInput.payloadHash,
      event_id: before.event_id,
      conversation_id: connection.conversationId,
      work: { work_id: original!.work_id, state: 'completed' },
      result_event_ids: [delivery.event_id],
    })
    await agents(page)
    await page.getByRole('button', { name: '讀取原生會話', exact: true }).click()
    const sessions = page.getByRole('combobox', { name: '原生會話', exact: true })
    await expect(sessions.locator(`option[value="${completed.session_id}"]`)).toHaveCount(1)
    await sessions.selectOption(completed.session_id)
    await expect(page.getByRole('button', { name: '接續觀察此會話', exact: true })).toBeEnabled()
    await writeFile(
      test.info().outputPath('native-original-proof.json'),
      JSON.stringify(
        {
          boundary:
            'Directory picker only uses an own Electron OS-boundary adapter; IPC/service/native/task are real. Source app, not installer or public TLS ingress acceptance.',
          native_binary: binary,
          connector_version: connected.version,
          connector_protocol: connected.protocol,
          person_id: owner,
          device_id: connected.deviceId,
          local_instance_id: local.id,
          instance_id: admitted.id,
          request_id: originalInput.requestId,
          payload_hash: originalInput.payloadHash,
          original_receipt: originalReceipt,
          event_id: before.event_id,
          work_id: completed.work_id,
          run_id: completed.run_id,
          operation_id: completed.id,
          session_id: completed.session_id,
          execution_id: completed.execution_id,
          native_session_id: completed.result.session_id,
          original_main_pid: mainPid,
          original_connection_id: oldConnection.connection_id,
          reconnected_connection_id: newConnection.connection_id,
          reconnected: true,
          prompt_operations: 1,
          native_invocations: 1,
          marker,
          sha256: createHash('sha256')
            .update(await readFile(join(project, 'result.txt')))
            .digest('hex'),
          delivery,
          approved_permission_ids: [...approvals],
          actual_command_receipts: items,
        },
        null,
        2,
      ),
    )
    success = true
  } catch (error) {
    failures.push(error)
    try {
      const probes = await Promise.allSettled([
        (async () =>
          Promise.all(
            (await page.locator('[role="alert"], [role="status"]').all()).map((item) =>
              item.ariaSnapshot(),
            ),
          ))(),
        selected ? cli(selected, ['status', '--json']).then(JSON.parse) : Promise.resolve(null),
        selected
          ? python(
              selected,
              `
import json,subprocess,sys
from pathlib import Path
from yuki_agent_connector.service import UserService
data=Path(sys.argv[1]);service=UserService(data/'config.json',data)
name=service.name
command="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $task=Get-ScheduledTask -TaskName '"+name+"' -ErrorAction Stop; $info=Get-ScheduledTaskInfo -TaskName '"+name+"' -ErrorAction Stop; [PSCustomObject]@{exists=$true;state=[string]$task.State;actions=@($task.Actions|Select-Object Execute,Arguments,WorkingDirectory);lastTaskResult=$info.LastTaskResult;lastRunTime=$info.LastRunTime.ToString('o')}|ConvertTo-Json -Depth 4 -Compress"
result=subprocess.run(['powershell','-NoProfile','-NonInteractive','-Command',command],capture_output=True,encoding='utf-8',check=True,creationflags=subprocess.CREATE_NO_WINDOW)
print(json.dumps({'namespace':json.loads(service.describe()),'task':json.loads(result.stdout),'journal_exists':(data/'journal.sqlite3').exists(),'log_exists':(data/'connector.log').exists()}))
`,
              [selected.dataDirectory],
            ).then(JSON.parse)
          : Promise.resolve(null),
      ])
      const recorded = probes.map((probe) =>
        probe.status === 'fulfilled'
          ? probe
          : {
              status: probe.status,
              reason:
                probe.reason instanceof Error
                  ? { name: probe.reason.name, message: probe.reason.message }
                  : String(probe.reason),
            },
      )
      await writeFile(
        test.info().outputPath('native-failure-before-cleanup.json'),
        JSON.stringify(
          {
            error: error instanceof Error ? error.message : String(error),
            ui_banners: recorded[0],
            local_status: recorded[1],
            task: recorded[2],
            facts: lastFacts,
          },
          null,
          2,
        ),
      )
    } catch (diagnosticError) {
      failures.push(diagnosticError)
    }
  } finally {
    try {
      await writeFile(release, 'release cleanup', 'utf8').catch((error) => {
        failures.push(error)
      })
      if (app.process().exitCode === null && app.process().signalCode === null)
        await app.close().catch((error) => {
          failures.push(error)
        })
      let cleaned = false
      try {
        if (selected) {
          const native = lastFacts?.operations.find((item) => item.action === 'prompt')
          try {
            const namespace = JSON.parse(
              await python(
                selected,
                `
import json, sqlite3, sys
from pathlib import Path
from yuki_agent_connector.service import UserService
data=Path(sys.argv[1])
service=UserService(data/'config.json',data)
value=json.loads(service.describe())
if (data/'journal.sqlite3').exists():
    connection=sqlite3.connect('file:'+str(data/'journal.sqlite3')+'?mode=ro',uri=True)
    try:
        value['prompt_operations']=[{'id':row[0],'receipt':json.loads(row[1]) if row[1] else None} for row in connection.execute("SELECT id,receipt FROM operations WHERE json_extract(command,'$.action')='prompt'")]
    finally: connection.close()
print(json.dumps(value))
`,
                [selected.dataDirectory],
              ),
            )
            expect(namespace.name).toMatch(/^yuki-agent-connector-[0-9a-f]{12}$/)
            expect(relative(selected.dataDirectory, namespace.artifact)).toBe('service.xml')
            const before = JSON.parse(await cli(selected, ['status', '--json']))
            if (before.service.installed) await cli(selected, ['service', 'uninstall'])
            const after = JSON.parse(await cli(selected, ['status', '--json']))
            expect(after.service).toMatchObject({ installed: false, running: false })
            // Query only the exact task derived by the current UserService implementation.
            await expect(
              execute('schtasks.exe', ['/Query', '/TN', namespace.name, '/FO', 'LIST'], {
                windowsHide: true,
              }),
            ).rejects.toMatchObject({ code: 1 })
            if (success) {
              expect(namespace.prompt_operations).toHaveLength(1)
              expect(namespace.prompt_operations[0].id).toBe(original!.id)
            }
            await writeFile(
              test.info().outputPath('native-service-cleanup.json'),
              JSON.stringify(
                { ...namespace, dataDirectory: selected.dataDirectory, service: after.service },
                null,
                2,
              ),
            )
          } catch (serviceError) {
            failures.push(serviceError)
          } finally {
            try {
              if (native?.result.session_id && native.execution_id) {
                const cleanup = JSON.parse(
                  await python(selected, nativeCleanup, [
                    binary!,
                    project,
                    native.result.session_id,
                    native.execution_id,
                  ]),
                )
                await writeFile(
                  test.info().outputPath('native-thread-cleanup.json'),
                  JSON.stringify(cleanup, null, 2),
                )
              }
            } catch (nativeError) {
              failures.push(nativeError)
            }
          }
        }
        cleaned = true
      } finally {
        await rig.close(success && cleaned && failures.length === 0)
      }
    } catch (cleanupError) {
      failures.push(cleanupError)
    }
  }
  if (failures.length)
    throw new AggregateError(failures, 'Native UI acceptance and cleanup failures')
})
