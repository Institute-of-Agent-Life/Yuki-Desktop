import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BriefcaseBusiness,
  Folder,
  Maximize2,
  MessageCircle,
  Monitor,
  PanelLeft,
  PanelRight,
  Search,
  Settings2,
  Snowflake,
  X,
} from 'lucide-react'
import { columns } from '../../main/geometry'
import { useWorkspace } from '../state/workspace'
import { IconButton } from './Controls'
import { PresenceCard } from './PresenceCard'
import type { Preferences, View } from '../../shared/desktop'
import styles from '../App.module.css'
import { useCommands } from '../state/commands'

interface Props {
  name: string
  avatar?: ReactNode
  status: string
  presence?: 'running' | 'waiting' | 'done' | 'offline'
  owner: boolean
  platform: string
  preferences: Preferences
  savePreferences(patch: Partial<Preferences>): void
  children: ReactNode
  inspector?: ReactNode
  entries?: ReactNode
  onSettings?: () => void
}
const views = [
  ['chat', '對話', MessageCircle],
  ['works', '工作', BriefcaseBusiness],
  ['computer', '電腦', Monitor],
  ['files', '檔案與成果', Folder],
  ['about', '關於', Snowflake],
  ['settings', '設定', Settings2],
] as const

export function Workspace(props: Props) {
  const state = useWorkspace()
  const [width, setWidth] = useState(window.innerWidth)
  const [overlaySidebar, setOverlaySidebar] = useState(false)
  const toggleSidebar = () => {
    if (width < 1100) setOverlaySidebar((value) => !value)
    else state.toggle('sidebar')
  }
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useCommands((command) => {
    if (command === 'sidebar') toggleSidebar()
    else if (command === 'inspector') state.toggle(command)
    else if (command === 'focus-mode') state.toggle('focusMode')
    else if (views.some(([view]) => view === command)) state.setView(command as View)
  })
  const layout = columns(
    width,
    props.preferences.sidebarWidth,
    props.preferences.inspectorWidth,
    state.sidebar,
    state.inspector,
  )
  const sidebar = layout.overlaySidebar ? overlaySidebar : state.sidebar
  const drag = (
    kind: 'sidebarWidth' | 'inspectorWidth',
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = event.clientX
    const initial = kind === 'sidebarWidth' ? layout.sidebar : layout.inspector
    const move = (e: PointerEvent) => {
      const value = initial + (e.clientX - start) * (kind === 'sidebarWidth' ? 1 : -1)
      const max =
        kind === 'sidebarWidth'
          ? Math.min(320, width - layout.inspector - 520)
          : Math.min(560, width - layout.sidebar - 520)
      props.savePreferences({
        [kind]: Math.max(kind === 'sidebarWidth' ? 220 : 320, Math.min(max, value)),
      })
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
  }
  const divider = (kind: 'sidebarWidth' | 'inspectorWidth') => (
    <div
      className={styles.divider}
      style={{ gridColumn: kind === 'sidebarWidth' ? 2 : state.focusMode ? 2 : 4, gridRow: 1 }}
    >
      <button
        aria-label={kind === 'sidebarWidth' ? '調整側邊欄' : '調整檢視器'}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={kind === 'sidebarWidth' ? layout.sidebar : layout.inspector}
        onPointerDown={(event) => drag(kind, event)}
        onDoubleClick={() => props.savePreferences({ [kind]: kind === 'sidebarWidth' ? 260 : 380 })}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
          event.preventDefault()
          const delta = (event.key === 'ArrowRight' ? 4 : -4) * (kind === 'sidebarWidth' ? 1 : -1)
          const next = Math.max(
            kind === 'sidebarWidth' ? 220 : 320,
            Math.min(
              kind === 'sidebarWidth'
                ? Math.min(320, width - layout.inspector - 520)
                : Math.min(560, width - layout.sidebar - 520),
              props.preferences[kind] + delta,
            ),
          )
          props.savePreferences({ [kind]: next })
        }}
      />
    </div>
  )
  const sidebarContent = (
    <>
      <PresenceCard
        name={props.name}
        status={props.status}
        color={props.presence}
        avatar={props.avatar}
        open={() => state.setView('about')}
      />
      <div className={styles.group}>對話</div>
      {views
        .filter(([view]) => view === 'chat')
        .map(([view, label, Icon]) => (
          <button
            className={styles.nav}
            key={view}
            aria-current={state.view === view ? 'page' : undefined}
            onClick={() => state.setView(view)}
          >
            <Icon size={16} strokeWidth={1.5} />
            {label}
          </button>
        ))}
      {props.entries}
      <div className={styles.group}>工作與成果</div>
      {views
        .filter(
          ([view]) =>
            view !== 'chat' && view !== 'settings' && (view !== 'computer' || props.owner),
        )
        .map(([view, label, Icon]) => (
          <button
            className={styles.nav}
            key={view}
            aria-current={state.view === view ? 'page' : undefined}
            onClick={() => state.setView(view)}
          >
            <Icon size={16} strokeWidth={1.5} />
            {view === 'computer'
              ? `${props.name} 的電腦`
              : view === 'about'
                ? `關於 ${props.name}`
                : label}
          </button>
        ))}
      <div className={styles.group} />
      <button
        className={styles.nav}
        onClick={() => {
          state.setView('settings')
          props.onSettings?.()
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
      className={`${styles.shell} ${props.platform === 'darwin' && (!layout.sidebar || state.focusMode) ? styles.macCollapsed : ''}`}
      style={{
        gridTemplateColumns: state.focusMode
          ? '400px 0 minmax(0,1fr)'
          : `${layout.sidebar}px 0 minmax(0,1fr) 0 ${layout.inspector}px`,
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('dialog')) return
        if (event.key === 'Escape') {
          if (state.inspector) state.toggle('inspector')
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
      {!state.focusMode && (
        <>
          <nav
            data-region="sidebar"
            aria-label="主要導覽"
            className={`${styles.sidebar} ${layout.overlaySidebar ? styles.sidebarOverlay : ''}`}
            onClick={(event) => {
              if (layout.overlaySidebar && (event.target as HTMLElement).closest('button'))
                setOverlaySidebar(false)
            }}
            style={{ gridColumn: 1, gridRow: 1, visibility: sidebar ? 'visible' : 'hidden' }}
          >
            {sidebarContent}
          </nav>
          {divider('sidebarWidth')}
        </>
      )}
      <section className={styles.main} style={{ gridColumn: state.focusMode ? 1 : 3, gridRow: 1 }}>
        <header data-region="toolbar" className={styles.toolbar}>
          <IconButton label="側邊欄" onClick={toggleSidebar}>
            <PanelLeft size={16} strokeWidth={1.5} />
          </IconButton>
          <span className={styles.toolbarTitle}>
            {state.view === 'chat' || state.focusMode
              ? props.name
              : views.find(([view]) => view === state.view)?.[1]}
          </span>
          <IconButton label="展開工作區" onClick={() => state.toggle('focusMode')}>
            <Maximize2 size={16} strokeWidth={1.5} />
          </IconButton>
          <IconButton label="檢視器" onClick={() => state.toggle('inspector')}>
            <PanelRight size={16} strokeWidth={1.5} />
          </IconButton>
          <IconButton
            label="搜尋已載入內容"
            onClick={() => window.dispatchEvent(new Event('yuki:search'))}
          >
            <Search size={16} strokeWidth={1.5} />
          </IconButton>
        </header>
        <div className={styles.content} data-region="content" tabIndex={-1}>
          {props.children}
        </div>
      </section>
      {(state.inspector || state.focusMode) && (
        <>
          {divider('inspectorWidth')}
          <aside
            style={{ gridColumn: state.focusMode ? 3 : 5, gridRow: 1 }}
            data-region="inspector"
            aria-label="檢視器"
            className={`${styles.inspector} ${layout.overlayInspector && !state.focusMode ? styles.overlay : ''}`}
          >
            <header className={styles.inspectorHeader}>
              <strong>檢視器</strong>
              <IconButton label="關閉檢視器" onClick={() => state.toggle('inspector')}>
                <X size={16} strokeWidth={1.5} />
              </IconButton>
            </header>
            {props.inspector}
          </aside>
        </>
      )}
    </div>
  )
}
