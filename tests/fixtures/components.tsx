import { useGlass } from '../../src/renderer/materials/glass'
import { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentConnector } from '../../src/renderer/views/AgentConnector'
import type { ConnectorOperation, ConnectorState } from '../../src/shared/connector'
import type { Connection } from '../../src/shared/api'
import { defaultPreferences } from '../../src/shared/desktop'
import {
  Avatar,
  Banner,
  Button,
  Segmented,
  Slider,
  Sheet,
  StatusPill,
  TextField,
  Toggle,
} from '../../src/renderer/components/Controls'
import { FileRow, StepRow, WorkCard } from '../../src/renderer/components/Content'
import { Workspace } from '../../src/renderer/components/Workspace'
import '../../src/renderer/tokens.css'
import '../../src/renderer/materials/materials.css'

const connectorMode = new URLSearchParams(location.search).get('connector')
const connectorConnection: Connection = {
  characterId: '00000000-0000-4000-8000-000000000001',
  personId: '00000000-0000-4000-8000-000000000002',
  bindingId: '00000000-0000-4000-8000-000000000003',
  conversationId: '00000000-0000-4000-8000-000000000004',
  baseUrl: 'https://yuki.example',
  name: 'Fixture Yuki',
  persistentCredentials: false,
}
const connectorCalls: { method: string; input?: unknown; start?: boolean }[] = []
Object.assign(window, { __connectorCalls: connectorCalls })
const preparedConnector = (): Extract<ConnectorState, { available: true }> => ({
  available: true,
  managed: true,
  paired: false,
  version: 'component-fixture',
  protocol: 3,
  runtime: '/fixture/connector/python',
  dataDirectory:
    connectorMode === 'long-layout' ? '/original-data/'.repeat(100) : '/fixture/connector/data',
  instances: [],
  service: { installed: false, running: false },
})
let connectorState: ConnectorState =
  connectorMode && connectorMode !== 'missing'
    ? preparedConnector()
    : { available: false, bundled: true }
if (
  connectorMode?.startsWith('protocol-') ||
  connectorMode === 'long-layout' ||
  connectorMode === 'native-unavailable' ||
  connectorMode === 'operation-detail'
) {
  connectorState = {
    ...preparedConnector(),
    paired: true,
    deviceId: 'fixture-connector-device',
    server: connectorConnection.baseUrl,
    instances: [
      {
        id: 'fixture-native-instance',
        label: connectorMode === 'long-layout' ? 'OriginalAgent'.repeat(100) : 'My Codex',
        driver: 'codex',
        command:
          connectorMode === 'long-layout'
            ? '/original/'.repeat(120) + 'codex'
            : '/fixture/Codex/codex',
        cwd: '/fixture/project',
      },
    ],
    service: { installed: true, running: true },
    admission: {
      matched: true,
      connected: true,
      ...(connectorMode === 'protocol-unknown'
        ? {}
        : { serverProtocol: connectorMode === 'protocol-connector' ? 4 : 2 }),
      instances: [
        {
          id: 'fixture-server-instance',
          localId: 'fixture-native-instance',
          label: 'My Codex',
          driver: 'codex',
          online: connectorMode !== 'native-unavailable',
          status: connectorMode === 'native-unavailable' ? 'unavailable' : 'available',
          ...(connectorMode === 'native-unavailable' ? { errorType: 'native_login_required' } : {}),
        },
      ],
    },
  }
}
if (connectorMode === 'paired')
  connectorState = {
    ...preparedConnector(),
    paired: true,
    deviceId: 'fixture-connector-device',
    server: connectorConnection.baseUrl,
    admission: { matched: true, connected: false },
  }
