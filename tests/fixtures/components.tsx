import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultPreferences } from '../../src/shared/desktop'
import {
  Avatar,
  Banner,
  Button,
  Segmented,
  Sheet,
  StatusPill,
  TextField,
  Toggle,
} from '../../src/renderer/components/Controls'
import { FileRow, StepRow, WorkCard } from '../../src/renderer/components/Content'
import { Workspace } from '../../src/renderer/components/Workspace'
import '../../src/renderer/tokens.css'

window.yuki = {
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
    executorState: async () => ({ ok: false, code: 'fixture_only' }),
    clearUnavailableExecutor: async () => ({ ok: false, code: 'fixture_only' }),
    enableExecutor: async () => ({ ok: false, code: 'fixture_only' }),
    executorAction: async () => ({ ok: false, code: 'fixture_only' }),
    executorCommands: async () => ({ ok: false, code: 'fixture_only' }),
    verifyExecutorCommand: async () => ({ ok: false, code: 'fixture_only' }),
    pickExecutorFolder: async () => ({ ok: false, code: 'fixture_only' }),
    removeExecutorFolder: async () => ({ ok: false, code: 'fixture_only' }),
    prepareLogout: async () => ({ ok: false, code: 'fixture_only' }),
    logoutSummary: async () => ({ ok: false, code: 'fixture_only' }),
    finishLogout: async () => ({ ok: false, code: 'fixture_only' }),
    issueLinkCode: async () => ({ ok: false, code: 'fixture_only' }),
    linkCodeRequests: async () => ({ ok: true, value: [] }),
    verifyLinkCode: async () => ({ ok: false, code: 'fixture_only' }),
    serverInfo: async () => ({ ok: false, code: 'fixture_only' }),
    changeAddress: async () => ({ ok: false, code: 'fixture_only' }),
    promptDocuments: async () => ({ ok: false, code: 'fixture_only' }),
    promptEdit: async () => ({ ok: false, code: 'fixture_only' }),
    promptDrafts: async () => ({ ok: true, value: [] }),
    promptCommand: async () => ({ ok: false, code: 'fixture_only' }),
    promptCommands: async () => ({ ok: true, value: [] }),
    verifyPromptCommand: async () => ({ ok: false, code: 'fixture_only' }),
    letterDecoration: async () => ({ ok: true, value: undefined }),
    pickAvatar: async () => ({ ok: true, value: null }),
    dropAvatar: async () => ({ ok: false, code: 'fixture_only' }),
    pasteAvatar: async () => ({ ok: false, code: 'fixture_only' }),
    avatarBytes: async () => ({ ok: false, code: 'fixture_only' }),
    previewAvatar: async () => ({ ok: true, value: null }),
    avatarCommand: async () => ({ ok: false, code: 'fixture_only' }),
    avatarCommands: async () => ({ ok: true, value: [] }),
    avatarDraft: async () => ({ ok: true, value: null }),
    acknowledgeAvatarCommand: async () => ({ ok: true, value: undefined }),
    verifyAvatarCommand: async () => ({ ok: false, code: 'fixture_only' }),
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
    outbox: async () => ({ ok: false, code: 'fixture_only' }),
    verify: async () => ({ ok: false, code: 'fixture_only' }),
    workCommand: async () => ({ ok: false, code: 'fixture_only' }),
    workCommands: async () => ({ ok: true, value: [] }),
    workQuestionDrafts: async () => ({ ok: true, value: [] }),
    verifyWorkCommand: async () => ({ ok: false, code: 'fixture_only' }),
    workDraft: async () => ({ ok: true, value: '' }),
    draft: async () => ({ ok: false, code: 'fixture_only' }),
    onHint: () => () => {},
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
function Gallery() {
  const [preferences, setPreferences] = useState(defaultPreferences)
  const [sheet, setSheet] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.platform = 'linux'
  return (
    <Workspace
      name={new URLSearchParams(window.location.search).get('name') ?? '角色'}
      status="元件驗證"
      owner
      platform="linux"
      inspector={<p>檢視器內容</p>}
    >
      <Banner>離線狀態</Banner>
      <div style={{ padding: 24, maxWidth: 760, width: '100%', margin: '0 auto' }}>
        <Segmented
          label="預覽主題"
          value={theme}
          items={[
            { value: 'light', label: '淺色' },
            { value: 'dark', label: '深色' },
          ]}
          onChange={setTheme}
        />
        <h2 style={{ margin: '24px 0 16px' }}>共用元件</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" onClick={() => setSheet(true)}>
            開啟對話框
          </Button>
          <Button>次要</Button>
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
            onChange={(opaque) => setPreferences((previous) => ({ ...previous, opaque }))}
          />
        </div>
        <TextField aria-label="元件文字輸入" placeholder="文字輸入" />
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
        <StepRow label="執行中" status="running" time="14:00" />
        <StepRow label="已完成" status="done" />
        <StepRow label="結果未確認" status="unknown" />
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
createRoot(document.getElementById('root')!).render(<Gallery />)
