import { afterEach, beforeEach, expect, it, describe, vi } from 'vitest'
import { screen, nativeTheme, type BrowserWindow } from 'electron'
import { createWindow } from '../../src/main/windows'
import type { LocalStore } from '../../src/main/store'
import { defaultPreferences } from '../../src/shared/desktop'
import type { Rect } from '../../src/main/geometry'

const os = vi.hoisted(() => ({
  displayId: 1,
  work: { x: 0, y: 0, width: 1920, height: 1040 },
  windows: [] as BrowserWindow[],
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    bounds: Rect
    minimum: number[]
    destroyed = false
    background = ''
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler() {},
      setIgnoreMenuShortcuts() {},
      getURL: () => 'app://desktop/index.html',
      send() {},
    })
    constructor(options: Rect & { minWidth: number; minHeight: number }) {
      super()
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
      this.minimum = [options.minWidth, options.minHeight]
      os.windows.push(this as unknown as BrowserWindow)
    }
    getBounds() {
      return { ...this.bounds }
    }
    getMinimumSize() {
      return [...this.minimum]
    }
    setMinimumSize(width: number, height: number) {
      this.minimum = [width, height]
    }
    setBounds(bounds: Rect) {
      const old = this.bounds
      this.bounds = { ...bounds }
      if (old.x !== bounds.x || old.y !== bounds.y) this.emit('move')
      if (old.width !== bounds.width || old.height !== bounds.height) this.emit('resize')
    }
    setPosition(x: number, y: number) {
      this.setBounds({ ...this.bounds, x, y })
    }
    isDestroyed() {
      return this.destroyed
    }
    isMinimized() {
      return false
    }
    isFullScreen() {
      return false
    }
    isMaximized() {
      return false
    }
    setBackgroundColor(color: string) {
      this.background = color
    }
    getBackgroundColor() {
      return this.background
    }
    setBackgroundMaterial() {}
    setVibrancy() {}
    setTitleBarOverlay() {}
    show() {}
    async loadURL() {}
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  return {
    BrowserWindow: Window,
    screen: Object.assign(new EventEmitter(), {
      getPrimaryDisplay: () => ({ id: os.displayId, workArea: { ...os.work } }),
      getDisplayMatching: () => ({ id: os.displayId, workArea: { ...os.work } }),
    }),
    nativeTheme: Object.assign(new EventEmitter(), {
      shouldUseDarkColors: false,
      prefersReducedTransparency: false,
    }),
    app: { isPackaged: true, getAppPath: () => process.cwd() },
  }
})
beforeEach(() => {
  vi.useFakeTimers()
  os.displayId = 1
  os.work = { x: 0, y: 0, width: 1920, height: 1040 }
})
afterEach(() => {
  for (const window of os.windows.splice(0)) if (!window.isDestroyed()) window.destroy()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function localStore() {
  const values = new Map<string, unknown>()
  const set = vi.fn((key: string, value: unknown) => values.set(key, value))
  const store = {
    get: (key: string) => values.get(key),
    set,
    preferences: () => defaultPreferences,
  } as unknown as LocalStore
  return { values, set, window: createWindow(store) }
}
describe.each(['darwin', 'win32', 'linux'] as const)('window movement on %s', (platform) => {
  beforeEach(() => {
    const platformProcess = Object.create(process) as NodeJS.Process
    Object.defineProperty(platformProcess, 'platform', { value: platform, configurable: true })
    vi.stubGlobal('process', platformProcess)
  })
  it('accepts move-only events across displays without clamping intermediate drag positions', async () => {
    const { window, values } = localStore()
    window.setPosition(600, 40)
    await vi.advanceTimersByTimeAsync(100)
    expect(window.getBounds().x).toBe(600)
    window.setPosition(900, 40)
    await vi.advanceTimersByTimeAsync(100)
    expect(window.getBounds().x).toBe(900)
    os.work = { x: 1920, y: 0, width: 960, height: 492 }
    os.displayId = 2
    window.setPosition(1920, 0)
    await vi.advanceTimersByTimeAsync(150)
    expect(window.getBounds()).toEqual(os.work)
    expect(window.getMinimumSize()).toEqual([960, 492])
    expect(values.get('window')).toEqual(os.work)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('handles screen removal immediately and cancels an older pending move', async () => {
    const { window, values } = localStore()
    window.setPosition(2200, 500)
    os.work = { x: 0, y: 0, width: 911, height: 464 }
    screen.emit('display-removed')
    expect(window.getBounds()).toEqual(os.work)
    expect(window.getMinimumSize()).toEqual([911, 464])
    expect(values.get('window')).toEqual(os.work)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(window.getBounds()).toEqual(os.work)
  })
  it('saves an unsettled position on close and removes pending work and display listeners on destruction', async () => {
    const { window, values, set } = localStore()
    window.setPosition(700, 40)
    window.emit('close')
    expect(values.get('window')).toEqual({ x: 700, y: 40, width: 1440, height: 900 })
    window.setPosition(300, 50)
    expect(vi.getTimerCount()).toBe(1)
    window.destroy()
    const writes = set.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(set).toHaveBeenCalledTimes(writes)
    expect(vi.getTimerCount()).toBe(0)
    for (const kind of ['display-metrics-changed', 'display-added', 'display-removed'])
      expect(screen.listenerCount(kind)).toBe(0)
  })
  it('persists same-display native bounds without calling another geometry setter', async () => {
    const { window, values } = localStore()
    const bounds = vi.spyOn(window, 'setBounds')
    const minimum = vi.spyOn(window, 'setMinimumSize')
    window.setPosition(1800, 900)
    const actual = window.getBounds()
    bounds.mockClear()
    await vi.advanceTimersByTimeAsync(150)
    expect(window.getBounds()).toEqual(actual)
    expect(values.get('window')).toEqual(actual)
    expect(bounds).not.toHaveBeenCalled()
    expect(minimum).not.toHaveBeenCalled()
    window.emit('ready-to-show')
    expect(bounds).not.toHaveBeenCalled()
  })
})

it('closing a Windows window releases its native theme observers while the App remains alive', () => {
  const listeners = nativeTheme.listenerCount('updated')
  const windowsProcess = Object.create(process) as NodeJS.Process
  Object.defineProperty(windowsProcess, 'platform', { value: 'win32', configurable: true })
  vi.stubGlobal('process', windowsProcess)
  try {
    const { window } = localStore()
    window.destroy()
    expect(nativeTheme.listenerCount('updated')).toBe(listeners)
    expect(() => nativeTheme.emit('updated')).not.toThrow()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('system transparency changes update an existing native window without reopening it', () => {
  const original = nativeTheme.prefersReducedTransparency
  const macProcess = Object.create(process) as NodeJS.Process
  Object.defineProperty(macProcess, 'platform', { value: 'darwin', configurable: true })
  vi.stubGlobal('process', macProcess)
  try {
    const { window } = localStore()
    expect(window.getBackgroundColor()).toBe('#00000000')
    Object.assign(nativeTheme, { prefersReducedTransparency: true })
    nativeTheme.emit('updated')
    expect(window.getBackgroundColor()).toBe('#E9EDF3')
    Object.assign(nativeTheme, { prefersReducedTransparency: false })
    nativeTheme.emit('updated')
    expect(window.getBackgroundColor()).toBe('#00000000')
    window.destroy()
  } finally {
    Object.assign(nativeTheme, { prefersReducedTransparency: original })
    vi.unstubAllGlobals()
  }
})
