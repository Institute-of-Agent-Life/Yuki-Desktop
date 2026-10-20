import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindowConstructorOptions } from 'electron'
import { createPlatformWindow } from '../../src/main/linux-frame'

const host = vi.hoisted(() => ({
  read: vi.fn(),
  windows: [] as BrowserWindowConstructorOptions[],
  overlayError: undefined as Error | undefined,
  nativeError: undefined as Error | undefined,
}))
vi.mock('node:child_process', () => ({ execFileSync: host.read }))
vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: BrowserWindowConstructorOptions) {
      host.windows.push(options)
      if (options.titleBarOverlay && host.overlayError) throw host.overlayError
      if (!options.titleBarOverlay && host.nativeError) throw host.nativeError
    }
  },
}))
const options: BrowserWindowConstructorOptions = {
  titleBarStyle: 'hidden',
  titleBarOverlay: { height: 52, color: '#00000000', symbolColor: '#1D1D1F' },
  webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
}
beforeEach(() => {
  host.windows.length = 0
  host.read.mockReset().mockReturnValue("':minimize,maximize,close'\n")
  host.overlayError = undefined
  host.nativeError = undefined
})
it.each(['darwin', 'win32'] as const)(
  '%s never queries GNOME settings or changes native options',
  (platform) => {
    createPlatformWindow(options, platform, 'GNOME')
    expect(host.read).not.toHaveBeenCalled()
    expect(host.windows).toEqual([options])
  },
)
it.each([
  'GNOME',
  'ubuntu:GNOME',
  'GNOME-Classic:GNOME',
  'gnome',
  'Ubuntu',
  'gnome-wayland',
  'ubuntu-xorg',
])('%s keeps WCO when it can represent the configured layout', (desktop) => {
  createPlatformWindow(options, 'linux', desktop)
  expect(host.windows).toEqual([options])
  expect(host.read).toHaveBeenCalledWith(
    'gsettings',
    ['get', 'org.gnome.desktop.wm.preferences', 'button-layout'],
    expect.objectContaining({ encoding: 'utf8', timeout: 1000, maxBuffer: 4096 }),
  )
})
it.each([
  "'close,minimize,maximize:'",
  "'appmenu:close'",
  "':close'",
  "':close,minimize,maximize'",
  "':'",
  'invalid',
  '',
])('native decorations preserve unsupported or unreadable GNOME layout %s', (layout) => {
  host.read.mockReturnValue(layout)
  createPlatformWindow(options, 'linux', 'GNOME')
  expect(host.windows).toHaveLength(1)
  expect(host.windows[0]).toMatchObject({
    frame: true,
    titleBarStyle: 'default',
    titleBarOverlay: false,
  })
  expect(host.windows[0]!.webPreferences).toBe(options.webPreferences)
})
it.each(['KDE', 'X-Cinnamon', ''])('leaves other desktop settings untouched for %s', (desktop) => {
  createPlatformWindow(options, 'linux', desktop)
  expect(host.read).not.toHaveBeenCalled()
  expect(host.windows).toEqual([options])
})
it('missing settings, session bus errors and timeouts keep native decorations', () => {
  host.read.mockImplementation(() => {
    throw Object.assign(new Error('gsettings unavailable'), { code: 'ETIMEDOUT' })
  })
  createPlatformWindow(options, 'linux', 'GNOME')
  expect(host.windows).toHaveLength(1)
  expect(host.windows[0]).toMatchObject({ frame: true, titleBarOverlay: false })
})
it('Linux retries a rejected overlay with native decorations and the same sandbox', () => {
  host.overlayError = new Error('Overlay not supported')
  createPlatformWindow(options, 'linux', 'KDE')
  expect(host.windows).toHaveLength(2)
  expect(host.windows[1]).toMatchObject({
    frame: true,
    titleBarStyle: 'default',
    titleBarOverlay: false,
  })
  expect(host.windows[1]!.webPreferences).toBe(options.webPreferences)
  expect(host.windows[1]!.webPreferences).toEqual({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  })
})
it('retains both failures if the Linux native fallback also fails', () => {
  host.overlayError = new Error('Overlay unavailable')
  host.nativeError = new Error('Display unavailable')
  let result: unknown
  try {
    createPlatformWindow(options, 'linux', 'KDE')
  } catch (error) {
    result = error
  }
  expect(result).toBeInstanceOf(AggregateError)
  expect((result as AggregateError).errors).toEqual([host.overlayError, host.nativeError])
})
it('does not retry an already native window or change other platforms after failure', () => {
  host.nativeError = new Error('Display unavailable')
  host.read.mockReturnValue("'close:'")
  expect(() => createPlatformWindow(options, 'linux', 'GNOME')).toThrow(host.nativeError)
  expect(host.windows).toHaveLength(1)
  host.windows.length = 0
  host.overlayError = new Error('Other failure')
  expect(() => createPlatformWindow(options, 'win32', 'GNOME')).toThrow(host.overlayError)
  expect(host.windows).toHaveLength(1)
})
