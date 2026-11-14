import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  ArrowLeft,
  BriefcaseBusiness,
  Folder,
  Maximize2,
  Minimize2,
  MessageCircle,
  Monitor,
  Laptop,
  PanelLeft,
  PanelRight,
  Search,
  Settings2,
  Snowflake,
  X,
} from 'lucide-react'
import { columns, centerColumnMinimum } from '../../main/geometry'
import { useSessionActive, useWorkspace } from '../state/workspace'
import { Button, Capsule, IconButton, Segmented, SelectionPill } from './Controls'
import { UpdateReadyButton } from './Updates'
import { PresenceCard } from './PresenceCard'
import type { View } from '../../shared/desktop'
import styles from '../App.module.css'
import { useCommands } from '../state/commands'
import { requestNavigation } from '../state/navigation'
import { useWorkspaceMotion } from '../motion/workspace'
import { ApplicationMenu } from './ApplicationMenu'
import { EdgeFade, useScrolledUnder } from './EdgeFade'
import { useTranslation } from '../i18n'

interface Props {
  name: string
  avatar?: ReactNode
  roleSwitcher?: ReactNode
  status: string
  presence?: 'running' | 'waiting' | 'done' | 'offline'
  platform: string
  children: ReactNode
  inspector?: ReactNode
  inspectorTitle?: string
  entries?: ReactNode
  onChat?(): void
  onSettings?: () => void
  toolbar?: ReactNode
  toolbarTitle?: ReactNode
  mainConversation?: boolean
}
const workspaceViews = [
  ['works', BriefcaseBusiness],
  ['files', Folder],
  ['computer', Monitor],
  ['local', Laptop],
] as const
const views = ['chat', ...workspaceViews.map(([view]) => view), 'about', 'settings']

