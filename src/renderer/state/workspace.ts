import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import type { View, NavigationTarget } from '../../shared/desktop'
import type { ArtifactSource, AttachmentSource, Connection } from '../../shared/api'
import type { MessageReference } from '../../shared/message'
import { requestNavigation } from './navigation'

export type InspectorTab = 'work' | 'computer' | 'files'
const inspectorFor = (view: View): InspectorTab | undefined =>
  view === 'computer'
    ? 'computer'
    : view === 'files'
      ? 'files'
      : view === 'works'
        ? 'work'
        : undefined
interface WorkspaceState {
  view: View
  inspector: boolean
  inspectorTab: InspectorTab
  selectedWork?: string
  conversationId?: string
  artifact?: ArtifactSource
  preview?: AttachmentSource
  messageStage?: MessageReference
  sidebar: boolean
  focusMode: boolean
  sidebarWidth: number
  inspectorWidth: number
  inspectorWidthCustom: boolean
  target: NavigationTarget | null
  navigate(target: NavigationTarget): void
  setView(view: View): void
  toggle(key: 'inspector' | 'sidebar' | 'focusMode'): void
  setWidth(key: 'sidebarWidth' | 'inspectorWidth', value: number | null): void
  patch(value: Partial<WorkspaceState>): void
}
const sessions = new Map<string, StoreApi<WorkspaceState>>()
const context = createContext({ scope: 'default', active: true })
export const workspaceScope = (connection: Connection) =>
  `${connection.characterId}/${connection.personId}/${connection.bindingId}`

export function workspaceFor(scope: string) {
  let store = sessions.get(scope)
  if (!store) {
    let widths = { sidebarWidth: 260, inspectorWidth: 380 }
    let inspectorWidthCustom = false
    let inspectorTab: InspectorTab = 'work'
    try {
      const saved = JSON.parse(localStorage.getItem(`workspace-layout/${scope}`) ?? 'null')
      if (saved && Number.isFinite(saved.sidebarWidth) && Number.isFinite(saved.inspectorWidth)) {
        widths = { sidebarWidth: saved.sidebarWidth, inspectorWidth: saved.inspectorWidth }
        // Legacy saved widths remain explicit choices, including 380.
        inspectorWidthCustom =
          typeof saved.inspectorWidthCustom === 'boolean' ? saved.inspectorWidthCustom : true
      }
      if (saved && ['work', 'computer', 'files'].includes(saved.inspectorTab))
        inspectorTab = saved.inspectorTab
    } catch {
      /* Keep the live workspace usable when local layout storage is unavailable. */
    }
    store = createStore<WorkspaceState>((set, get) => ({
      view: 'chat',
      inspector: false,
      inspectorTab,
      sidebar: true,
      focusMode: false,
      ...widths,
      inspectorWidthCustom,
      target: null,
      navigate: (target) =>
        requestNavigation(() =>
          set((state) => ({
            target,
            view: target.view,
            focusMode: false,
            inspectorTab: inspectorFor(target.view) ?? state.inspectorTab,
          })),
        ),
      setView: (view) =>
        requestNavigation(() =>
          set((state) => ({
            view,
            target: null,
            focusMode: false,
            inspectorTab: inspectorFor(view) ?? state.inspectorTab,
          })),
        ),
      toggle: (key) => {
        const change = () =>
          set((state) =>
            key === 'inspector' && state.focusMode
              ? { inspector: false, focusMode: false }
              : { [key]: !state[key] },
          )
        if (key === 'focusMode' || (key === 'inspector' && get().focusMode))
          requestNavigation(change)
        else change()
      },
      patch: (value) => set(value),
      setWidth: (key, value) =>
        set(
          key === 'inspectorWidth'
            ? { inspectorWidth: value ?? 380, inspectorWidthCustom: value !== null }
            : { sidebarWidth: value ?? 260 },
        ),
    }))
    store.subscribe(({ sidebarWidth, inspectorWidth, inspectorWidthCustom, inspectorTab }) => {
      try {
        localStorage.setItem(
          `workspace-layout/${scope}`,
          JSON.stringify({ sidebarWidth, inspectorWidth, inspectorWidthCustom, inspectorTab }),
        )
      } catch {
        /* A storage failure does not discard the live workspace. */
      }
    })
    sessions.set(scope, store)
  }
  return store
}
export function forgetWorkspace(connection: Connection) {
  sessions.delete(workspaceScope(connection))
}
export function WorkspaceSession({
  scope,
  active,
  children,
}: {
  scope: string
  active: boolean
  children: ReactNode
}) {
  const value = useMemo(() => ({ scope, active }), [scope, active])
  return createElement(context.Provider, { value }, children)
}
export function useSessionActive() {
  return useContext(context).active
}
export function useWorkspace<T = WorkspaceState>(selector?: (state: WorkspaceState) => T): T {
  const { scope } = useContext(context)
  return useStore(workspaceFor(scope), selector ?? ((state) => state as T))
}
