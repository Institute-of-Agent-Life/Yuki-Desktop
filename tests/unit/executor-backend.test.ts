import { expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { closeSync, openSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { ApiClient } from '../../src/main/api/client'
import { readStream } from '../../src/main/api/stream'
import { Outbox } from '../../src/main/outbox'
import { ExecutorCommands } from '../../src/main/outbox/executor-commands'
import { ExecutorInstallation } from '../../src/main/executor/installation'
import { ExecutorSetup } from '../../src/main/executor/setup'
import { ExecutorClient, ExecutorProtocol } from '../../src/main/executor/protocol'
import { NativeExecutorEffects } from '../../src/main/executor/effects'
import { ExecutorJournal } from '../../src/main/executor/journal'
import { ExecutorRunner } from '../../src/main/executor/runner'
import type { ExecutorConfig } from '../../src/shared/executor'
import type { Me, Meta } from '../../src/shared/api'
import type { ProductModels as components } from '../../src/shared/product-models'
type PairResult = components['schemas']['PairResult']

const backend = process.env.YUKI_BACKEND_TEST_ROOT,
  python = process.env.YUKI_BACKEND_TEST_PYTHON
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 25))
async function until<T>(read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const value = await read()
    if (value !== undefined) return value
    await pause()
  }
  throw new Error('Timed out waiting for the isolated backend')
}
it.skipIf(!backend || !python)(
  'real Yuki Main and HTTP: immutable content, accepted result loss and cold ack uncertainty',
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'yuki-executor-real-')))
    const port = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('no port')
        server.close(() => resolve(address.port))
      })
    })
    const log = openSync(join(root, 'server.log'), 'w', 0o600)
    const server = spawn(
      python!,
      ['-m', 'tests.support.desktop_reference_server', root, String(port)],
      {
        cwd: backend,
        stdio: ['ignore', log, log],
        env: { ...process.env, YUKI_DESKTOP_EXECUTOR_FIXTURE: '1' },
      },
    )
    const base = `http://127.0.0.1:${port}/role/yuki`,
      controller = new AbortController()
    let box: Outbox | undefined,
      stream: Promise<void> | undefined,
      success = false
    const driver = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(
        `${base}/__test/executor/${path}`,
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
    try {
      await until(async () => {
        try {
          if ((await fetch(`${base}/healthz`)).ok) return true
        } catch {
          /* startup */
        }
      })
      const ready = JSON.parse(await readFile(join(root, 'ready.json'), 'utf8')) as { code: string }
      const publicClient = new ApiClient(base),
        meta = await publicClient.get<Meta>('meta')
      expect(meta.api_revision).toBeGreaterThanOrEqual(5)
      const paired = await publicClient.post<PairResult>('pair', {
        code: ready.code,
        device_label: 'Native integration',
      })
      const api = new ApiClient(base, paired.token),
        me = await api.get<Me>('me')
      const owner = {
        characterId: meta.character.id,
        personId: me.request_person_id,
        bindingId: me.binding_id,
        conversationId: me.conversation_id,
      }
      const database = join(root, 'local-outbox.sqlite3')
      box = new Outbox(database, owner)
      const secrets = new Map<string, string>(),
        credentials = {
          get: (key: string) => secrets.get(key),
          set(key: string, value: string) {
            secrets.set(key, value)
            return true
          },
          remove(key: string) {
            secrets.delete(key)
          },
          canPersist: () => true,
        }
      const installation = new ExecutorInstallation(credentials, owner)
      let commands = new ExecutorCommands(box, installation),
        setup = new ExecutorSetup(commands, installation)
      await driver('loss', { method: 'POST', suffix: '/client/v1/executors', timing: 'after' })
      await expect(setup.enable(api, '本機整合測試', process.platform)).rejects.toThrow('unknown')
      expect(installation.current()).toBeUndefined()
      const lostCreate = commands.list()[0]!.requestId
      box.db.close()
      box = new Outbox(database, owner)
      commands = new ExecutorCommands(box, installation)
      setup = new ExecutorSetup(commands, installation)
      await setup.enable(api, '本機整合測試', process.platform)
      expect(commands.get(lostCreate).state).toBe('result')
      expect(commands.list().filter((item) => item.command.kind === 'delete')).toHaveLength(1)
      expect((await api.get<unknown[]>('executors')).length).toBe(1)
      const installed = installation.current()!,
        folder = join(root, 'granted')
      await mkdir(folder)
      const scope = await installation.choose(folder, '收件匣')
      const grants = [{ capability: 'folder.write', scope }, { capability: 'notify' }]
      installation.consent(grants)
      const exec = new ExecutorClient(base, installed.token),
        protocol = new ExecutorProtocol(exec)
      let config = await exec.get<ExecutorConfig>('config')
      const changed = commands.prepare({
        kind: 'grants',
        executorId: installed.executorId,
        expectedRevision: config.revision,
        grants,
      })
      expect((await commands.run(api, changed.requestId)).problem).toBeNull()
      config = await exec.get<ExecutorConfig>('config')
      expect(config.grants_digest).toBe(
        createHash('sha256').update(JSON.stringify(config.grants)).digest('hex'),
      )
      const effects = new NativeExecutorEffects(
        async () => {
          config = await exec.get<ExecutorConfig>('config')
          return installation.authority(config.grants)
        },
        {
          async openURL() {
            throw new Error('not used')
          },
          async openFile() {
            throw new Error('not used')
          },
          async notify() {
            throw new Error('not used')
          },
        },
        (task) => protocol.content(task),
      )
      const counter = join(root, 'native-effects')
      const observed = {
        execute: async (task: Parameters<typeof effects.execute>[0]) => {
          await appendFile(counter, task.opId + '\n')
          return effects.execute(task)
        },
        observe: (task: Parameters<typeof effects.observe>[0]) => effects.observe(task),
      }
      let journal = new ExecutorJournal(box, installed.executorId),
        runner = new ExecutorRunner(journal, protocol, observed)
      const hints = new Set<string>()
      let synced = false,
        streamProblem: unknown
      stream = readStream(
        exec,
        controller.signal,
        (kind, data) => {
          if (kind === 'sync') {
            synced = true
            for (const id of (data as { pending: string[] }).pending) hints.add(id)
          }
          if (kind === 'operation') hints.add((data as { op_id: string }).op_id)
        },
        'stream',
      ).catch((error) => {
        if (!controller.signal.aborted) streamProblem = error
      })
      await until(async () => {
        if (streamProblem) throw streamProblem
        if (synced) return true
      })
      const artifact = await driver<{ artifact_id: string; version: string }>('artifact', {})
      await driver('loss', { method: 'POST', suffix: '/result', timing: 'after' })
      await driver('script', [
        {
          name: 'local_device',
          arguments: {
            action: 'invoke',
            executor_id: installed.executorId,
            capability: 'folder.write',
            params: { path: '收件匣/report.txt', ...artifact, if_absent: true },
          },
        },
        { name: 'send_message', arguments: { text: '成果已交給本機執行器' } },
      ])
      const request = randomUUID()
      await api.post('messages', {
        request_id: request,
        text: '請將原版本成果寫到我的收件匣',
        attachments: [],
      })
      const opId = await until(async () => hints.values().next().value as string | undefined)
      await expect(runner.run(opId)).rejects.toThrow('unknown')
      expect(await readFile(join(folder, 'report.txt'), 'utf8')).toBe('original immutable bytes')
      expect(journal.get(opId)?.phase).toBe('finished')
      expect((await protocol.get(opId)).state).toBe('succeeded')
      box.db.close()
      box = new Outbox(database, owner)
      journal = new ExecutorJournal(box, installed.executorId)
      runner = new ExecutorRunner(journal, protocol, observed)
      expect(journal.list()).toEqual([opId])
      expect((await runner.run(opId)).state).toBe('succeeded')
      expect(journal.list()).toEqual([])
      expect((await readFile(counter, 'utf8')).trim().split('\n')).toEqual([opId])
      await until(async () => {
        const facts = await driver<{
          operations: { op_id: string; work_id: string | null; person_id: string; state: string }[]
          work_count: number
        }>('state')
        expect(facts.work_count).toBe(0)
        const op = facts.operations.find((item) => item.op_id === opId)
        expect(op?.person_id).toBe(owner.personId)
        expect(op?.work_id).toBeNull()
        const events = (await (await fetch(`${base}/__test/events`)).json()) as {
          text: string
          direction: string
        }[]
        if (
          events.some(
            (event) =>
              event.direction === 'outbound' && event.text.includes('成果已交給本機執行器'),
          )
        )
          return true
      })
      hints.clear()
      await driver('loss', { method: 'POST', suffix: '/ack', timing: 'after' })
      const pending = driver<{ state: string; observation: Record<string, unknown> }>('invoke', {
        person_id: owner.personId,
        arguments: {
          executor_id: installed.executorId,
          capability: 'folder.write',
          params: { path: '收件匣/report.txt', ...artifact, if_absent: true },
        },
      })
      const second = await until(async () => [...hints].find((id) => id !== opId))
      await expect(runner.run(second)).rejects.toThrow('unknown')
      expect(journal.get(second)?.phase).toBe('started')
      expect((await protocol.get(second)).state).toBe('acknowledged')
      box.db.close()
      box = new Outbox(database, owner)
      journal = new ExecutorJournal(box, installed.executorId)
      runner = new ExecutorRunner(journal, protocol, observed)
      expect((await runner.run(second)).state).toBe('unknown')
      const result = await pending
      expect(result.state).toBe('unknown')
      expect(result.observation).toEqual(
        expect.objectContaining({ exists: true, matches_intended: true }),
      )
      expect((await readFile(counter, 'utf8')).trim().split('\n')).toEqual([opId])
      expect(journal.list()).toEqual([])
      const rows = JSON.stringify(box.db.prepare('SELECT * FROM executor_commands').all())
      expect(rows).not.toContain(installed.token)
      expect(rows).not.toContain(folder)
      success = true
    } finally {
      controller.abort()
      await stream
      if (box?.db.open) box.db.close()
      if (server.exitCode === null && server.signalCode === null) {
        const exited = once(server, 'exit')
        server.kill('SIGTERM')
        await exited
      }
      closeSync(log)
      if (success) await rm(root, { recursive: true, force: true })
      else process.stderr.write(`Local executor integration evidence: ${root}\n`)
    }
  },
  90000,
)