export function Workspace(props: Props) {
  const { t } = useTranslation(['workspace', 'common'])
  const [main, scrolled] = useScrolledUnder<HTMLElement>()
  const state = useWorkspace()
  const active = useSessionActive()
  const focusMode = state.focusMode
  const inspector = state.inspector
  const selectedView = state.view
  const selectView = (view: View) =>
    requestNavigation(() => {
      if (view === 'chat' && props.onChat) props.onChat()
      else state.setView(view)
    })
  const [width, setWidth] = useState(window.innerWidth)
  const stopDrag = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(
    () => () => stopDrag.current?.(),
    [active, width, state.sidebar, inspector, focusMode],
  )
  const [overlaySidebar, setOverlaySidebar] = useState(false)
  const toggleSidebar = () => {
    if (focusMode)
      requestNavigation(() => {
        state.patch({ focusMode: false, sidebar: true })
        if (width < 1100) setOverlaySidebar(true)
      })
    else if (width < 1100) setOverlaySidebar((value) => !value)
    else state.toggle('sidebar')
  }
  const root = useRef<HTMLDivElement>(null)
  const closeInspector = () => {
    const close = () => {
      state.patch({ inspector: false, focusMode: false })
      requestAnimationFrame(() => {
        const target =
          root.current?.querySelector<HTMLButtonElement>(
            '[data-region="toolbar"] button[data-toggle="inspector"]',
          ) ?? root.current?.querySelector<HTMLButtonElement>('[data-region="toolbar"] button')
        if (target?.offsetWidth && !target.closest('[inert]')) target.focus()
      })
    }
    if (focusMode) requestNavigation(close)
    else close()
  }
  const toggleInspector = () => {
    if (inspector || focusMode) closeInspector()
    else state.toggle('inspector')
  }
  const inspectorTabs = (['work', 'computer', 'files'] as const).map((value) => ({
    value,
    label: t(`workspace:inspectorTab.${value}`),
  }))
  const selectedTab = state.inspectorTab
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useCommands((command) => {
    if (command === 'sidebar') toggleSidebar()
    else if (command === 'inspector') toggleInspector()
    else if (command === 'focus-mode') state.toggle('focusMode')
    else if (command !== 'settings' && views.includes(command)) selectView(command as View)
  })
  const layout = columns(
    width,
    state.sidebarWidth,
    state.inspectorWidth,
    state.sidebar,
    inspector,
    !state.inspectorWidthCustom,
  )
  const sidebar = layout.overlaySidebar ? overlaySidebar : state.sidebar
  const detailLayer = layout.overlayInspector && !focusMode
  const detailPage = inspector && detailLayer
  const left = focusMode ? 0 : layout.sidebar
  const right = focusMode ? 0 : layout.inspector
  const sidebarRef = useRef<HTMLElement>(null)
  const inspectorRef = useRef<HTMLElement>(null)
  const showInspector = useWorkspaceMotion(root, sidebarRef, inspectorRef, {
    active,
    view: selectedView,
    width,
    focus: focusMode,
    left,
    right,
    sidebarOpen: !focusMode && sidebar,
    sidebarOverlay: layout.overlaySidebar,
    inspectorOpen: inspector || focusMode,
    detailPage: detailLayer,
  })
  const detailHeader = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (detailPage && active) detailHeader.current?.querySelector('button')?.focus()
  }, [active, detailPage])
  const drag = (
    kind: 'sidebarWidth' | 'inspectorWidth',
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    stopDrag.current?.()
    const target = event.currentTarget,
      pointerId = event.pointerId
    target.setPointerCapture(pointerId)
    const start = event.clientX
    const initial = kind === 'sidebarWidth' ? layout.sidebar : layout.inspector
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const value = initial + (e.clientX - start) * (kind === 'sidebarWidth' ? 1 : -1)
      const max =
        kind === 'sidebarWidth'
          ? Math.min(320, width - layout.inspector - centerColumnMinimum)
          : Math.min(560, width - layout.sidebar - centerColumnMinimum)
      state.setWidth(kind, Math.max(kind === 'sidebarWidth' ? 220 : 320, Math.min(max, value)))
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('blur', finish)
      target.removeEventListener('lostpointercapture', finish)
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
      if (stopDrag.current === finish) stopDrag.current = undefined
    }
    stopDrag.current = finish
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
    window.addEventListener('blur', finish, { once: true })
    target.addEventListener('lostpointercapture', finish, { once: true })
  }
  const divider = (kind: 'sidebarWidth' | 'inspectorWidth') => (
    <div
      className={styles.divider}
      style={{ gridColumn: kind === 'sidebarWidth' ? 2 : focusMode ? 2 : 4, gridRow: 1 }}
    >
      <button
        aria-label={
          kind === 'sidebarWidth' ? t('workspace:resizeSidebar') : t('workspace:resizeInspector')
        }
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={kind === 'sidebarWidth' ? layout.sidebar : layout.inspector}
        onPointerDown={(event) => drag(kind, event)}
        onDoubleClick={() => state.setWidth(kind, null)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          const delta = (event.key === 'ArrowRight' ? 4 : -4) * (kind === 'sidebarWidth' ? 1 : -1)
          const next = Math.max(
            kind === 'sidebarWidth' ? 220 : 320,
            Math.min(
              kind === 'sidebarWidth'
                ? Math.min(320, width - layout.inspector - centerColumnMinimum)
                : Math.min(560, width - layout.sidebar - centerColumnMinimum),
              (kind === 'sidebarWidth' ? layout.sidebar : layout.inspector) + delta,
            ),
          )
          state.setWidth(kind, next)
        }}
      />
    </div>
  )
  const sidebarContent = (
    <>
      {props.roleSwitcher ?? (
        <PresenceCard
          name={props.name}
          status={props.status}
          color={props.presence}
          avatar={props.avatar}
        />
      )}
      <div className={styles.group}>{t('workspace:group.chat')}</div>
      <button
        className={styles.nav}
        aria-current={
          selectedView === 'chat' && props.mainConversation !== false ? 'page' : undefined
        }
        onClick={() => selectView('chat')}
      >
        <MessageCircle size={16} strokeWidth={1.5} />
        {t('workspace:view.chat')}
      </button>
      {props.entries}
      <div className={styles.group}>{t('workspace:group.workspace')}</div>
      {workspaceViews.map(([view, Icon]) => (
        <button
          className={styles.nav}
          key={view}
          aria-current={selectedView === view ? 'page' : undefined}
          onClick={() => selectView(view)}
        >
          <Icon size={16} strokeWidth={1.5} />
          {view === 'computer'
            ? t('workspace:computerOf', { name: props.name })
            : t(`workspace:view.${view}`)}
        </button>
      ))}
      <div className={styles.navSpacer} />
      <button
        className={styles.nav}
        aria-current={selectedView === 'about' ? 'page' : undefined}
        onClick={() => selectView('about')}
      >
        <Snowflake size={16} strokeWidth={1.5} />
        {t('workspace:aboutOf', { name: props.name })}
      </button>
      <button
        className={styles.nav}
        onClick={() => {
          requestNavigation(() => {
            if (props.onSettings) props.onSettings()
            else state.setView('settings')
          })
        }}
      >
        <Settings2 size={16} strokeWidth={1.5} />
        {t('workspace:view.settings')}
      </button>
    </>
  )
  return (
    <div
      ref={root}
      className={`${styles.shell} ${props.platform === 'darwin' ? styles.macWorkspace : ''} ${showInspector && !detailLayer ? styles.splitWorkspace : ''}`}
      data-focus-mode={focusMode ? '' : undefined}
      style={
        {
          '--workspace-left': `${left}px`,
          '--workspace-right': `${right}px`,
        } as CSSProperties
      }
      onPointerDown={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('dialog,[role="dialog"]')) return
        if (
          layout.overlaySidebar &&
          overlaySidebar &&
          !target.closest('[data-region="sidebar"],button[data-toggle="sidebar"]')
        )
          setOverlaySidebar(false)
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('dialog')) return
        if (event.key === 'Escape') {
          if (inspector || focusMode) closeInspector()
          else if (layout.overlaySidebar && overlaySidebar) setOverlaySidebar(false)
        }
        if (event.key === 'F6') {
          event.preventDefault()
          const regions = [
            ...(root.current?.querySelectorAll<HTMLElement>('[data-region]') ?? []),
          ].filter(
            (element) =>
              element.offsetWidth > 0 &&
              !element.closest('[inert]') &&
              getComputedStyle(element).visibility !== 'hidden',
          )
          const currentRegion = [...regions]
            .reverse()
            .find((element) => element.contains(document.activeElement))
          const current = currentRegion ? regions.indexOf(currentRegion) : -1
          const region = regions[(current + 1) % regions.length]
          ;(
            region?.querySelector<HTMLElement>('button,input,textarea,[tabindex="0"]') ?? region
          )?.focus()
        }
      }}
    >
      {!focusMode && (
        <>
          <nav
            ref={sidebarRef}
            data-region="sidebar"
            data-glass="sidebar"
            data-pane-open={sidebar}
            aria-label={t('workspace:navigation')}
            inert={!sidebar}
            className={`${styles.sidebar} ${layout.overlaySidebar ? styles.sidebarOverlay : ''}`}
            onClick={(event) => {
              if (layout.overlaySidebar && (event.target as HTMLElement).closest('button'))
                setOverlaySidebar(false)
            }}
            style={{ gridColumn: 1, gridRow: 1 }}
          >
            <SelectionPill selected={selectedView} selector="button[aria-current=page]" />
            {sidebarContent}
          </nav>
          {layout.sidebar > 0 && divider('sidebarWidth')}
        </>
      )}
      <section
        ref={main}
        data-region="main"
        className={`${styles.main} ${detailPage ? styles.behindDetail : ''}`}
        inert={detailPage}
        style={{ gridColumn: focusMode ? 1 : 3, gridRow: 1 }}
      >
        <EdgeFade shown={scrolled} />
        <header
          data-region="toolbar"
          className={`${styles.toolbar} ${props.toolbar ? styles.customToolbar : ''} ${scrolled ? styles.toolbarScrolled : ''}`}
        >
          <Capsule>
            <IconButton
              label={t('workspace:sidebar')}
              data-toggle="sidebar"
              aria-expanded={!focusMode && sidebar}
              onClick={toggleSidebar}
            >
              <PanelLeft size={16} strokeWidth={1.5} />
            </IconButton>
          </Capsule>
          {props.toolbar ?? (
            <>
              {props.toolbarTitle ?? (
                <span className={styles.toolbarTitle}>
                  <strong>
                    {state.view === 'chat' || focusMode
                      ? props.name
                      : t(`workspace:view.${state.view}`)}
                  </strong>
                  {(state.view === 'chat' || focusMode) && <small>{props.status}</small>}
                </span>
              )}
              <Capsule>
                <IconButton
                  label={t('workspace:search')}
                  onClick={() => window.dispatchEvent(new Event('yuki:search'))}
                >
                  <Search size={16} strokeWidth={1.5} />
                </IconButton>
                <IconButton
                  label={t('workspace:inspector')}
                  data-toggle="inspector"
                  aria-expanded={inspector || focusMode}
                  onClick={toggleInspector}
                >
                  <PanelRight size={16} strokeWidth={1.5} />
                </IconButton>
              </Capsule>
            </>
          )}
          <UpdateReadyButton />
          <ApplicationMenu
            platform={props.platform}
            className={props.toolbar ? styles.toolbarMenu : ''}
          />
        </header>
        <div className={styles.content} data-region="content" tabIndex={-1}>
          {props.children}
        </div>
      </section>
      {showInspector && (
        <>
          {!focusMode && layout.inspector > 0 && divider('inspectorWidth')}
          <aside
            ref={inspectorRef}
            style={{ gridColumn: focusMode || detailLayer ? 3 : 5, gridRow: 1 }}
            data-region="inspector"
            aria-label={t('workspace:inspector')}
            inert={!inspector && !focusMode}
            className={`${styles.inspector} ${detailLayer ? styles.detailPage : ''}`}
          >
            <header className={styles.inspectorHeader} ref={detailHeader}>
              {detailLayer && (
                <Button
                  variant="plain"
                  aria-label={t('workspace:closeInspector')}
                  onClick={closeInspector}
                >
                  <ArrowLeft size={16} strokeWidth={1.5} />
                  {t('common:action.back')}
                </Button>
              )}
              {props.inspectorTitle ? (
                <strong>{props.inspectorTitle}</strong>
              ) : (
                <Segmented
                  label={t('workspace:inspectorContent')}
                  items={inspectorTabs}
                  value={selectedTab}
                  onChange={(inspectorTab) => state.patch({ inspectorTab })}
                />
              )}
              {!detailLayer && (
                <>
                  <IconButton
                    label={
                      focusMode ? t('workspace:restoreLayout') : t('workspace:expandInspector')
                    }
                    onClick={() => state.toggle('focusMode')}
                  >
                    {focusMode ? (
                      <Minimize2 size={16} strokeWidth={1.5} />
                    ) : (
                      <Maximize2 size={16} strokeWidth={1.5} />
                    )}
                  </IconButton>
                  <IconButton label={t('workspace:closeInspector')} onClick={closeInspector}>
                    <X size={16} strokeWidth={1.5} />
                  </IconButton>
                </>
              )}
            </header>
            <div
              className={styles.inspectorBody}
              role="tabpanel"
              aria-label={
                props.inspectorTitle ??
                inspectorTabs.find((tab) => tab.value === selectedTab)?.label
              }
            >
              {props.inspector}
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
