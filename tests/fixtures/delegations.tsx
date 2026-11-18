// Delegations and observations (Client API 14) as the server projects them, behind the
// real renderer views: the Works list and detail, and "這台電腦"'s native tasks.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkDetail, WorkList } from '../../src/renderer/views/Works'
import { ConnectorTasks } from '../../src/renderer/views/ConnectorTasks'
import type {
  ApiRead,
  ConversationBridge,
  Connection,
  Work,
  WorkCommand,
  WorkStep,
  WorkSteps,
} from '../../src/shared/api'
import type { ConnectorOperation, ConnectorState } from '../../src/shared/connector'
import '../../src/renderer/tokens.css'
import '../../src/renderer/materials/materials.css'

const params = new URLSearchParams(location.search)
// `legacy=1`: a server before Client API 14 (no delegation fields, no delegation records).
const legacy = params.has('legacy')
const answerMode = params.get('answer')
const revision = Number(params.get('revision') ?? 14)
const delegationsFail = params.has('delegations-fail')
const source = {
  binding_id: 'binding',
  conversation_id: 'conversation',
  display_name: '桌面',
  kind: 'private',
  platform: 'app',
  space_id: null,
}
const base: Work = {
  work_id: 'parent-work',
  goal: '修好登入頁並跑完測試',
  state: 'waiting_external',
  revision: 4,
  updated_at: 1792880000,
  generation: 1,
  child_count: 2,
  conversation_id: 'conversation',
  source,
  result_delivery: source,
  results: [],
  budget: { models: 3, tools: 4, root_id: 'parent-work', model_limit: null, tool_limit: null },
  waiting_kind: null,
  waiting_question: null,
  wait: null,
  help_requested: false,
  step_count: 3,
}
type Delegation = NonNullable<Work['delegation']>
const delegation = (
  work: Partial<Work> & Pick<Work, 'work_id' | 'goal' | 'state'>,
  card: Pick<
    Delegation,
    'executor' | 'relationship' | 'state' | 'status_line' | 'pending' | 'last_event_at'
  >,
): Work => ({
  ...base,
  child_count: 0,
  step_count: 0,
  revision: 2,
  parent_work_id: 'parent-work',
  ...work,
  delegation: { id: work.work_id, ...card },
})
const works: Record<string, Work> = {
  'parent-work': { ...base, parent_work_id: null, delegation: null },
  'deleg-claude': delegation(
    { work_id: 'deleg-claude', goal: '修登入頁的表單驗證', state: 'waiting_user' },
    {
      executor: { device_id: 'dev-mac', agent: 'inst-claude', label: 'Claude Code', session: 's1' },
      relationship: 'delegate',
      state: 'waiting',
      status_line: 'Claude Code 在等待回答（服务器）',
      pending: [
        {
          permission_id: '501',
          kind: 'permission',
          tool: 'Bash',
          options: ['allow', 'deny'],
          operation_id: 'op-claude',
          received_at: '2026-11-18T08:00:00+00:00',
          answer_at: 'yuki_or_user',
        },
      ],
      last_event_at: '2026-11-18T08:00:00+00:00',
    },
  ),
  'deleg-acp': delegation(
    { work_id: 'deleg-acp', goal: '整理 API 文件', state: 'waiting_external' },
    {
      executor: { device_id: 'dev-linux', agent: 'inst-gemini', label: 'Gemini', session: 's2' },
      relationship: 'delegate',
      state: 'running',
      status_line: 'Gemini 正在运行',
      // A wait no operation received, surfaced on the delegation that last held the session.
      pending: [
        {
          permission_id: '801',
          kind: 'permission',
          tool: 'Bash',
          options: ['allow', 'deny'],
          operation_id: null,
          received_at: '2026-11-18T08:03:00+00:00',
          answer_at: 'deny_only',
        },
      ],
      last_event_at: '2026-11-18T08:01:00+00:00',
    },
  ),
  'deleg-codex': delegation(
    {
      work_id: 'deleg-codex',
      goal: '跑完整套測試',
      state: 'waiting_external',
      reason: 'device_offline',
    },
    {
      executor: { device_id: 'dev-linux', agent: 'inst-codex', label: 'Codex', session: 's3' },
      relationship: 'delegate',
      state: 'unknown',
      status_line: 'Codex 状态未知（device_offline）',
      // An answer place this app does not know: shown, never answerable (fails closed).
      pending: [
        {
          permission_id: '701',
          kind: 'permission',
          tool: 'Write',
          options: ['allow', 'deny'],
          operation_id: null,
          received_at: '2026-11-18T07:00:00+00:00',
          answer_at: 'somewhere_else',
        },
      ],
      last_event_at: '2026-11-18T07:00:00+00:00',
    },
  ),
  'observe-claude': delegation(
    {
      work_id: 'observe-claude',
      goal: '觀察終端裡的 Claude Code',
      state: 'waiting_external',
      parent_work_id: null,
    },
    {
      executor: { device_id: 'dev-mac', agent: 'inst-claude', label: 'Claude Code', session: 's4' },
      relationship: 'observe',
      state: 'running',
      status_line: '正在观察 Claude Code 的会话',
      pending: [
        {
          permission_id: '601',
          kind: 'permission',
          tool: 'Edit',
          options: ['allow', 'deny'],
          operation_id: 'op-watch',
          received_at: '2026-11-18T08:02:00+00:00',
          answer_at: 'native_terminal',
        },
      ],
      last_event_at: '2026-11-18T08:02:00+00:00',
    },
  ),
}
const legacyWork = (work: Work): Work => {
  const rest = { ...work }
  delete rest.delegation
  delete rest.parent_work_id
  return rest
}
const step = (id: string, fields: Partial<WorkStep>): WorkStep => ({
  step_id: id,
  category: 'other',
  label: id,
  record: 'committed',
  status: 'succeeded',
  created_at: '2026-11-18T08:00:00Z',
  updated_at: '2026-11-18T08:00:30Z',
  artifacts: [],
  ...fields,
})
const steps: WorkStep[] = [
  step('start', {
    kind: 'task',
    tool: 'start_subtask',
    action: null,
    detail: { record_seconds: 1, subtask_id: 'deleg-acp', relationship: 'delegate' },
  }),
  step('direct', {
    kind: 'task',
    tool: 'message_task',
    action: null,
    detail: { record_seconds: 1, subtask_id: 'deleg-acp', relationship: 'delegate' },
  }),
  step('historical', {
    kind: 'agent_control',
    tool: 'use_coding_agent',
    action: 'prompt',
    detail: { record_seconds: 2, operation_id: 'op-historic' },
  }),
]
const devices = [
  { id: 'dev-mac', label: 'Peter 的 MacBook', online: true },
  { id: 'dev-linux', label: 'Linux 工作站', online: false },
  { id: 'dev-idle', label: 'Windows 桌機', online: true },
]
const permission = (cursor: number, command: string) => ({
  cursor,
  kind: 'permission',
  permission_id: String(cursor),
  payload: {
    tool: 'Bash',
    native_request_id: `native-${cursor}`,
    native_request: { command },
    options: ['allow', 'deny'],
  },
})
const operations: Record<string, ConnectorOperation> = {
  'op-claude': {
    id: 'op-claude',
    work_id: 'deleg-claude',
    instance_id: 'inst-claude',
    session_id: 's1',
    status: 'running',
    action: 'prompt',
    // A persistent option is offered by the native agent; an answer applies to one request.
    events: [
      {
        ...permission(501, 'npm test -- login'),
        payload: {
          ...permission(501, 'npm test -- login').payload,
          options: ['allow', 'allow_always', 'deny'],
        },
      },
    ],
  },
  'op-watch': {
    id: 'op-watch',
    work_id: 'observe-claude',
    instance_id: 'inst-claude',
    session_id: 's4',
    status: 'running',
    action: 'watch',
    events: [permission(601, 'rm -rf build')],
  },
  'op-historic': {
    id: 'op-historic',
    work_id: 'parent-work',
    instance_id: 'inst-claude',
    session_id: 's0',
    status: 'completed',
    action: 'prompt',
    events: [{ cursor: 9, kind: 'progress', payload: { text: '原生回合已完成' } }],
  },
}

