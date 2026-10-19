import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { Outbox } from '../../src/main/outbox'
import { ExecutorCommands } from '../../src/main/outbox/executor-commands'
import { ExecutorInstallation } from '../../src/main/executor/installation'
import { ExecutorSetup } from '../../src/main/executor/setup'
import { ApiClient } from '../../src/main/api/client'
import type { Me } from '../../src/shared/api'
const owner = {
  characterId: randomUUID(),
  personId: randomUUID(),
  conversationId: randomUUID(),
  bindingId: randomUUID(),
}
const me: Me = {
  person_id: owner.personId,
  source_person_id: owner.personId,
  request_person_id: owner.personId,
  request_scope: owner.personId,
  request_conversation_id: null,
  platform: 'app',
  presence_id: null,
  thread_id: null,
  binding_id: owner.bindingId,
  display_name: '本人',
  conversation_id: owner.conversationId,
  bindings: [
    {
      binding_id: owner.bindingId,
      source_person_id: owner.personId,
      platform: 'app',
      display_name: '',
      status: 'active',
    },
  ],
  devices: [],
}
const roots: { root: string; box: Outbox }[] = []
afterEach(() => {
  for (const row of roots.splice(0)) {
    if (row.box.db.open) row.box.db.close()
    rmSync(row.root, { recursive: true, force: true })
  }
})
const envelope = (data: unknown) => Response.json({ data })
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'yuki-executor-commands-')),
    path = join(root, 'outbox.sqlite3')
  const row = { root, box: new Outbox(path, owner) }
  roots.push(row)
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
  let vault = new ExecutorInstallation(credentials, owner),
    commands = new ExecutorCommands(row.box, vault)
  return {
    root,
    path,
    row,
    vault,
    commands,
    flow: new ExecutorSetup(commands, vault),
    reopen() {
      row.box.db.close()
      row.box = new Outbox(path, owner)
      vault = new ExecutorInstallation(credentials, owner)
      commands = new ExecutorCommands(row.box, vault)
      return { box: row.box, vault, commands, flow: new ExecutorSetup(commands, vault) }
    },
  }
}
function server(env: ReturnType<typeof setup>, losses: string[] = []) {
  const executors = new Map<string, Record<string, unknown>>(),
    receipts = new Map<string, unknown>()
  const actions: string[] = [],
    queries: string[] = [],
    tokens: string[] = []
  const client = new ApiClient(
    'http://localhost',
    'device-only-fixture',
    owner.bindingId,
    '1.0.0-beta.1',
    async (input, init) => {
      const url = String(input)
      if (url.endsWith('/me')) return envelope(me)
      if (url.includes('/requests/')) {
        const id = url.split('/').at(-1)!
        queries.push(id)
        return envelope(receipts.get(id) ?? { found: false })
      }
      if (init?.method === 'POST' && url.endsWith('/executors')) {
        const body = JSON.parse(String(init.body)),
          item = env.row.box.db
            .prepare('SELECT hash FROM executor_commands WHERE request_id=?')
            .get(body.request_id) as { hash: string }
        const id = randomUUID(),
          token = `private-executor-token-${randomUUID()}`,
          metadata = {
            executor_id: id,
            label: body.label,
            platform: body.platform,
            created_at: new Date().toISOString(),
          }
        actions.push(`create:${id}`)
        tokens.push(token)
        executors.set(id, {
          ...metadata,
          online: false,
          claimed: false,
          revision: 1,
          paused: false,
          last_seen_at: null,
          grants: [],
        })
        receipts.set(body.request_id, {
          found: true,
          operation_kind: 'client.executor.create',
          payload_hash: item.hash,
          target: id,
          status: 'succeeded',
          result: metadata,
        })
        if (losses[0] === 'create') {
          losses.shift()
          throw new TypeError('response lost after COMMIT')
        }
        return envelope({ ...metadata, token, replay: false })
      }
      if (init?.method === 'DELETE') {
        const id = url.split('/').at(-1)!,
          body = JSON.parse(String(init.body))
        const item = env.row.box.db
          .prepare('SELECT hash FROM executor_commands WHERE request_id=?')
          .get(body.request_id) as { hash: string }
        const result = {
          executor_id: id,
          revision: 2,
          paused: false,
          grants_digest: '0'.repeat(64),
          grants: [],
        }
        executors.delete(id)
        actions.push(`delete:${id}`)
        receipts.set(body.request_id, {
          found: true,
          operation_kind: 'client.executor.delete',
          payload_hash: item.hash,
          target: id,
          status: 'succeeded',
          result,
        })
        if (losses[0] === 'delete') {
          losses.shift()
          throw new TypeError('delete response lost after COMMIT')
        }
        return envelope(result)
      }
      if (url.endsWith('/executors')) return envelope([...executors.values()])
      throw new Error('unexpected executor route')
    },
  )
  return { client, executors, receipts, actions, queries, tokens }
}
function noSecrets(env: ReturnType<typeof setup>, tokens: string[]) {
  const content = JSON.stringify(env.row.box.db.prepare('SELECT * FROM executor_commands').all())
  for (const token of tokens) {
    expect(content).not.toContain(token)
    for (const suffix of ['', '-wal'])
      if (existsSync(env.path + suffix))
        expect(readFileSync(env.path + suffix).includes(Buffer.from(token))).toBe(false)
  }
}
it('saves the first token only in credentials, returns public state and deduplicates double enable', async () => {
  const env = setup(),
    api = server(env)
  const first = env.flow.enable(api.client, '這台 Mac', 'darwin'),
    second = env.flow.enable(api.client, '這台 Mac', 'darwin')
  expect(second).toBe(first)
  const state = await first
  expect(api.actions).toHaveLength(1)
  expect(env.vault.current()!.token).toBe(api.tokens[0])
  expect(JSON.stringify(state)).not.toContain(api.tokens[0])
  noSecrets(env, api.tokens)
  const restored = env.reopen()
  expect(await restored.flow.enable(api.client, '這台 Mac', 'darwin')).toEqual(state)
  expect(api.actions).toHaveLength(1)
})
it('cold recovery proves original create and delete before replacing an unclaimed orphan', async () => {
  const env = setup(),
    api = server(env, ['create', 'delete'])
  await expect(env.flow.enable(api.client, 'my PC', 'linux')).rejects.toThrow('transport_unknown')
  expect(env.vault.current()).toBeUndefined()
  const originalId = env.commands.list()[0]!.requestId
  const cold = env.reopen()
  await expect(cold.flow.enable(api.client, 'my PC', 'linux')).rejects.toThrow('transport_unknown')
  const revokeId = cold.commands.list().find((item) => item.command.kind === 'delete')!.requestId
  const again = env.reopen()
  const state = await again.flow.enable(api.client, 'my PC', 'linux')
  expect(api.actions.map((value) => value.split(':')[0])).toEqual(['create', 'delete', 'create'])
  expect(api.queries.filter((id) => id === originalId).length).toBeGreaterThan(1)
  expect(api.queries).toContain(revokeId)
  expect(again.commands.get(revokeId).state).toBe('result')
  expect(api.executors.size).toBe(1)
  expect(again.vault.current()!.executorId).toBe(state!.executorId)
  expect(again.vault.current()!.token).toBe(api.tokens[1])
  noSecrets(env, api.tokens)
})
it('does not automatically remove a claimed executor whose local credential is missing', async () => {
  const env = setup(),
    api = server(env, ['create'])
  await expect(env.flow.enable(api.client, 'PC', 'win32')).rejects.toThrow('transport_unknown')
  api.executors.values().next().value!.claimed = true
  await expect(env.flow.enable(api.client, 'PC', 'win32')).rejects.toThrow(
    'executor_credentials_unavailable',
  )
  expect(api.actions).toHaveLength(1)
  expect(api.executors.size).toBe(1)
  noSecrets(env, api.tokens)
})
