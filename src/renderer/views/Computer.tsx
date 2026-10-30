import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import RFB from '@novnc/novnc'
import { Camera, ClipboardPaste, Keyboard, Maximize2, Moon, Monitor, RefreshCw } from 'lucide-react'
import type {
  Computer as ComputerState,
  ComputerCommand,
  ComputerCommandItem,
  ComputerFiles,
  Connection,
  WorkPage,
} from '../../shared/api'
import { Banner, Button, EmptyState, IconButton, Sheet, Spinner } from '../components/Controls'
import { unwrap, problemText, ClientProblem } from '../queries/client'
import styles from './Computer.module.css'

function useComputer(id: string) {
  const client = useQueryClient()
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (
          id === character &&
          ['computer', 'sync', 'character', 'connection', 'computer-command'].includes(kind)
        ) {
          void client.invalidateQueries({ queryKey: [id, 'computer'] })
          void client.invalidateQueries({ queryKey: [id, 'computer-commands'] })
        }
      }),
    [id, client],
  )
  return useQuery({
    queryKey: [id, 'computer'],
    queryFn: () => window.yuki.client.read<ComputerState>(id, { kind: 'computer' }).then(unwrap),
  })
}

export function Computer({
  connection,
  name,
  work,
  compact,
  toolbar,
}: {
  connection: Connection
  name: string
  work(id: string): void
  compact?: { expand(): void }
  toolbar?: HTMLElement | null
}) {
  const id = connection.characterId,
    query = useComputer(id),
    client = useQueryClient()
  const state = query.error ? undefined : query.data
  const [problem, setProblem] = useState(''),
    [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<{
    kind: 'return' | 'transfer' | 'sleep'
    snapshot: ComputerState
  } | null>(null)
  const [note, setNote] = useState('我已處理完畫面上的步驟，控制權交回。')
  const control = state?.control,
    held = control?.holder === 'human' && control.device_id === connection.deviceId
  const commands = useQuery({
    queryKey: [id, 'computer-commands'],
    queryFn: () => window.yuki.client.computerCommands(id).then(unwrap),
  })
  const unresolved = commands.data?.some((item) => item.state === 'submitted') ?? false
  const blocked = busy || commands.isPending || unresolved
  const act = async (command: ComputerCommand) => {
    setBusy(true)
    setProblem('')
    try {
      const result = unwrap(await window.yuki.client.computerCommand(id, command))
      client.setQueryData<ComputerCommandItem[]>([id, 'computer-commands'], (previous) => [
        ...(previous ?? []).filter((item) => item.requestId !== result.requestId),
        result,
      ])
      if (result.problem)
        setProblem(
          result.state === 'submitted'
            ? '操作結果尚未確認，已保留原請求供查證。'
            : problemText(result.problem),
        )
      else {
        setSheet(null)
        if (
          result.state === 'result' &&
          (command.action === 'take' || command.action === 'transfer')
        )
          compact?.expand()
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : '操作未完成。')
    } finally {
      setBusy(false)
      void client.invalidateQueries({ queryKey: [id, 'computer'] })
      void client.invalidateQueries({ queryKey: [id, 'computer-commands'] })
    }
  }
  const release = () => {
    if (state) {
      setNote('我已處理完畫面上的步驟，控制權交回。')
      setSheet({ kind: 'return', snapshot: state })
    }
  }
  if (query.isPending)
    return (
      <EmptyState title="正在讀取電腦狀態">
        <Spinner />
      </EmptyState>
    )
  if (!state)
    return (
      <EmptyState title={`${name} 的電腦`}>
        <Banner status="failed">{query.error?.message}</Banner>
        <Button onClick={() => void query.refetch()}>重新讀取</Button>
      </EmptyState>
    )
  const help = state.help_requests.filter((item) => item.kind === 'help')
  const controls =
    control?.holder === 'human' ? (
      <>
        {!held && (
          <Button
            disabled={blocked}
            onClick={() => setSheet({ kind: 'transfer', snapshot: state })}
          >
            改由這台控制
          </Button>
        )}
        <Button variant={held ? 'primary' : 'secondary'} disabled={blocked} onClick={release}>
          <span className={styles.returnLabel} title={`交回給 ${name}`}>
            交回給 {name}
          </span>
        </Button>
      </>
    ) : (
      <Button
        variant={help.length && !compact ? 'secondary' : 'primary'}
        disabled={blocked || state.display !== 'running' || !control}
        onClick={() => void act({ action: 'take' })}
      >
        接手
      </Button>
    )
  const header = (
    <div
      className={`${styles.header} ${toolbar ? styles.toolbarHeader : ''}`}
      data-computer-toolbar={toolbar ? '' : undefined}
      role="group"
      aria-label="電腦狀態與控制"
    >
      <div>
        <h2>{name} 的電腦</h2>
        <span>
          {state.display === 'running'
            ? '運作中'
            : state.display === 'starting'
              ? '正在啟動桌面'
              : state.display === 'stopped'
                ? '休息中'
                : '目前無法讀取'}{' '}
          · 控制：
          {control?.holder === 'human'
            ? held
              ? '你'
              : control.device_label
            : control?.holder === 'agent'
              ? name
              : '無'}
          {query.isFetching && !query.isPending ? ' · 正在確認最新狀態' : ''}
        </span>
      </div>
      {!compact && (
        <>
          {controls}
          <IconButton
            label="讓電腦休息"
            disabled={blocked || state.display !== 'running'}
            onClick={() => setSheet({ kind: 'sleep', snapshot: state })}
          >
            <Moon size={16} />
          </IconButton>
        </>
      )}
    </div>
  )
  return (
    <section
      className={`${styles.computer} ${compact ? styles.compact : ''}`}
      aria-label={`${name} 的電腦${compact ? '預覽' : ''}`}
    >
      {toolbar ? createPortal(header, toolbar) : header}
      {help.length > 0 &&
        (compact ? (
          <p className={styles.previewHelp} role="status">
            {name} 需要你幫忙：
            {help
              .map((item) => item.note)
              .filter(Boolean)
              .join('；')}
          </p>
        ) : (
          <Banner status="waiting">
            <span className={styles.helpText}>
              {name} 需要你幫忙：
              {help
                .map((item) => item.note)
                .filter(Boolean)
                .join('；')}
            </span>
            {control?.holder !== 'human' && (
              <Button
                variant="primary"
                disabled={blocked}
                onClick={() => void act({ action: 'take' })}
              >
                接手
              </Button>
            )}
          </Banner>
        ))}
      {problem && <Banner status="failed">{problem}</Banner>}
      {state.display === 'running' ? (
        <RemoteScreen key={id} id={id} held={held && !compact} preview={!!compact} />
      ) : (
        <div className={styles.resting}>
          {state.display === 'starting' ? <Spinner /> : <Moon size={40} strokeWidth={1} />}
          <h3>
            {state.display === 'starting'
              ? '正在啟動桌面'
              : state.display === 'stopped'
                ? `${name} 的電腦正在休息`
                : '主機的環境管理程式或顯示服務沒有回應'}
          </h3>
          <p>檔案、已安裝的軟體和瀏覽器登入都保存在她的電腦裡。</p>
          {state.environment === 'running' && state.display === 'stopped' && (
            <Button
              variant="primary"
              loading={busy}
              disabled={unresolved}
              onClick={() => void act({ action: 'wake' })}
            >
              喚醒
            </Button>
          )}
          {state.environment === 'stopped' && (
            <Button
              variant="primary"
              loading={busy}
              disabled={unresolved}
              onClick={() => void act({ action: 'wake' })}
            >
              啟動環境
            </Button>
          )}
        </div>
      )}
      {compact && (
        <div className={styles.previewActions}>
          {controls}
          <Button onClick={compact.expand}>
            <Maximize2 size={14} />
            開啟完整畫面
          </Button>
        </div>
      )}
      <footer className={styles.status}>
        {held
          ? compact
            ? '預覽僅供觀看，請在完整畫面操作。'
            : '按 Ctrl＋Alt 釋放鍵盤 · 只有這台裝置的輸入會送出'
          : control?.holder === 'human'
            ? `${control.device_label}（${control.device_online == null ? '連線狀態待確認' : control.device_online ? '在線' : '離線'}）正在控制；這台裝置只能觀看。`
            : compact
              ? '只能觀看；接手後在完整畫面操作。'
              : '只能觀看；接手後才能操作。'}
        {state.control?.work_id && (
          <Button variant="plain" onClick={() => work(state.control!.work_id!)}>
            正在使用此電腦的工作
          </Button>
        )}
      </footer>
      {(commands.data ?? [])
        .filter((item) => item.state === 'submitted')
        .map((item) => (
          <Banner key={item.requestId} status="unknown">
            原操作結果尚未確認。
            <Button
              variant="plain"
              onClick={() =>
                void window.yuki.client
                  .verifyComputerCommand(id, item.requestId)
                  .then(unwrap)
                  .then(() => {
                    void query.refetch()
                    void commands.refetch()
                  })
                  .catch((error) => setProblem(error.message))
              }
            >
              查證原請求
            </Button>
          </Banner>
        ))}
      <Sheet
        open={sheet !== null}
        title={
          sheet?.kind === 'sleep'
            ? '讓電腦休息？'
            : sheet?.kind === 'transfer'
              ? '改由這台裝置控制？'
              : `交回給 ${name}`
        }
        onClose={() => !busy && setSheet(null)}
        actions={
          <>
            <Button disabled={busy} onClick={() => setSheet(null)}>
              {sheet?.kind === 'sleep' ? '保持執行' : '取消'}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={unresolved}
              onClick={() => {
                if (!sheet) return
                if (sheet.kind === 'sleep')
                  void act({ action: 'sleep', confirmActiveWorkTabs: true })
                else if (sheet.snapshot.control?.lease_id)
                  void act({ action: sheet.kind, leaseId: sheet.snapshot.control.lease_id, note })
              }}
            >
              {sheet?.kind === 'sleep'
                ? '仍然休息'
                : sheet?.kind === 'transfer'
                  ? '改由這台控制'
                  : '交回'}
            </Button>
          </>
        }
      >
        {sheet?.kind === 'sleep' ? (
          <>
            <p>這會停止桌面與瀏覽器。已存檔案、軟體和瀏覽器登入會保留。</p>
            {sheet.snapshot.tabs
              .filter(
                (tab) =>
                  tab.ownership === 'work' &&
                  !['completed', 'failed', 'cancelled'].includes(tab.work_state ?? ''),
              )
              .map((tab) => (
                <p key={tab.target_id}>
                  {tab.title} · 工作 {tab.work_id} · {tab.work_state}
                </p>
              ))}
            {sheet.snapshot.tabs.some((tab) => tab.ownership === 'unknown') && (
              <p>
                另有 {sheet.snapshot.tabs.filter((tab) => tab.ownership === 'unknown').length}{' '}
                個分頁無法確認屬於哪項工作。
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              {sheet?.kind === 'transfer'
                ? '目前裝置會停止輸入，之後只有這台裝置可以操作畫面。'
                : '她會收到你的說明、重新看一次畫面，再從原來的工作繼續。說明只是參考，不會被當成工作發起人的回答。'}
            </p>
            <label className={styles.note}>
              說明
              <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          </>
        )}
      </Sheet>
    </section>
  )
}

function RemoteScreen({
  id,
  held,
  preview = false,
}: {
  id: string
  held: boolean
  preview?: boolean
}) {
  const target = useRef<HTMLDivElement>(null),
    rfb = useRef<RFB>(null),
    holder = useRef(held)
  const [connected, setConnected] = useState(false),
    [clipboardReady, setClipboardReady] = useState(false),
    [problem, setProblem] = useState(''),
    [fit, setFit] = useState(true),
    [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const fitting = useRef(fit)
  fitting.current = fit
  const [attempt, setAttempt] = useState(0)
  holder.current = held
  useEffect(() => {
    let active = true,
      instance: RFB | undefined,
      retry: ReturnType<typeof setTimeout> | undefined
    setConnected(false)
    setClipboardReady(false)
    void window.yuki.client
      .computerTicket(id)
      .then(unwrap)
      .then((url) => {
        if (!active || !target.current) return
        instance = new RFB(target.current, url, { wsProtocols: ['binary'] })
        rfb.current = instance
        instance.viewOnly = !holder.current
        instance.scaleViewport = fitting.current
        instance.clipViewport = !fitting.current
        instance.resizeSession = false
        instance.focusOnClick = false
        instance.addEventListener('connect', () => {
          if (active) {
            setConnected(true)
            setProblem('')
            const image = instance!.getImageData()
            setDimensions({ width: image.width, height: image.height })
          }
        })
        instance.addEventListener('capabilities', () => {
          if (active && rfb.current === instance)
            setClipboardReady(instance!.capabilities.clipboard === true)
        })
        instance.addEventListener('disconnect', () => {
          if (active) {
            setConnected(false)
            setClipboardReady(false)
            if (rfb.current === instance) rfb.current = null
            setProblem('畫面連線已中斷，正在重新連線。')
            if (!preview) void window.yuki.client.keyboardCapture(false)
            retry = setTimeout(() => setAttempt((value) => value + 1), 1500)
          }
        })
      })
      .catch((error) => {
        if (active) {
          setProblem(error.message)
          if (
            !(error instanceof ClientProblem) ||
            !['unauthenticated', 'owner_required', 'not_found'].includes(error.code)
          )
            retry = setTimeout(() => setAttempt((value) => value + 1), 2000)
        }
      })
    return () => {
      active = false
      clearTimeout(retry)
      instance?.disconnect()
      rfb.current = null
      if (!preview) void window.yuki.client.keyboardCapture(false)
    }
  }, [id, attempt, preview])
  useEffect(() => {
    if (rfb.current) {
      rfb.current.viewOnly = !held
      if (!held) {
        rfb.current.blur()
        if (!preview) void window.yuki.client.keyboardCapture(false)
      }
    }
  }, [held, preview])
  useEffect(() => {
    if (rfb.current) {
      rfb.current.scaleViewport = fit
      rfb.current.clipViewport = !fit
    }
  }, [fit])
  const action = async (run: () => void | Promise<void>) => {
    try {
      await run()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : '操作未完成。')
    }
  }
  return (
    <div
      className={`${styles.remote} ${held ? styles.held : ''} ${preview ? styles.preview : ''}`}
      tabIndex={-1}
      onKeyDownCapture={(event) => {
        if (preview) return
        if (event.ctrlKey && event.altKey) {
          event.preventDefault()
          event.stopPropagation()
          rfb.current?.blur()
          void window.yuki.client.keyboardCapture(false)
          target.current?.parentElement?.focus()
        }
      }}
    >
      <div
        className={styles.screen}
        style={
          fit && dimensions.width
            ? { maxWidth: dimensions.width, maxHeight: dimensions.height }
            : undefined
        }
        role={preview ? 'img' : 'application'}
        aria-label={preview ? '遠端電腦預覽' : '遠端電腦畫面'}
        ref={target}
        onPointerDown={() => {
          if (held) {
            rfb.current?.focus()
            void window.yuki.client.keyboardCapture(true)
          }
        }}
        onBlur={() => {
          if (!preview) void window.yuki.client.keyboardCapture(false)
        }}
      />
      {!connected && (
        <div className={styles.connecting}>
          <Monitor size={32} strokeWidth={1} />
          <span>{problem || '正在連接畫面'}</span>
          <IconButton label="重新連接畫面" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw size={16} />
          </IconButton>
        </div>
      )}
      {!preview && (
        <div className={styles.floating} aria-label="電腦畫面控制列">
          <Button variant="plain" aria-pressed={!fit} onClick={() => setFit((value) => !value)}>
            {fit ? '縮放：適合' : '縮放：100%'}
          </Button>
          <IconButton
            label="貼上文字到遠端畫面"
            disabled={!held || !connected || !clipboardReady}
            onClick={() =>
              void action(async () => {
                const instance = rfb.current
                if (
                  !instance ||
                  !holder.current ||
                  instance.viewOnly ||
                  instance.capabilities.clipboard !== true
                )
                  throw Error('畫面尚未準備好貼上文字。')
                const text = unwrap(await window.yuki.client.paste())
                if (
                  rfb.current !== instance ||
                  !holder.current ||
                  instance.viewOnly ||
                  instance.capabilities.clipboard !== true
                )
                  throw Error('畫面狀態或控制權已變更，文字未送出。')
                instance.clipboardPasteFrom(text)
              })
            }
          >
            <ClipboardPaste size={16} />
          </IconButton>
          <IconButton
            label="傳送 Ctrl Alt Delete"
            disabled={!held || !connected}
            onClick={() => rfb.current?.sendCtrlAltDel()}
          >
            <Keyboard size={16} />
          </IconButton>
          <IconButton
            label="截圖存檔"
            disabled={!connected}
            onClick={() =>
              void action(async () => {
                const image = rfb.current?.toDataURL('image/png')
                if (image) {
                  const bytes = Uint8Array.from(atob(image.split(',')[1]!), (char) =>
                    char.charCodeAt(0),
                  )
                  unwrap(await window.yuki.client.saveScreenshot(id, bytes))
                }
              })
            }
          >
            <Camera size={16} />
          </IconButton>
          <small>{dimensions.width ? `${dimensions.width} × ${dimensions.height}` : ''}</small>
        </div>
      )}
      {connected && problem && <span className={styles.screenProblem}>{problem}</span>}
    </div>
  )
}

export function ComputerInspector({
  id,
  work,
  preview,
}: {
  id: string
  work(id: string): void
  preview?: ReactNode
}) {
  const computer = useComputer(id),
    [path, setPath] = useState('')
  const [problem, setProblem] = useState('')
  const files = useInfiniteQuery({
    queryKey: [id, 'computer-files', path],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      window.yuki.client
        .read<ComputerFiles>(id, {
          kind: 'computer-files',
          path,
          ...(pageParam ? { cursor: pageParam } : {}),
        })
        .then(unwrap),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const workTitle = useQuery({
    queryKey: [id, 'works', 'computer-titles'],
    queryFn: () =>
      window.yuki.client
        .read<WorkPage>(id, { kind: 'works', group: 'active', origin: 'all' })
        .then(unwrap),
  })
  return (
    <aside className={styles.inspector}>
      {preview}
      <h3>瀏覽器分頁</h3>
      {computer.error ? (
        <Banner status="failed">{computer.error.message}</Banner>
      ) : computer.data?.tabs_available === false ? (
        <p>目前無法讀取分頁。</p>
      ) : (
        computer.data?.tabs.map((tab) => (
          <div key={tab.target_id} className={styles.tab}>
            <strong>{tab.title || '未命名分頁'}</strong>
            <small>{tab.url_host}</small>
            {tab.work_id ? (
              <Button variant="plain" onClick={() => work(tab.work_id!)}>
                {workTitle.data?.works.find((item) => item.work_id === tab.work_id)?.goal ??
                  '查看所屬工作'}
              </Button>
            ) : (
              <small>歸屬不明</small>
            )}
          </div>
        ))
      )}
      <h3>目前工作區檔案</h3>
      <p>這裡顯示讀取當下的檔案，內容可能隨工作變更；與已發布成果的固定版本不同。</p>
      {path && (
        <Button variant="plain" onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}>
          上一層
        </Button>
      )}
      {files.error && <Banner status="failed">{files.error.message}</Banner>}
      {problem && <Banner status="failed">{problem}</Banner>}
      {files.data?.pages
        .flatMap((page) => page.items)
        .map((file) => (
          <div key={file.name} className={styles.tab}>
            {file.kind === 'directory' ? (
              <Button
                variant="plain"
                onClick={() => setPath([path, file.name].filter(Boolean).join('/'))}
              >
                {file.name}/
              </Button>
            ) : (
              <span>{file.name}</span>
            )}
            <small>{file.size} bytes</small>
            {file.kind === 'file' && (
              <Button
                variant="plain"
                onClick={() => {
                  setProblem('')
                  void window.yuki.client
                    .saveComputerFile(id, [path, file.name].filter(Boolean).join('/'))
                    .then(unwrap)
                    .catch((error) => setProblem(error.message))
                }}
              >
                儲存目前內容
              </Button>
            )}
          </div>
        ))}
      {files.hasNextPage && (
        <Button variant="plain" onClick={() => void files.fetchNextPage()}>
          載入更多
        </Button>
      )}
    </aside>
  )
}
