import { create } from 'zustand'
import type { View, NavigationTarget } from '../../shared/desktop'

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
  navigate: (target) => set({ target, view: target.view }),
  setView: (view) => set({ view, target: null }),
  toggle: (key) => set((state) => ({ [key]: !state[key] })),
}))