// What the views did, read by the spec.
const calls = {
  reads: [] as string[],
  answers: [] as { workId: string; permissionId: string; answer: Record<string, unknown> }[],
  commands: [] as WorkCommand[],
  submits: [] as unknown[],
}
let releaseAnswer: (() => void) | undefined
const hintListeners = new Set<Parameters<ConversationBridge['onHint']>[0]>()
const hint = (kind: string, data: unknown) => {
  for (const listener of hintListeners) listener('role', kind, data)
}
const active = () =>
  Object.values(works).filter((work) => !['completed', 'failed', 'cancelled'].includes(work.state))
Object.assign(window, {
  __calls: calls,
  __releaseAnswer: () => releaseAnswer?.(),
  // A delegation's native turn ends: its Work changes and the server emits the `work` hint.
  __finishAcp: () => {
    works['deleg-acp'] = {
      ...works['deleg-acp']!,
      state: 'completed',
      revision: 3,
      delegation: {
        ...works['deleg-acp']!.delegation!,
        state: 'completed',
        status_line: 'Gemini 已完成（服务器）',
      },
    }
    // A delegation is a child Work: the server's stream says only `refresh` for it.
    hint('refresh', {})
  },
  // Another device or Yuki changed this device's records; the stream says `refresh`.
  __bumpRecords: () => {
    for (const id of ['deleg-claude', 'observe-claude'])
      works[id] = { ...works[id]!, revision: works[id]!.revision + 1 }
    hint('refresh', {})
  },
  yuki: {
    connector: {
      devices: async () => ({ ok: true, value: devices }),
      operation: async (_character: string, id: string, cursor = 0) => {
        calls.reads.push(`operation:${id}:${cursor}`)
        const operation = operations[id]
        if (!operation) return { ok: false, code: 'not_found' }
        return {
          ok: true,
          value: {
            ...operation,
            events: operation.events!.filter((event) => event.cursor > cursor),
          },
        }
      },
      operations: async () => ({
        ok: true,
        value: { operations: [operations['op-watch'], operations['op-claude']] },
      }),
      sessions: async () => ({ ok: true, value: { sessions: [] } }),
      terminals: async () => ({ ok: true, value: { terminals: [] } }),
      submit: async (_character: string, input: unknown) => {
        calls.submits.push(input)
        return {
          ok: true,
          value: { requestId: 'fixture-request', state: 'accepted', eventId: 1, problem: null },
        }
      },
    },
    client: {
      onHint: (listener: Parameters<ConversationBridge['onHint']>[0]) => {
        hintListeners.add(listener)
        return () => hintListeners.delete(listener)
      },
      read: async (_id: string, route: ApiRead) => {
        calls.reads.push(route.kind === 'work' ? `work:${route.workId}` : route.kind)
        if (route.kind === 'works') {
          const roots = Object.values(works).filter(
            (work) =>
              !work.parent_work_id &&
              (route.group === 'active') === active().includes(work) &&
              (!legacy || !work.delegation),
          )
          return {
            ok: true,
            value: { works: legacy ? roots.map(legacyWork) : roots, next_before: null },
          }
        }
        if (route.kind === 'delegations' && delegationsFail)
          return { ok: false, code: 'unavailable' }
        if (route.kind === 'delegations')
          return {
            ok: true,
            value: {
              delegations:
                legacy || revision < 14
                  ? []
                  : Object.values(works).filter(
                      (work) =>
                        work.delegation && (route.group === 'active') === active().includes(work),
                    ),
            },
          }
        if (route.kind === 'work')
          return works[route.workId]
            ? {
                ok: true,
                value: legacy ? legacyWork(works[route.workId]!) : works[route.workId],
              }
            : { ok: false, code: 'not_found' }
        if (route.kind === 'steps')
          return {
            ok: true,
            value: {
              steps: route.workId === 'parent-work' ? steps : [],
              children: [],
              wait: null,
              work_revision: works[route.workId]?.revision ?? 1,
              steps_token: route.workId,
              next_after: null,
            } satisfies WorkSteps,
          }
        throw Error(`unexpected route ${route.kind}`)
      },
      nativeAnswer: async (
        _id: string,
        workId: string,
        permissionId: string,
        answer: Record<string, unknown>,
      ) => {
        calls.answers.push({ workId, permissionId, answer })
        const settle = () => {
          const work = works[workId]!
          works[workId] = {
            ...work,
            state: 'waiting_external',
            revision: work.revision + 1,
            delegation: {
              ...work.delegation!,
              state: 'running',
              status_line: 'Claude Code 正在运行',
              pending: work.delegation!.pending.filter(
                (item) => item.permission_id !== permissionId,
              ),
            },
          }
        }
        if (answerMode === 'unknown') {
          // The first reply is lost after the server committed it; the same request ID
          // then reads back the original receipt.
          if (calls.answers.length === 1) {
            settle()
            return { ok: false, code: 'unknown' }
          }
          return {
            ok: true,
            value: {
              work_id: workId,
              permission_id: permissionId,
              operation_id: 'op-claude',
              status: 'accepted',
              replay: true,
            },
          }
        }
        if (answerMode === 'already') {
          // Yuki answered first: the native request is consumed once, by her answer.
          settle()
          return { ok: false, code: 'request_already_answered' }
        }
        await new Promise<void>((resolve) => (releaseAnswer = resolve))
        settle()
        return {
          ok: true,
          value: {
            work_id: workId,
            permission_id: permissionId,
            operation_id: 'op-claude',
            status: 'accepted',
            replay: false,
          },
        }
      },
      workCommand: async (_id: string, command: WorkCommand) => {
        calls.commands.push(command)
        return {
          ok: true,
          value: {
            requestId: 'fixture-cancel',
            command,
            payloadHash: 'hash',
            state: 'result',
            result: null,
            problem: null,
            createdAt: 0,
          },
        }
      },
      workCommands: async () => ({ ok: true, value: [] }),
      workQuestionDrafts: async () => ({ ok: true, value: [] }),
      workDraft: async () => ({ ok: true, value: '' }),
      verify: async () => ({ ok: false, code: 'fixture_only' }),
      serverInfo: async () => ({ ok: true, value: { api_revision: revision } }),
      copy: async () => ({ ok: true, value: undefined }),
    },
  },
})

