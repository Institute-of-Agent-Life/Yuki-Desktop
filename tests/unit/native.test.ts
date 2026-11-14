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
it.each(['darwin', 'win32', 'linux'] as const)(
  'keeps avatar notifications and tray selection isolated on %s and ignores late obsolete images',
  (platform) => {
    os.trays.length = 0
    os.notices.length = 0
    const shell = new NativeShell(
      () => undefined,
      () => {},
      () => {},
      platform,
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
    })
    const a = avatar('role-a'),
      b = avatar('role-b')
    const aKey = shell.prepareCharacter('role-a', a)
    shell.decorate('role-a', aKey, new Uint8Array([11]))
    shell.selectedCharacter = 'role-a'
    const tray = os.trays[0] as FakeTray
    expect(tray.icon).toMatchObject({ source: '0b' })
    shell.selectedCharacter = 'role-b'
    expect(tray.icon.path).toContain(platform === 'darwin' ? 'trayTemplate.png' : '32x32.png')
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
    expect(tray.icon).toMatchObject({ source: '0d', width: platform === 'darwin' ? 18 : 64 })
    shell.close()
  },
)
import { NativeShell } from '../../src/main/native'
import { setLanguage } from '../../src/main/i18n'
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

it('uses the identified role name before its private profile or avatar has loaded', () => {
  os.trays.length = 0
  os.notices.length = 0
  const open = vi.fn(),
    shell = new NativeShell(
      () => undefined,
      () => {},
      open,
    )
  shell.update(defaultPreferences)
  shell.characterName('mika-id', 'Mika')
  shell.selectedCharacter = 'mika-id'
  shell.show({
    category: 'completed',
    title: 'Mika · 工作完成',
    body: '原工作',
    target: { characterId: 'mika-id', view: 'works', workId: 'original-work' },
  })
  expect((os.notices[0] as FakeNotice).options.title).toBe('Mika · 工作完成')
  const tray = os.trays[0] as FakeTray
  expect(tray.tooltip).toBe('Mika')
  tray.menu.find((item) => item.label === '開啟 Mika')!.click!()
  expect(open).toHaveBeenCalledWith({ characterId: 'mika-id', view: 'chat' })
  shell.forget('mika-id')
  expect(tray.tooltip).toBe('Yuki')
  expect(tray.menu.some((item) => item.label === '開啟 Mika')).toBe(false)
  shell.close()
})

/*
 * Tray view of the owner-control facts (Yuki task book 2026-11-09 §5.5 item 5), written before
 * the code:
 *
 * T1 Yuki operating (computer or browser) is not shown, or its 「停止」 does not ask for `owner`.
 * T2 A stop is not shown as the 「停止」 the owner pressed (the owner's own input never stops Yuki,
 *    so no other reason exists), or its 「繼續」 does not ask for `none`.
 * T3 Idle, an old Connector (no holder known) or no Desktop-owned Connector adds tray items.
 * T4 An activity line while stopped reads as operating instead of stopped.
 * T5 The existing open/show/quit items disappear, or a tray created later misses the state.
 * T6 (Yuki computer-use 3b, W23) One window operated in the background reads as foreground
 *    operation of the computer, or the other way round.
 */
it('shows Yuki operating or stopped in the tray with one action that asks the Connector', () => {
  os.trays.length = 0
  const control = vi.fn(),
    shell = new NativeShell(
      () => undefined,
      () => {},
      () => {},
    )
  shell.characterName('mika-id', 'Mika')
  // T5: the state reported before the tray exists is there when the tray is created.
  shell.connectorOperation(
    { restarts: 0, restartPending: false, activity: { tool: 'browser', background: false } },
    control,
  )
  shell.update(defaultPreferences)
  const tray = os.trays[0] as FakeTray
  const labels = () => tray.menu.map((item) => item.label).filter(Boolean)
  expect(labels()).toEqual(['Yuki 正在操作瀏覽器', '停止', '開啟 Mika', '顯示視窗', '結束'])
  tray.menu.find((item) => item.label === '停止')!.click!()
  expect(control).toHaveBeenLastCalledWith('owner')
  shell.connectorOperation(
    {
      restarts: 0,
      restartPending: false,
      control: { holder: 'none', since: '2026-11-10T01:00:00Z', reason: 'resume' },
      activity: { tool: 'computer', background: false },
    },
    control,
  )
  expect(labels()[0]).toBe('Yuki 正在操作電腦')
  // T6: one window in the background, the owner's cursor untouched; still stoppable.
  shell.connectorOperation(
    { restarts: 0, restartPending: false, activity: { tool: 'computer', background: true } },
    control,
  )
  expect(labels().slice(0, 2)).toEqual(['Yuki 正在背景操作電腦', '停止'])
  // T2/T4: a stop wins over a late activity line and says it came from 「停止」.
  shell.connectorOperation(
    {
      restarts: 0,
      restartPending: false,
      control: { holder: 'owner', since: '2026-11-10T01:00:05Z', reason: 'desktop' },
      activity: { tool: 'computer', background: true },
    },
    control,
  )
  expect(labels()).toEqual(['已按「停止」叫停', '繼續', '開啟 Mika', '顯示視窗', '結束'])
  tray.menu.find((item) => item.label === '繼續')!.click!()
  expect(control).toHaveBeenLastCalledWith('none')
  // T3: idle, an old Connector and no Connector add nothing.
  for (const supervision of [
    {
      restarts: 0,
      restartPending: false,
      control: { holder: 'none' as const, since: '2026-11-10T01:00:00Z', reason: 'start' },
    },
    { restarts: 0, restartPending: false },
    undefined,
  ]) {
    shell.connectorOperation(supervision, control)
    expect(labels()).toEqual(['開啟 Mika', '顯示視窗', '結束'])
  }
  expect(control).toHaveBeenCalledTimes(2)
  shell.close()
})

/*
 * Language switch (task book 2026-11-13 §4 item 26), written before the code: after the
 * language changes, the tray (its open/show/quit items and the Connector line already shown)
 * keeps the old language until something else rebuilds it, or needs a restart.
 */
it('rebuilds the existing tray menu, Connector line included, in the new language', () => {
  os.trays.length = 0
  const shell = new NativeShell(
    () => undefined,
    () => {},
    () => {},
  )
  shell.characterName('mika-id', 'Mika')
  shell.connectorOperation(
    { restarts: 0, restartPending: false, activity: { tool: 'browser', background: true } },
    () => {},
  )
  shell.update(defaultPreferences)
  const tray = os.trays[0] as FakeTray
  const labels = () => tray.menu.map((item) => item.label).filter(Boolean)
  expect(labels()).toEqual(['Yuki 正在背景操作瀏覽器', '停止', '開啟 Mika', '顯示視窗', '結束'])
  try {
    setLanguage('en')
    shell.relocalize()
    expect(labels()).toEqual([
      'Yuki is using the browser in the background',
      'Stop',
      'Open Mika',
      'Show Window',
      'Quit',
    ])
    setLanguage('zh-Hans')
    shell.relocalize()
    expect(labels()).toEqual(['Yuki 正在后台操作浏览器', '停止', '打开 Mika', '显示窗口', '退出'])
  } finally {
    setLanguage('zh-Hant')
    shell.close()
  }
})
