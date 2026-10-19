import { create } from 'zustand'
import type { View } from '../../shared/desktop'

interface WorkspaceState {
  view: View
  inspector: boolean
  sidebar: boolean
  focusMode: boolean
  setView(view: View): void
  toggle(key: 'inspector' | 'sidebar' | 'focusMode'): void
}
export const useWorkspace = create<WorkspaceState>((set) => ({
  view: 'chat',
  inspector: false,
  sidebar: true,
  focusMode: false,
  setView: (view) => set({ view }),
  toggle: (key) => set((state) => ({ [key]: !state[key] })),
}))
