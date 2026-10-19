import { create } from 'zustand'
import type { View, NavigationTarget } from '../../shared/desktop'
import { requestNavigation } from './navigation'

interface WorkspaceState {
  view: View
  inspector: boolean
  sidebar: boolean
  focusMode: boolean
  target: NavigationTarget | null
  navigate(target: NavigationTarget): void
  setView(view: View): void
  toggle(key: 'inspector' | 'sidebar' | 'focusMode'): void
}
export const useWorkspace = create<WorkspaceState>((set) => ({
  view: 'chat',
  inspector: false,
  sidebar: true,
  focusMode: false,
  target: null,
  navigate: (target) =>
    requestNavigation(() => set({ target, view: target.view, focusMode: false })),
  setView: (view) => requestNavigation(() => set({ view, target: null, focusMode: false })),
  toggle: (key) =>
    key === 'focusMode'
      ? requestNavigation(() => set((state) => ({ focusMode: !state.focusMode })))
      : set((state) => ({ [key]: !state[key] })),
}))
