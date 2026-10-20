import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { workspaceFor } from '../../src/renderer/state/workspace'

afterEach(() => vi.unstubAllGlobals())
function storage() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  })
  return values
}
it('preserves a legacy saved 380 width as an explicit choice until the user resets it', () => {
  const saved = storage(),
    scope = randomUUID(),
    key = `workspace-layout/${scope}`
  saved.set(key, JSON.stringify({ sidebarWidth: 300, inspectorWidth: 380, inspectorTab: 'files' }))
  const state = workspaceFor(scope)
  expect(state.getState()).toMatchObject({
    sidebarWidth: 300,
    inspectorWidth: 380,
    inspectorWidthCustom: true,
    inspectorTab: 'files',
  })
  state.getState().setView('chat')
  expect(JSON.parse(saved.get(key)!)).toEqual({
    sidebarWidth: 300,
    inspectorWidth: 380,
    inspectorWidthCustom: true,
    inspectorTab: 'files',
  })
  state.getState().setWidth('inspectorWidth', null)
  expect(state.getState()).toMatchObject({ inspectorWidth: 380, inspectorWidthCustom: false })
  const restoredScope = randomUUID()
  saved.set(`workspace-layout/${restoredScope}`, saved.get(key)!)
  expect(workspaceFor(restoredScope).getState()).toMatchObject({
    sidebarWidth: 300,
    inspectorWidth: 380,
    inspectorWidthCustom: false,
  })
})
it('persists explicit and automatic column choices separately for each workspace', () => {
  const saved = storage(),
    a = randomUUID(),
    b = randomUUID(),
    first = workspaceFor(a),
    second = workspaceFor(b)
  expect(first.getState().inspectorWidthCustom).toBe(false)
  first.getState().setWidth('inspectorWidth', 444)
  first.getState().setWidth('sidebarWidth', 316)
  expect(second.getState()).toMatchObject({
    sidebarWidth: 260,
    inspectorWidth: 380,
    inspectorWidthCustom: false,
  })
  const restored = randomUUID()
  saved.set(`workspace-layout/${restored}`, saved.get(`workspace-layout/${a}`)!)
  expect(workspaceFor(restored).getState()).toMatchObject({
    sidebarWidth: 316,
    inspectorWidth: 444,
    inspectorWidthCustom: true,
  })
  first.getState().setWidth('sidebarWidth', null)
  first.getState().setWidth('inspectorWidth', null)
  expect(first.getState()).toMatchObject({
    sidebarWidth: 260,
    inspectorWidth: 380,
    inspectorWidthCustom: false,
  })
})