const connection: Connection = {
  characterId: 'role',
  baseUrl: 'https://yuki.invalid',
  name: 'Yuki',
  personId: 'person',
  bindingId: 'binding',
  conversationId: 'conversation',
  persistentCredentials: false,
  deviceId: 'desktop-device',
}
const connector: Extract<ConnectorState, { available: true }> = {
  available: true,
  paired: true,
  deviceId: 'dev-mac',
  instances: [{ id: 'local-claude', label: 'Claude Code', driver: 'claude' }],
  running: true,
  admission: {
    matched: true,
    connected: true,
    instances: [
      {
        id: 'inst-claude',
        localId: 'local-claude',
        label: 'Claude Code',
        driver: 'claude',
        online: true,
      },
    ],
  },
}

function Case() {
  const [selected, setSelected] = useState(params.get('work') ?? undefined)
  if (params.get('view') === 'connector')
    return (
      <main style={{ maxWidth: 760, padding: 20 }}>
        <ConnectorTasks connection={connection} state={connector} />
      </main>
    )
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: '100vh' }}>
      <WorkList id="role" selected={selected} open={setSelected} />
      {selected && (
        <WorkDetail
          key={selected}
          id="role"
          platform="darwin"
          workId={selected}
          open={setSelected}
          replyInChat={() => {}}
          artifact={() => {}}
        />
      )}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Case />
  </QueryClientProvider>,
)
