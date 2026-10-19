import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import { createStore, useStore, type StoreApi } from 'zustand'
import type { View, NavigationTarget } from '../../shared/desktop'
import type { Connection } from '../../shared/api'
import { requestNavigation } from './navigation'

interface WorkspaceState {
  view: View
  inspector: boolean
  sidebar: boolean
  focusMode: boolean
  sidebarWidth: number
  inspectorWidth: number
  target: NavigationTarget | null
  navigate(target: NavigationTarget): void
  setView(view: View): void
  toggle(key: 'inspector' | 'sidebar' | 'focusMode'): void
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
    try {
      const saved = JSON.parse(localStorage.getItem(`workspace-layout/${scope}`) ?? 'null')
      if (saved && Number.isFinite(saved.sidebarWidth) && Number.isFinite(saved.inspectorWidth))
        widths = { sidebarWidth: saved.sidebarWidth, inspectorWidth: saved.inspectorWidth }
    } catch {
      /* Keep the live workspace usable when local layout storage is unavailable. */
    }
    store = createStore<WorkspaceState>((set) => ({
      view: 'chat',
      inspector: false,
      sidebar: true,
      focusMode: false,
      ...widths,
      target: null,
      navigate: (target) =>
        requestNavigation(() => set({ target, view: target.view, focusMode: false })),
      setView: (view) => requestNavigation(() => set({ view, target: null, focusMode: false })),
      toggle: (key) =>
        key === 'focusMode'
          ? requestNavigation(() => set((state) => ({ focusMode: !state.focusMode })))
          : set((state) => ({ [key]: !state[key] })),
      patch: (value) => set(value),
    }))
    store.subscribe(({ sidebarWidth, inspectorWidth }) => {
      try {
        localStorage.setItem(
          `workspace-layout/${scope}`,
          JSON.stringify({ sidebarWidth, inspectorWidth }),
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
