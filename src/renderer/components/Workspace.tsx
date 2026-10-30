import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
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
import { IconButton, Segmented, SelectionPill } from './Controls'
import { UpdateReadyButton } from './Updates'
import { PresenceCard } from './PresenceCard'
import type { View } from '../../shared/desktop'
import styles from '../App.module.css'
import { useCommands } from '../state/commands'
import { requestNavigation } from '../state/navigation'
import { useGlass } from '../materials/glass'
import { ApplicationMenu } from './ApplicationMenu'

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
  scrolled?: boolean
  floating?: boolean
  mainConversation?: boolean
}
const workspaceViews = [
  ['works', '工作', BriefcaseBusiness],
  ['files', '檔案與成果', Folder],
  ['computer', '電腦', Monitor],
  ['local', '這台電腦', Laptop],
] as const
const views = [
  ['chat', '桌面對話', MessageCircle],
  ...workspaceViews,
  ['about', '關於', Snowflake],
  ['settings', '設定', Settings2],
] as const

export function Workspace(props: Props) {
  const glass = useGlass<HTMLDivElement>('toolbar')
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
            '[data-region="toolbar"] button[aria-label="詳情"]',
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
  const inspectorTabs = [
    { value: 'work' as const, label: '工作' },
    { value: 'computer' as const, label: '電腦' },
    { value: 'files' as const, label: '檔案' },
  ]
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
    else if (command !== 'settings' && views.some(([view]) => view === command))
      selectView(command as View)
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
        aria-label={kind === 'sidebarWidth' ? '調整側邊欄' : '調整詳情寬度'}
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
      <div className={styles.group}>對話</div>
      <button
        className={styles.nav}
        aria-current={
          selectedView === 'chat' && props.mainConversation !== false ? 'page' : undefined
        }
        onClick={() => selectView('chat')}
      >
        <MessageCircle size={16} strokeWidth={1.5} />
        桌面對話
      </button>
      {props.entries}
      <div className={styles.group}>工作區</div>
      {workspaceViews.map(([view, label, Icon]) => (
        <button
          className={styles.nav}
          key={view}
          aria-current={selectedView === view ? 'page' : undefined}
          onClick={() => selectView(view)}
        >
          <Icon size={16} strokeWidth={1.5} />
          {view === 'computer' ? `${props.name} 的電腦` : label}
        </button>
      ))}
      <div className={styles.navSpacer} />
      <button
        className={styles.nav}
        aria-current={selectedView === 'about' ? 'page' : undefined}
        onClick={() => selectView('about')}
      >
        <Snowflake size={16} strokeWidth={1.5} />
        關於 {props.name}
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
        設定
      </button>
    </>
  )
  return (
    <div
      ref={root}
      className={`${styles.shell} ${!layout.sidebar || focusMode ? styles.sidebarHidden : ''} ${props.platform === 'darwin' && (!layout.sidebar || focusMode) ? styles.macCollapsed : ''}`}
      style={{
        gridTemplateColumns: focusMode
          ? '400px 0 minmax(0,1fr)'
          : `${layout.sidebar}px 0 minmax(0,1fr) 0 ${layout.inspector}px`,
      }}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement
        if (target.closest('dialog,[role="dialog"]')) return
        if (
          !focusMode &&
          layout.overlayInspector &&
          inspector &&
          !target.closest('[data-region="inspector"],button[aria-label="詳情"]')
        )
          state.patch({ inspector: false })
        if (
          layout.overlaySidebar &&
          overlaySidebar &&
          !target.closest('[data-region="sidebar"],button[aria-label="側邊欄"]')
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
              element.offsetWidth > 0 && getComputedStyle(element).visibility !== 'hidden',
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
            data-region="sidebar"
            data-glass="sidebar"
            aria-label="主要導覽"
            className={`${styles.sidebar} ${layout.overlaySidebar ? styles.sidebarOverlay : ''}`}
            onClick={(event) => {
              if (layout.overlaySidebar && (event.target as HTMLElement).closest('button'))
                setOverlaySidebar(false)
            }}
            style={{ gridColumn: 1, gridRow: 1, visibility: sidebar ? 'visible' : 'hidden' }}
          >
            <SelectionPill selected={selectedView} selector="button[aria-current=page]" />
            {sidebarContent}
          </nav>
          {layout.sidebar > 0 && divider('sidebarWidth')}
        </>
      )}
      <section
        className={`${styles.main} ${(props.floating ?? (state.view === 'chat' || focusMode)) ? styles.floating : ''}`}
        style={{ gridColumn: focusMode ? 1 : 3, gridRow: 1 }}
      >
        <header
          data-region="toolbar"
          className={`${styles.toolbar} ${props.toolbar ? styles.customToolbar : ''} ${props.scrolled ? styles.toolbarScrolled : ''}`}
        >
          <IconButton label="側邊欄" onClick={toggleSidebar}>
            <PanelLeft size={16} strokeWidth={1.5} />
          </IconButton>
          {props.toolbar ?? (
            <>
              {props.toolbarTitle ?? (
                <span className={styles.toolbarTitle}>
                  <strong>
                    {state.view === 'chat' || focusMode
                      ? props.name
                      : views.find(([view]) => view === state.view)?.[1]}
                  </strong>
                  {(state.view === 'chat' || focusMode) && <small>{props.status}</small>}
                </span>
              )}
              <div ref={glass.ref} data-glass="toolbar" className={styles.toolbarGroup}>
                <IconButton
                  label={focusMode ? '還原版面' : '放大詳情'}
                  onClick={() => state.toggle('focusMode')}
                >
                  {focusMode ? (
                    <Minimize2 size={16} strokeWidth={1.5} />
                  ) : (
                    <Maximize2 size={16} strokeWidth={1.5} />
                  )}
                </IconButton>
                <IconButton label="詳情" onClick={toggleInspector}>
                  <PanelRight size={16} strokeWidth={1.5} />
                </IconButton>
                <IconButton
                  label="搜尋已載入內容"
                  onClick={() => window.dispatchEvent(new Event('yuki:search'))}
                >
                  <Search size={16} strokeWidth={1.5} />
                </IconButton>
              </div>
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
      {(inspector || focusMode) && (
        <>
          {!focusMode && layout.inspector > 0 && divider('inspectorWidth')}
          <aside
            style={{ gridColumn: focusMode ? 3 : 5, gridRow: 1 }}
            data-region="inspector"
            aria-label="詳情"
            className={`${styles.inspector} ${layout.overlayInspector && !focusMode ? styles.overlay : ''}`}
          >
            <header className={styles.inspectorHeader}>
              {props.inspectorTitle ? (
                <strong>{props.inspectorTitle}</strong>
              ) : (
                <Segmented
                  label="詳情內容"
                  items={inspectorTabs}
                  value={selectedTab}
                  onChange={(inspectorTab) => state.patch({ inspectorTab })}
                />
              )}
              <IconButton label="關閉詳情" onClick={closeInspector}>
                <X size={16} strokeWidth={1.5} />
              </IconButton>
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