if (connectorMode === 'existing') {
  const original = {
    ...preparedConnector(),
    managed: false,
    paired: true,
    deviceId: 'original-connector-device',
    server: connectorConnection.baseUrl,
    runtime: '/original/python',
    dataDirectory: '/original/data',
    instances: [
      {
        id: 'original-instance',
        label: 'Original Codex',
        driver: 'codex',
        cwd: '/original/project',
      },
    ],
    service: { installed: true, running: true },
    admission: { matched: true, connected: true },
  }
  connectorState = {
    available: false,
    bundled: true,
    existing: {
      installation: { executable: original.runtime, dataDirectory: original.dataDirectory },
      state: original,
    },
  }
}
let failedServiceStart = false
let operationPhase = 'initial'
const operationReads: { id: string; cursor: number }[] = []
const hintListeners = new Set<Parameters<typeof window.yuki.client.onHint>[0]>()
Object.assign(window, {
  __connectorOperationReads: operationReads,
  __connectorAdvance(phase: string, emit = true) {
    operationPhase = phase
    if (emit)
      for (const listener of hintListeners) listener(connectorConnection.characterId, 'refresh', {})
  },
})
function operationPage(id: string, cursor = 0): ConnectorOperation {
  const events: NonNullable<ConnectorOperation['events']> = Array.from(
    { length: 201 },
    (_, index) => ({
      cursor: index + 1,
      kind: 'progress',
      payload: { text: index === 0 ? '第一頁原進度' : index === 200 ? '第二頁原進度' : '' },
    }),
  )
  if (operationPhase !== 'initial')
    events.push({
      cursor: 202,
      kind: 'permission',
      permission_id: 'original-permission',
      payload: { options: ['accept'], native_request: { command: '原任務的遲到權限要求' } },
    })
  if (operationPhase === 'terminal')
    events.push({ cursor: 203, kind: 'result', payload: { text: '原任務的真終態結果' } })
  const page = events.filter((event) => event.cursor > cursor).slice(0, 200)
  return {
    id,
    instance_id: 'fixture-server-instance',
    status: operationPhase === 'terminal' ? 'completed' : 'running',
    pending: operationPhase !== 'terminal',
    events: page,
    next_cursor: page.at(-1)?.cursor ?? cursor,
  }
}

