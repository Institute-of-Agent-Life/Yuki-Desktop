import { nativeTheme, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { release } from 'node:os'
import type { NativeMaterial, Preferences } from '../shared/desktop'

export function platformMaterial(
  platform: NodeJS.Platform = process.platform,
  version = release(),
): NativeMaterial {
  if (platform === 'darwin') return 'vibrancy'
  // Electron's DWM background material requires Windows 11 22H2, build 22621.
  const build = /^10\.0\.(\d+)(?:\.\d+)?$/.exec(version)?.[1]
  if (platform === 'win32' && build !== undefined && Number(build) >= 22621) return 'mica'
  return 'none'
}

export function windowAppearance(preferences: Preferences): Pick<
  BrowserWindowConstructorOptions,
  'backgroundColor' | 'backgroundMaterial'
> & {
  vibrancy?: 'sidebar'
} {
  const platform = platformMaterial()
  const opaque =
    preferences.opaque ||
    preferences.highContrast ||
    nativeTheme.prefersReducedTransparency ||
    nativeTheme.shouldUseHighContrastColors
  const material = opaque ? 'none' : platform
  return {
    backgroundColor:
      material === 'none' ? (nativeTheme.shouldUseDarkColors ? '#101215' : '#E9EDF3') : '#00000000',
    ...(process.platform === 'darwin'
      ? { vibrancy: material === 'vibrancy' ? ('sidebar' as const) : undefined }
      : {}),
    ...(platform === 'mica'
      ? { backgroundMaterial: material === 'mica' ? ('mica' as const) : ('none' as const) }
      : {}),
  }
}

export function applyWindowAppearance(window: BrowserWindow, preferences: Preferences) {
  if (window.isDestroyed()) return
  const appearance = windowAppearance(preferences)
  if (process.platform === 'darwin') window.setVibrancy(appearance.vibrancy ?? null)
  if (appearance.backgroundMaterial) window.setBackgroundMaterial(appearance.backgroundMaterial)
  // Setting a material can change the WebContents background; apply its final color last.
  window.setBackgroundColor(appearance.backgroundColor!)
}
