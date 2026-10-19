import { expect, it, vi } from 'vitest'
import type { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { defaultPreferences } from '../../src/shared/desktop'
import type { ClientNotice } from '../../src/main/notifications'
import type { Profile } from '../../src/shared/api'

const os = vi.hoisted(() => ({
  trays: [] as unknown[],
  notices: [] as unknown[],
  template: vi.fn(),
  quit: vi.fn(),
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Tray extends EventEmitter {
    icon: unknown
    destroyed = false
    menu: unknown
    constructor(icon: unknown) {
      super()
      this.icon = icon
      os.trays.push(this)
    }
    tooltip = ''
    setToolTip(value: string) {
      this.tooltip = value
    }
    setImage(icon: unknown) {
      this.icon = icon
    }
    setContextMenu(menu: unknown) {
      this.menu = menu
    }
    destroy() {
      this.destroyed = true
    }
  }
  class Raster {
    constructor(
      readonly source: string,
      readonly width = 128,
    ) {}
    resize(options: { width: number }) {
      return new Raster(this.source, options.width)
    }
    isEmpty() {
      return false
    }
    addRepresentation() {}
    toPNG() {
      return Buffer.from(this.source)
    }
  }
  class Notification extends EventEmitter {
    static isSupported() {
      return true
    }
    shown = false
    closed = false
    constructor(readonly options: unknown) {
      super()
      os.notices.push(this)
    }
    show() {
      this.shown = true
    }
    close() {
      this.closed = true
    }
  }
  return {
    app: { getAppPath: () => '/product', quit: os.quit },
    Menu: { buildFromTemplate: (value: unknown) => value },
    nativeImage: {
      createFromPath: (path: string) => ({ path, setTemplateImage: os.template }),
      createFromBuffer: (bytes: Buffer) => new Raster(bytes.toString('hex')),
    },
    Tray,
    Notification,
  }
})
it('keeps avatar notifications and tray selection isolated and ignores late obsolete images', () => {
  os.trays.length = 0
  os.notices.length = 0
  const shell = new NativeShell(
    () => undefined,
    () => {},
    () => {},
  )
  shell.update(defaultPreferences)
  const avatar = (name: string): Profile => ({
    id: name,
    slug: name,
    display_name: name,
    bio: '',
    revision: 1,
    avatar_revision: 1,
    avatar: null,
    default_avatar: null,
    accent: { light: '#123456', dark: '#abcdef' },
    viewer: { is_owner: true },
  })
  const a = avatar('role-a'),
    b = avatar('role-b')
  const aKey = shell.prepareCharacter('role-a', a)
  shell.decorate('role-a', aKey, new Uint8Array([11]))
  shell.selectedCharacter = 'role-a'
  const tray = os.trays[0] as FakeTray
  expect(tray.icon).toMatchObject({ source: '0b' })
  shell.selectedCharacter = 'role-b'
  expect(tray.icon.path).toContain('trayTemplate.png')
  const bKey = shell.prepareCharacter('role-b', b)
  shell.decorate('role-b', bKey, new Uint8Array([12]))
  expect(tray.icon).toMatchObject({ source: '0c' })
  const newer = shell.prepareCharacter('role-a', { ...a, avatar_revision: 2 })
  shell.decorate('role-a', newer, new Uint8Array([13]))
  shell.decorate('role-a', aKey, new Uint8Array([11]))
  shell.show({
    category: 'completed',
    title: 'A 的工作',
    body: '已完成',
    target: { characterId: 'role-a', view: 'works' },
  })
  expect((os.notices.at(-1) as FakeNotice).options).toMatchObject({
    icon: { source: '0d', width: 128 },
  })
  expect(tray.icon).toMatchObject({ source: '0c' })
  shell.selectedCharacter = 'role-a'
  expect(tray.icon).toMatchObject({ source: '0d', width: 18 })
  shell.close()
})
import { NativeShell } from '../../src/main/native'
interface FakeTray extends EventEmitter {
  tooltip: string
  destroyed: boolean
  icon: { path: string }
  menu: { label?: string; click?: () => void }[]
}
interface FakeNotice extends EventEmitter {
  shown: boolean
  closed: boolean
  options: { title: string }
}

it('shows each actual executor activity under its own role and clears only the finished operation', async () => {
  os.trays.length = 0
  os.notices.length = 0
  const reveal = vi.fn(),
    open = vi.fn(),
    shell = new NativeShell(() => undefined, reveal, open)
  shell.update(defaultPreferences)
  shell.activity('role-a', 'op-a', '讀取 收件匣A', true)
  shell.activity('role-b', 'op-b', '寫入 收件匣B', true)
  const tray = os.trays[0] as FakeTray
  expect(tray.tooltip).toContain('讀取 收件匣A')
  expect(tray.tooltip).toContain('寫入 收件匣B')
  expect(os.notices).toHaveLength(2)
  ;(os.notices[1] as FakeNotice).emit('click')
  expect(reveal).toHaveBeenCalledOnce()
  expect(open).toHaveBeenCalledWith({ characterId: 'role-b', view: 'chat' })
  shell.activity('role-a', 'op-a', '讀取 收件匣A', false)
  expect(tray.tooltip).not.toContain('收件匣A')
  expect(tray.tooltip).toContain('收件匣B')
  shell.forget('role-b')
  expect(tray.tooltip).toBe('Yuki')
  expect(tray.menu.some((item) => item.label?.includes('收件匣'))).toBe(false)
  shell.close()
})

it.each(['darwin', 'win32', 'linux'] as const)(
  'uses the %s tray adapter and real reveal/quit callbacks',
  (platform) => {
    os.trays.length = 0
    os.template.mockClear()
    const reveal = vi.fn(),
      shell = new NativeShell(
        () => undefined,
        reveal,
        () => {},
        platform,
      )
    shell.update(defaultPreferences)
    shell.update(defaultPreferences)
    expect(os.trays).toHaveLength(1)
    const tray = os.trays[0] as FakeTray
    expect(tray.icon.path).toContain(platform === 'darwin' ? 'trayTemplate.png' : '32x32.png')
    expect(os.template).toHaveBeenCalledTimes(platform === 'darwin' ? 1 : 0)
    tray.emit('click')
    expect(reveal).toHaveBeenCalledTimes(1)
    tray.menu.find((item) => item.label === '結束')!.click!()
    expect(os.quit).toHaveBeenCalled()
    shell.update({ ...defaultPreferences, keepInTray: false })
    expect(tray.destroyed).toBe(true)
  },
)
it('keeps other-role notifications actionable while the current role is focused', () => {
  os.notices.length = 0
  const reveal = vi.fn(),
    open = vi.fn(),
    shell = new NativeShell(() => ({ isFocused: () => true }) as BrowserWindow, reveal, open)
  shell.selectedCharacter = 'role-a'
  const notice: ClientNotice = {
    category: 'completed',
    title: '角色B · 工作完成',
    body: '原工作',
    target: { characterId: 'role-b', view: 'works', workId: 'original-work' },
  }
  shell.show({ ...notice, target: { ...notice.target, characterId: 'role-a' } })
  expect(os.notices).toHaveLength(0)
  shell.show(notice)
  const native = os.notices[0] as FakeNotice
  expect(native.shown).toBe(true)
  native.emit('click')
  expect(reveal).toHaveBeenCalledTimes(1)
  expect(open).toHaveBeenCalledWith(notice.target)
  shell.close()
  expect(native.closed).toBe(true)
})