window.yuki = {
  localBot: {
    state: async () => ({
      ok: true,
      value: {
        docker: false,
        bundled: false,
        installation: null,
        configured: false,
        running: false,
      },
    }),
    chooseDirectory: async () => ({ ok: true, value: null }),
    deploy: async () => ({ ok: false, code: 'fixture_only' }),
    start: async () => ({ ok: false, code: 'fixture_only' }),
    stop: async () => ({ ok: false, code: 'fixture_only' }),
    connect: async () => ({ ok: false, code: 'fixture_only' }),
    onProgress: () => () => {},
  },
  connector: {
    state: async () => ({ ok: true, value: connectorState }),
    install: async (separate) => {
      connectorCalls.push({ method: 'install', input: separate })
      connectorState = preparedConnector()
      return { ok: true, value: connectorState }
    },
    adopt: async () => ({ ok: false, code: 'fixture_only' }),
    useInstallation: async (input) => {
      connectorCalls.push({ method: 'useInstallation', input })
      connectorState = {
        ...(!connectorState.available && connectorState.existing
          ? connectorState.existing.state
          : preparedConnector()),
        managed: false,
        runtime: input.executable,
        dataDirectory: input.dataDirectory,
      }
      return { ok: true, value: connectorState }
    },
    discover: async (driver = 'codex') => {
      connectorCalls.push({ method: 'discover', input: driver })
      return {
        ok: true,
        value: [
          {
            id: `fixture-${driver}-one`,
            driver,
            label: driver === 'claude' ? 'Claude CLI' : 'Codex App',
            command: `/fixture/${driver}`,
          },
          ...(connectorMode === 'multiple'
            ? [
                {
                  id: 'fixture-codex-two',
                  driver,
                  label: 'Codex CLI',
                  command: '/fixture/cli/codex',
                },
              ]
            : []),
        ],
      }
    },
    configure: async (input, start) => {
      connectorCalls.push({ method: 'configure', input, start })
      if (!connectorState.available) throw Error('Connector runtime has not been prepared')
      const local = input.id ?? 'fixture-native-instance'
      const driver =
        connectorState.instances.find((instance) => instance.id === local)?.driver ??
        input.driver ??
        'codex'
      connectorState = {
        ...connectorState,
        instances: [
          {
            id: local,
            label: input.label,
            driver,
            command: '/fixture/Codex/codex',
            cwd: input.cwd ?? '/fixture/home',
          },
        ],
        service: start ? { installed: true, running: true } : connectorState.service,
        admission: {
          matched: true,
          connected: !!start,
          instances: [
            {
              id: 'fixture-server-instance',
              localId: local,
              label: input.label,
              driver,
              online: !!start,
              status: 'available',
            },
          ],
        },
      }
      if (start && connectorMode === 'service-failure' && !failedServiceStart) {
        failedServiceStart = true
        connectorState = { ...connectorState, service: { installed: true, running: false } }
        return { ok: false, code: 'connector_failed', reason: 'service-start' }
      }
      return { ok: true, value: { instanceId: local } }
    },
    diagnose: async (id) => ({
      ok: true,
      value: {
        id,
        available: connectorMode !== 'native-unavailable',
        ...(connectorMode === 'native-unavailable' ? { problem: 'native_login_required' } : {}),
      },
    }),
    revealNative: async () => ({ ok: true, value: undefined }),
    chooseProject: async () => {
      connectorCalls.push({ method: 'chooseProject' })
      return { ok: true, value: '/fixture/project' }
    },
    chooseExecutable: async () => ({ ok: true, value: null }),
    sessions: async () => ({
      ok: true,
      value: { sessions: [{ id: 'original-session', label: '原會話' }] },
    }),
    operations: async () => ({
      ok: true,
      value: {
        operations:
          connectorMode === 'operation-detail'
            ? [
                {
                  id: 'original-operation',
                  instance_id: 'fixture-server-instance',
                  status: operationPhase === 'terminal' ? 'completed' : 'running',
                },
              ]
            : [],
      },
    }),
    operation: async (_character, id, cursor = 0) => {
      operationReads.push({ id, cursor })
      return connectorMode === 'operation-detail'
        ? { ok: true, value: operationPage(id, cursor) }
        : { ok: false, code: 'not_found' }
    },
    submit: async (_character, input) => {
      connectorCalls.push({ method: 'submit', input })
      return {
        ok: true,
        value: {
          requestId: `fixture-request-${connectorCalls.length}`,
          state: 'accepted',
          eventId: 1,
          problem: null,
        },
      }
    },
    pair: async (input) => {
      connectorCalls.push({ method: 'pair', input })
      if (!connectorState.available) throw Error('Connector runtime has not been prepared')
      connectorState = {
        ...connectorState,
        paired: true,
        deviceId: 'fixture-connector-device',
        server: input.server,
      }
      return { ok: true, value: connectorState }
    },
    connect: async (input) => {
      connectorCalls.push({ method: 'connect', input })
      connectorState = {
        ...(connectorState.available ? connectorState : preparedConnector()),
        paired: true,
        deviceId: 'fixture-connector-device',
        server: connectorConnection.baseUrl,
        admission: { matched: true, connected: false },
      }
      return { ok: true, value: connectorState }
    },
    service: async (action) => {
      connectorCalls.push({ method: 'service', input: action })
      if (action === 'start' && connectorMode === 'service-failure' && !failedServiceStart) {
        failedServiceStart = true
        return { ok: false, code: 'connector_failed', reason: 'service-start' }
      }
      if (!connectorState.available) throw Error('Connector runtime has not been prepared')
      connectorState = {
        ...connectorState,
        service: { installed: action !== 'uninstall', running: action === 'start' },
        admission: {
          ...connectorState.admission!,
          connected: action === 'start',
          instances: connectorState.admission?.instances?.map((item) => ({
            ...item,
            online: action === 'start',
          })),
        },
      }
      return { ok: true, value: connectorState }
    },
  },
  applicationMenu: async () => ({ ok: true, value: false }),
  updates: {
    state: async () => ({ ok: false, code: 'unavailable' }),
    check: async () => ({ ok: false, code: 'unavailable' }),
    download: async () => ({ ok: false, code: 'unavailable' }),
    cancel: async () => ({ ok: false, code: 'unavailable' }),
    install: async () => ({ ok: false, code: 'unavailable' }),
    onChange: () => () => {},
  },
  client: {
    pendingPairings: async () => ({ ok: true, value: [] }),
    resumePairing: async () => ({ ok: false, code: 'fixture_only' }),
    forgetPairing: async () => ({ ok: true, value: undefined }),
    retiredHistory: async () => ({ ok: true, value: [] }),
    exportRetiredHistory: async () => ({ ok: true, value: false }),
    prepareLogout: async () => ({ ok: false, code: 'fixture_only' }),
    logoutSummary: async () => ({ ok: false, code: 'fixture_only' }),
    finishLogout: async () => ({ ok: false, code: 'fixture_only' }),
    issueLinkCode: async () => ({ ok: false, code: 'fixture_only' }),
    linkCodeRequests: async () => ({ ok: true, value: [] }),
    verifyLinkCode: async () => ({ ok: false, code: 'fixture_only' }),
    serverInfo: async () => ({ ok: false, code: 'fixture_only' }),
    changeAddress: async () => ({ ok: false, code: 'fixture_only' }),
    soulDocument: async () => ({ ok: false, code: 'fixture_only' }),
    soulEdit: async () => ({ ok: false, code: 'fixture_only' }),
    soulDraft: async () => ({ ok: true, value: null }),
    soulCommand: async () => ({ ok: false, code: 'fixture_only' }),
    soulCommands: async () => ({ ok: true, value: [] }),
    verifySoulCommand: async () => ({ ok: false, code: 'fixture_only' }),
    letterDecoration: async () => ({ ok: true, value: undefined }),
    pickAvatar: async () => ({ ok: true, value: null }),
    dropAvatar: async () => ({ ok: false, code: 'fixture_only' }),
    pasteAvatar: async () => ({ ok: false, code: 'fixture_only' }),
    avatarBytes: async () => ({ ok: false, code: 'fixture_only' }),
    previewAvatar: async () => ({ ok: true, value: null }),
    avatarCommand: async () => ({ ok: false, code: 'fixture_only' }),
    avatarDraft: async () => ({ ok: true, value: null }),
    characterCommand: async () => ({ ok: false, code: 'fixture_only' }),
    characterCommands: async () => ({ ok: true, value: [] }),
    verifyCharacterCommand: async () => ({ ok: false, code: 'fixture_only' }),
    computerTicket: async () => ({ ok: false, code: 'fixture_only' }),
    saveComputerFile: async () => ({ ok: false, code: 'fixture_only' }),
    computerCommand: async () => ({ ok: false, code: 'fixture_only' }),
    computerCommands: async () => ({ ok: true, value: [] }),
    verifyComputerCommand: async () => ({ ok: false, code: 'fixture_only' }),
    keyboardCapture: async () => ({ ok: true, value: undefined }),
    saveScreenshot: async () => ({ ok: false, code: 'fixture_only' }),
    reconnect: async () => ({ ok: true, value: undefined }),
    external: async () => ({ ok: false, code: 'fixture_only' }),
    copy: async () => ({ ok: true, value: undefined }),
    paste: async () => ({ ok: true, value: '' }),
    selected: async () => ({ ok: true, value: undefined }),
    acknowledgeTarget: async () => ({ ok: true, value: undefined }),
    contextMenu: async () => ({ ok: true, value: null }),
    connections: async () => ({ ok: true, value: [] }),
    meta: async () => ({ ok: false, code: 'fixture_only' }),
    pair: async () => ({ ok: false, code: 'fixture_only' }),
    read: async () => ({ ok: false, code: 'fixture_only' }),
    send: async () => ({ ok: false, code: 'fixture_only' }),
    uploads: async () => ({ ok: true, value: [] }),
    attach: async () => ({ ok: true, value: [] }),
    drop: async () => ({ ok: true, value: [] }),
    record: async () => ({ ok: false, code: 'fixture_only' }),
    microphone: async () => ({ ok: false, code: 'fixture_only' }),
    retryUpload: async () => ({ ok: false, code: 'fixture_only' }),
    removeUpload: async () => ({ ok: true, value: undefined }),
    content: async () => ({ ok: false, code: 'fixture_only' }),
    saveContent: async () => ({ ok: false, code: 'fixture_only' }),
    artifactContent: async () => ({ ok: false, code: 'fixture_only' }),
    saveArtifact: async () => ({ ok: false, code: 'fixture_only' }),
    revealArtifact: async () => ({ ok: false, code: 'fixture_only' }),
    openArtifact: async () => ({ ok: false, code: 'fixture_only' }),
    dragArtifact: async () => ({ ok: false, code: 'fixture_only' }),
    outbox: async () => ({ ok: false, code: 'fixture_only' }),
    verify: async () => ({ ok: false, code: 'fixture_only' }),
    workCommand: async () => ({ ok: false, code: 'fixture_only' }),
    workCommands: async () => ({ ok: true, value: [] }),
    workQuestionDrafts: async () => ({ ok: true, value: [] }),
    verifyWorkCommand: async () => ({ ok: false, code: 'fixture_only' }),
    workDraft: async () => ({ ok: true, value: '' }),
    draft: async () => ({ ok: false, code: 'fixture_only' }),
    onHint: (listener) => {
      hintListeners.add(listener)
      return () => {
        hintListeners.delete(listener)
      }
    },
  },
  boot: async () => {
    throw new Error('fixture only')
  },
  preferences: async (patch) => ({ ...defaultPreferences, ...patch }),
  onCommand: () => () => {},
  exportDiagnostics: async () => ({ ok: true, value: false }),
  loginItem: async () => ({
    ok: true,
    value: { enabled: false, available: false, reason: 'install-required' },
  }),
  onLeaveRequest: () => () => {},
  leaveResponse: () => {},
  onTheme: () => () => {},
  onPairLink: () => () => {},
  onOpenTarget: () => () => {},
}
function LensPreview() {
  const glass = useGlass<HTMLSpanElement>('toolbar'),
    [enabled, setEnabled] = useState(true)
  useLayoutEffect(() => {
    glass.setStrength(enabled ? 1 : 0)
  }, [enabled])
  return (
    <div>
      <button onClick={() => setEnabled((value) => !value)}>只切換像素折射</button>
      <div
        data-testid="lens-sample"
        style={{
          position: 'relative',
          width: 280,
          height: 72,
          background: 'repeating-conic-gradient(#121212 0% 25%, #fafafa 0% 50%) 0 0 / 16px 16px',
        }}
      >
        <span
          ref={glass.ref}
          data-glass="toolbar"
          style={{
            position: 'absolute',
            left: 24,
            top: 14,
            width: 232,
            height: 44,
            borderRadius: 17,
            background: 'rgb(255 255 255 / .2)',
            backdropFilter: 'var(--refract, none)',
            display: 'grid',
            placeItems: 'center',
            color: 'red',
            fontWeight: 600,
          }}
        >
          清晰文字
        </span>
      </div>
    </div>
  )
}
function Gallery() {
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [sheet, setSheet] = useState(false)
  const [stepLabel, setStepLabel] = useState('執行中')
  const [zoom, setZoom] = useState(145)
  const [changes, setChanges] = useState({ switch: 0, segment: 0, button: 0 })
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.platform = 'linux'
  return (
    <Workspace
      floating={false}
      name={new URLSearchParams(window.location.search).get('name') ?? '角色'}
      status="元件驗證"
      platform="linux"
      inspector={<p>檢視器內容</p>}
    >
      <Banner>離線狀態</Banner>
      <div style={{ padding: 24, maxWidth: 760, width: '100%', margin: '0 auto' }}>
        <Segmented
          kind="radio"
          label="預覽主題"
          value={theme}
          items={[
            { value: 'light', label: '淺色' },
            { value: 'dark', label: '深色' },
          ]}
          onChange={(value) => {
            setTheme(value)
            setChanges((s) => ({ ...s, segment: s.segment + 1 }))
          }}
        />
        <h2 style={{ margin: '24px 0 16px' }}>共用元件</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={() => setSheet(true)}>
            開啟對話框
          </Button>
          <Button onClick={() => setChanges((s) => ({ ...s, button: s.button + 1 }))}>次要</Button>
          <Button variant="plain">文字</Button>
          <Button disabled>停用</Button>
          <Button loading>載入</Button>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '20px 0' }}>
          {[20, 28, 36, 64].map((size) => (
            <Avatar key={size} name="角色" size={size} />
          ))}
          <Toggle
            label="測試切換"
            checked={preferences.opaque}
            onChange={(opaque) => {
              setPreferences((previous) => ({ ...previous, opaque }))
              setChanges((s) => ({ ...s, switch: s.switch + 1 }))
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Slider label="測試縮放" value={zoom} onChange={setZoom} />
          <output aria-label="縮放讀數">{Math.round(zoom)}%</output>
        </div>
        <LensPreview />
        <output aria-label="互動次數">{JSON.stringify(changes)}</output>
        <Button onClick={() => setTimeout(() => setZoom(125), 300)}>稍後同步外部值</Button>
        <TextField
          aria-label="元件文字輸入"
          placeholder="文字輸入"
          value={stepLabel}
          onChange={(event) => setStepLabel(event.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {(['running', 'waiting', 'done', 'failed', 'unknown', 'offline'] as const).map(
            (status) => (
              <StatusPill key={status} status={status}>
                {status}
              </StatusPill>
            ),
          )}
        </div>
        <WorkCard
          title="驗證工作卡狀態"
          status="waiting"
          statusLabel="等你回覆"
          question="測試用問題"
          onOpen={() => setSheet(true)}
          onReply={() => setSheet(true)}
          onCancel={() => setSheet(true)}
        />
        <section aria-label="步驟狀態">
          <StepRow label={stepLabel} status="running" time="14:00" />
          <StepRow label="已完成" status="done" />
          <StepRow label="結果未確認" status="unknown" />
        </section>
        <FileRow
          name="很長的繁體中文檔案名稱與原始交付版本_測試.pdf"
          identity="artifact-id"
          detail="這個對話"
          size="12 MB"
          onOpen={() => setSheet(true)}
        />
        <Sheet
          title="驗證對話框"
          open={sheet}
          onClose={() => setSheet(false)}
          actions={
            <>
              <Button onClick={() => setSheet(false)}>取消</Button>
              <Button variant="primary" onClick={() => setSheet(false)}>
                確認
              </Button>
            </>
          }
        >
          <p>固定的標題與操作列，內容可獨立捲動。</p>
          <Banner status="waiting">
            {'這則記錄已更新，原本輸入的內容仍然保留，請重新讀取後再核對。'.repeat(4)}
            {'original-request-'.repeat(12)}
          </Banner>
          {Array.from({ length: 20 }, (_, index) => (
            <p key={index}>第 {index + 1} 行測試內容</p>
          ))}
        </Sheet>
      </div>
    </Workspace>
  )
}
createRoot(document.getElementById('root')!).render(
  connectorMode ? (
    <QueryClientProvider client={new QueryClient()}>
      <main style={{ maxWidth: 680, padding: 32 }}>
        <AgentConnector
          connection={connectorMode === 'disconnected' ? undefined : connectorConnection}
          deviceLabel="My computer"
        />
      </main>
    </QueryClientProvider>
  ) : (
    <Gallery />
  ),
)
