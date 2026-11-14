import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import RFB from '@novnc/novnc'
import { Camera, ClipboardPaste, Keyboard, Maximize2, Moon, Monitor, RefreshCw } from 'lucide-react'
import type {
  Computer as ComputerState,
  ComputerCommand,
  ComputerScreen,
  ComputerCommandItem,
  ComputerFiles,
  Connection,
  WorkPage,
} from '../../shared/api'
import {
  Banner,
  Button,
  EmptyState,
  IconButton,
  Segmented,
  Sheet,
  Spinner,
} from '../components/Controls'
import { unwrap, problemText, ClientProblem, useMe, hidesPrivateData } from '../queries/client'
import styles from './Computer.module.css'
import { useGlass } from '../materials/glass'
import { useWorkspace } from '../state/workspace'
import { useTranslation } from '../i18n'

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
  const { t } = useTranslation(['computer', 'platforms', 'common', 'errors'])
  const id = connection.characterId,
    query = useComputer(id),
    client = useQueryClient()
  const [screen, setScreen] = useState<ComputerScreen>('sandbox')
  const requested = useWorkspace((state) => state.computerScreen),
    patch = useWorkspace((state) => state.patch)
  useEffect(() => {
    if (compact || !requested) return
    setScreen(requested)
    patch({ computerScreen: undefined })
  }, [compact, requested, patch])
  const me = useMe(id)
  const administrator = me.data?.is_superuser === true && !hidesPrivateData(me.error)
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
          result.state === 'submitted' ? t('computer:unconfirmed') : problemText(result.problem),
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
      setProblem(error instanceof Error ? error.message : t('errors:notCompleted'))
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
  if (me.data?.is_superuser === false)
    return (
      <EmptyState title={t('computer:computerOf', { name })}>{t('computer:adminOnly')}</EmptyState>
    )
  if (query.isPending || me.isPending)
    return (
      <EmptyState title={t('computer:reading')}>
        <Spinner />
      </EmptyState>
    )
  if (!state || !administrator)
    return (
      <EmptyState title={t('computer:computerOf', { name })}>
        <Banner status="failed">{query.error?.message}</Banner>
        <Button onClick={() => void query.refetch()}>{t('common:action.reload')}</Button>
      </EmptyState>
    )
  const sources = !compact && state.snowluma_display && (
    <Segmented
      kind="radio"
      label={t('computer:display')}
      value={screen === 'sandbox' ? 'sandbox' : 'qq-view'}
      onChange={setScreen}
      items={[
        { value: 'sandbox', label: t('computer:sandboxOf', { name }) },
        { value: 'qq-view', label: t('platforms:qqLogin') },
      ]}
    />
  )
  const showQQ = sources && screen !== 'sandbox'
  const help = state.help_requests.filter((item) => item.kind === 'help')
  const helpText = t('computer:needsHelp', {
    name,
    notes: help
      .map((item) => item.note)
      .filter(Boolean)
      .join(t('computer:helpSeparator')),
  })
  const controls =
    control?.holder === 'human' ? (
      <>
        {!held && (
          <Button
            disabled={blocked}
            onClick={() => setSheet({ kind: 'transfer', snapshot: state })}
          >
            {t('computer:takeHere')}
          </Button>
        )}
        <Button variant={held ? 'primary' : 'secondary'} disabled={blocked} onClick={release}>
          <span className={styles.returnLabel} title={t('computer:returnTo', { name })}>
            {t('computer:returnTo', { name })}
          </span>
        </Button>
      </>
    ) : (
      <Button
        variant={help.length && !compact ? 'secondary' : 'primary'}
        disabled={blocked || state.display !== 'running' || !control}
        onClick={() => void act({ action: 'take' })}
      >
        {t('computer:take')}
      </Button>
    )
  const header = (
    <div
      className={`${styles.header} ${toolbar ? styles.toolbarHeader : ''}`}
      data-computer-toolbar={toolbar ? '' : undefined}
      role="group"
      aria-label={t('computer:controls')}
    >
      <div>{sources || <h2>{t('computer:computerOf', { name })}</h2>}</div>
      {/* The state sits beside the controls, so switching displays leaves the toolbar still. */}
      {!showQQ && (
        <span className={styles.state}>
          {t(query.isFetching && !query.isPending ? 'computer:statusChecking' : 'computer:status', {
            state: t(
              state.display === 'running'
                ? 'computer:state.running'
                : state.display === 'starting'
                  ? 'computer:state.starting'
                  : state.display === 'stopped'
                    ? 'computer:state.stopped'
                    : 'computer:state.unavailable',
            ),
            holder:
              control?.holder === 'human'
                ? held
                  ? t('computer:holderYou')
                  : (control.device_label ?? '')
                : control?.holder === 'agent'
                  ? name
                  : t('computer:holderNone'),
          })}
        </span>
      )}
      {showQQ ? (
        <Button onClick={() => setScreen(screen === 'qq-control' ? 'qq-view' : 'qq-control')}>
          {t(screen === 'qq-control' ? 'computer:endQQ' : 'computer:takeQQ')}
        </Button>
      ) : (
        !compact && (
          <>
            {controls}
            <IconButton
              label={t('computer:sleep')}
              disabled={blocked || state.display !== 'running'}
              onClick={() => setSheet({ kind: 'sleep', snapshot: state })}
            >
              <Moon size={16} />
            </IconButton>
          </>
        )
      )}
    </div>
  )
  const displayHeader = toolbar ? createPortal(header, toolbar) : header
  if (showQQ)
    return (
      <section className={styles.computer} aria-label={t('platforms:qqLogin')}>
        {displayHeader}
        <RemoteScreen key={id + screen} id={id} held={screen === 'qq-control'} screen={screen} />
      </section>
    )
  return (
    <section
      className={`${styles.computer} ${compact ? styles.compact : ''}`}
      aria-label={t(compact ? 'computer:computerPreviewOf' : 'computer:computerOf', { name })}
    >
      {displayHeader}
      {help.length > 0 &&
        (compact ? (
          <p className={styles.previewHelp} role="status">
            {helpText}
          </p>
        ) : (
          <Banner status="waiting">
            <span className={styles.helpText}>{helpText}</span>
            {control?.holder !== 'human' && (
              <Button
                variant="primary"
                disabled={blocked}
                onClick={() => void act({ action: 'take' })}
              >
                {t('computer:take')}
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
              ? t('computer:state.starting')
              : state.display === 'stopped'
                ? t('computer:resting', { name })
                : t('computer:noResponse')}
          </h3>
          <p>{t('computer:keptOnComputer')}</p>
          {state.environment === 'running' && state.display === 'stopped' && (
            <Button
              variant="primary"
              loading={busy}
              disabled={unresolved}
              onClick={() => void act({ action: 'wake' })}
            >
              {t('computer:wake')}
            </Button>
          )}
          {state.environment === 'stopped' && (
            <Button
              variant="primary"
              loading={busy}
              disabled={unresolved}
              onClick={() => void act({ action: 'wake' })}
            >
              {t('computer:startEnvironment')}
            </Button>
          )}
        </div>
      )}
      {compact && (
        <div className={styles.previewActions}>
          {controls}
          <Button onClick={compact.expand}>
            <Maximize2 size={14} />
            {t('computer:openFull')}
          </Button>
        </div>
      )}
      <footer className={styles.status}>
        {held
          ? t(compact ? 'computer:previewOnly' : 'computer:releaseKeyboard')
          : control?.holder === 'human'
            ? t(
                control.device_online == null
                  ? 'computer:controlledUnknown'
                  : control.device_online
                    ? 'computer:controlledOnline'
                    : 'computer:controlledOffline',
                { device: control.device_label ?? '' },
              )
            : t(compact ? 'computer:watchOnlyPreview' : 'computer:watchOnly')}
        {state.control?.work_id && (
          <Button variant="plain" onClick={() => work(state.control!.work_id!)}>
            {t('computer:currentWork')}
          </Button>
        )}
      </footer>
      {(commands.data ?? [])
        .filter((item) => item.state === 'submitted')
        .map((item) => (
          <Banner key={item.requestId} status="unknown">
            {t('computer:originalUnconfirmed')}
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
              {t('computer:verifyOriginal')}
            </Button>
          </Banner>
        ))}
      <Sheet
        open={sheet !== null}
        title={
          sheet?.kind === 'sleep'
            ? t('computer:sheet.sleep')
            : sheet?.kind === 'transfer'
              ? t('computer:sheet.transfer')
              : t('computer:returnTo', { name })
        }
        onClose={() => !busy && setSheet(null)}
        actions={
          <>
            <Button disabled={busy} onClick={() => setSheet(null)}>
              {t(sheet?.kind === 'sleep' ? 'computer:sheet.keepRunning' : 'common:action.cancel')}
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
              {t(
                sheet?.kind === 'sleep'
                  ? 'computer:sheet.sleepAnyway'
                  : sheet?.kind === 'transfer'
                    ? 'computer:takeHere'
                    : 'computer:sheet.return',
              )}
            </Button>
          </>
        }
      >
        {sheet?.kind === 'sleep' ? (
          <>
            <p>{t('computer:sleepDescription')}</p>
            {sheet.snapshot.tabs
              .filter(
                (tab) =>
                  tab.ownership === 'work' &&
                  !['completed', 'failed', 'cancelled'].includes(tab.work_state ?? ''),
              )
              .map((tab) => (
                <p key={tab.target_id}>
                  {t('computer:workTab', {
                    title: tab.title,
                    work: tab.work_id ?? '',
                    state: tab.work_state ?? '',
                  })}
                </p>
              ))}
            {sheet.snapshot.tabs.some((tab) => tab.ownership === 'unknown') && (
              <p>
                {t('computer:unknownTabs', {
                  count: sheet.snapshot.tabs.filter((tab) => tab.ownership === 'unknown').length,
                })}
              </p>
            )}
          </>
        ) : (
          <>
            <p>
              {t(
                sheet?.kind === 'transfer'
                  ? 'computer:transferDescription'
                  : 'computer:returnDescription',
              )}
            </p>
            <label className={styles.note}>
              {t('computer:note')}
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
  screen = 'sandbox',
}: {
  screen?: ComputerScreen
  id: string
  held: boolean
  preview?: boolean
}) {
  // The connection reads its messages through `i18n`, which a language switch keeps, so it stays.
  const { t, i18n } = useTranslation(['computer', 'errors'])
  const controls = useGlass<HTMLDivElement>('toolbar')
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
      .computerTicket(id, screen)
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
            setProblem(
              i18n.t(screen === 'qq-control' ? 'computer:qqDisconnected' : 'computer:disconnected'),
            )
            if (!preview) void window.yuki.client.keyboardCapture(false)
            if (screen !== 'qq-control')
              retry = setTimeout(() => setAttempt((value) => value + 1), 1500)
          }
        })
      })
      .catch((error) => {
        if (active) {
          setProblem(error.message)
          if (
            screen !== 'qq-control' &&
            (!(error instanceof ClientProblem) ||
              !['unauthenticated', 'forbidden', 'not_found'].includes(error.code))
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
  }, [id, attempt, preview, screen, i18n])
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
      setProblem(error instanceof Error ? error.message : t('errors:notCompleted'))
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
        aria-label={t(preview ? 'computer:remotePreview' : 'computer:remoteScreen')}
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
          <span>{problem || t('computer:connectingScreen')}</span>
          <IconButton
            label={t('computer:reconnectScreen')}
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={16} />
          </IconButton>
        </div>
      )}
      {!preview && (
        <div
          ref={controls.ref}
          data-glass="toolbar"
          className={styles.floating}
          aria-label={t('computer:toolbar')}
        >
          <Button variant="plain" aria-pressed={!fit} onClick={() => setFit((value) => !value)}>
            {t(fit ? 'computer:zoomFit' : 'computer:zoomActual')}
          </Button>
          <IconButton
            label={t('computer:pasteText')}
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
                  throw Error(t('computer:pasteNotReady'))
                const text = unwrap(await window.yuki.client.paste())
                if (
                  rfb.current !== instance ||
                  !holder.current ||
                  instance.viewOnly ||
                  instance.capabilities.clipboard !== true
                )
                  throw Error(t('computer:pasteChanged'))
                instance.clipboardPasteFrom(text)
              })
            }
          >
            <ClipboardPaste size={16} />
          </IconButton>
          <IconButton
            label={t('computer:ctrlAltDelete')}
            disabled={!held || !connected}
            onClick={() => rfb.current?.sendCtrlAltDel()}
          >
            <Keyboard size={16} />
          </IconButton>
          <IconButton
            label={t('computer:screenshot')}
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
  const { t } = useTranslation(['computer'])
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
      <h3>{t('computer:browserTabs')}</h3>
      {computer.error ? (
        <Banner status="failed">{computer.error.message}</Banner>
      ) : computer.data?.tabs_available === false ? (
        <p>{t('computer:tabsUnavailable')}</p>
      ) : (
        computer.data?.tabs.map((tab) => (
          <div key={tab.target_id} className={styles.tab}>
            <strong>{tab.title || t('computer:untitledTab')}</strong>
            <small>{tab.url_host}</small>
            {tab.work_id ? (
              <Button variant="plain" onClick={() => work(tab.work_id!)}>
                {workTitle.data?.works.find((item) => item.work_id === tab.work_id)?.goal ??
                  t('computer:viewWork')}
              </Button>
            ) : (
              <small>{t('computer:unknownOwner')}</small>
            )}
          </div>
        ))
      )}
      <h3>{t('computer:workspaceFiles')}</h3>
      <p>{t('computer:workspaceFilesDescription')}</p>
      {path && (
        <Button variant="plain" onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}>
          {t('computer:up')}
        </Button>
      )}
      {files.error && <Banner status="failed">{files.error.message}</Banner>}
      {problem && <Banner status="failed">{problem}</Banner>}
      {!files.error &&
        files.data?.pages
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
              <small>{t('computer:bytes', { count: file.size })}</small>
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
                  {t('computer:saveCurrent')}
                </Button>
              )}
            </div>
          ))}
      {!files.error && files.hasNextPage && (
        <Button variant="plain" onClick={() => void files.fetchNextPage()}>
          {t('computer:loadMore')}
        </Button>
      )}
    </aside>
  )
}
