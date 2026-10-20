import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  applyWindowAppearance,
  platformMaterial,
  windowAppearance,
} from '../../src/main/window-appearance'
import { defaultPreferences } from '../../src/shared/desktop'

const system = vi.hoisted(() => ({
  version: '10.0.22621',
  shouldUseDarkColors: false,
  prefersReducedTransparency: false,
  shouldUseHighContrastColors: false,
}))
vi.mock('node:os', () => ({ release: () => system.version }))
vi.mock('electron', () => ({ nativeTheme: system }))
function platform(value: NodeJS.Platform) {
  const fake = Object.create(process) as NodeJS.Process
  Object.defineProperty(fake, 'platform', { value, configurable: true })
  vi.stubGlobal('process', fake)
}
beforeEach(() => {
  system.version = '10.0.22621'
  system.shouldUseDarkColors = false
  system.prefersReducedTransparency = false
  system.shouldUseHighContrastColors = false
})
afterEach(() => vi.unstubAllGlobals())

it.each([
  ['darwin', '25.6.0', 'vibrancy'],
  ['linux', '6.8.0', 'none'],
  ['win32', '10.0.19045', 'none'],
  ['win32', '10.0.22000', 'none'],
  ['win32', '10.0.22620', 'none'],
  ['win32', '10.0.22621', 'mica'],
  ['win32', '10.0.26100.1', 'mica'],
  ['win32', '', 'none'],
  ['win32', '10.0', 'none'],
  ['win32', '10..22621', 'none'],
  ['win32', '10.0.22621junk', 'none'],
  ['win32', 'unknown', 'none'],
] as const)('uses only the material supported on %s %s', (os, version, expected) => {
  expect(platformMaterial(os, version)).toBe(expected)
})

it.each([
  'opaque',
  'highContrast',
  'prefersReducedTransparency',
  'shouldUseHighContrastColors',
] as const)('%s disables native material and restores the opaque dark background', (setting) => {
  platform('win32')
  system.shouldUseDarkColors = true
  const preferences = { ...defaultPreferences }
  if (setting === 'opaque' || setting === 'highContrast') preferences[setting] = true
  else system[setting] = true
  expect(windowAppearance(preferences)).toMatchObject({
    backgroundMaterial: 'none',
    backgroundColor: '#1C1C1E',
  })
})

it('does not invoke a background material API on unsupported Windows versions', () => {
  platform('win32')
  system.version = '10.0.22000'
  let color = ''
  const material = vi.fn()
  applyWindowAppearance(
    {
      isDestroyed: () => false,
      setBackgroundColor: (value: string) => {
        color = value
      },
      setBackgroundMaterial: material,
    } as unknown as BrowserWindow,
    defaultPreferences,
  )
  expect(color).toBe('#F5F5F7')
  expect(material).not.toHaveBeenCalled()
})

it('restores the final WebContents color after Electron resets it while disabling Mica', () => {
  platform('win32')
  system.shouldUseDarkColors = true
  let color = '',
    material = ''
  const window = {
    isDestroyed: () => false,
    setBackgroundColor: (value: string) => {
      color = value
    },
    setBackgroundMaterial: (value: string) => {
      material = value
      // Electron 42 BrowserWindow::SetBackgroundMaterial resets this color.
      color = value === 'none' ? '#FFFFFF' : '#00000000'
    },
  } as unknown as BrowserWindow
  applyWindowAppearance(window, defaultPreferences)
  expect({ color, material }).toEqual({ color: '#00000000', material: 'mica' })
  system.prefersReducedTransparency = true
  applyWindowAppearance(window, defaultPreferences)
  expect({ color, material }).toEqual({ color: '#1C1C1E', material: 'none' })
  system.prefersReducedTransparency = false
  applyWindowAppearance(window, defaultPreferences)
  expect({ color, material }).toEqual({ color: '#00000000', material: 'mica' })
})

it('does not update a destroyed window after an appearance change', () => {
  const window = { isDestroyed: () => true, setBackgroundColor: vi.fn() }
  applyWindowAppearance(window as unknown as BrowserWindow, defaultPreferences)
  expect(window.setBackgroundColor).not.toHaveBeenCalled()
})
