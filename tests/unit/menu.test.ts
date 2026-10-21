import { expect, it, vi, afterEach } from 'vitest'
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { installMenu } from '../../src/main/menu'

const os = vi.hoisted(() => ({
  template: [] as MenuItemConstructorOptions[],
  sent: [] as unknown[][],
  options: {} as Record<string, unknown>,
  external: vi.fn(async (url: string) => void url),
  error: vi.fn(),
  about: vi.fn(),
  maximized: false,
  destroyed: false,
  maximizable: true,
}))
vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0-beta.1',
    setAboutPanelOptions: (options: Record<string, unknown>) => {
      os.options = options
    },
    showAboutPanel: () => os.about(),
  },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      os.template = template
      return template
    },
    setApplicationMenu: vi.fn(),
  },
  shell: { openExternal: (url: string) => os.external(url) },
  dialog: { showErrorBox: (...args: unknown[]) => os.error(...args) },
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  os.sent = []
  os.maximized = false
  os.destroyed = false
  os.maximizable = true
})
function build(platform: NodeJS.Platform) {
  const processOnPlatform = Object.create(process) as NodeJS.Process
  Object.defineProperty(processOnPlatform, 'platform', { value: platform })
  vi.stubGlobal('process', processOnPlatform)
  installMenu(
    () =>
      ({
        isDestroyed: () => os.destroyed,
        isMaximizable: () => os.maximizable,
        isMaximized: () => os.maximized,
        maximize: () => {
          os.maximized = true
        },
        unmaximize: () => {
          os.maximized = false
        },
        webContents: { send: (...args: unknown[]) => os.sent.push(args) },
      }) as unknown as BrowserWindow,
  )
  return os.template
}
function submenu(item: MenuItemConstructorOptions) {
  return item.submenu as MenuItemConstructorOptions[]
}
it.each(['darwin', 'win32', 'linux'] as const)(
  'preserves navigation and standard quit lifecycle on %s',
  (platform) => {
    const menu = build(platform)
    const file = submenu(menu.find((item) => item.label === '檔案')!)
    const settings = file.find((item) => item.label === '設定…')!
    settings.click!({} as never, {} as never, {} as never)
    expect(os.sent).toEqual([['yuki:command', 'settings']])
    const quit =
      platform === 'darwin'
        ? submenu(menu[0]!).find((item) => item.role === 'quit')
        : file.find((item) => item.role === 'quit')
    expect(quit?.role).toBe('quit')
    expect(quit?.click).toBeUndefined()
    expect(menu.find((item) => item.label === '說明')?.role).toBe('help')
    expect(os.options).toMatchObject({
      applicationName: 'Yuki',
      applicationVersion: '1.0.0-beta.1',
    })
    if (platform === 'darwin') expect(menu[0]!.label).toBe('Yuki')
  },
)
it('opens the public project help and reports a browser-launch failure', async () => {
  const help = submenu(build('win32').find((item) => item.role === 'help')!)
  os.external.mockRejectedValueOnce(Error('browser unavailable'))
  help.find((item) => item.label === '使用說明')!.click!({} as never, {} as never, {} as never)
  await vi.waitFor(() => expect(os.error).toHaveBeenCalledOnce())
  expect(os.external).toHaveBeenCalledWith(
    'https://github.com/Institute-of-Agent-Life/Yuki-Desktop',
  )
  expect(os.error.mock.calls[0]?.[0]).toBe('無法開啟使用說明')
})

it.each(['win32', 'linux'] as const)('uses supported window commands on %s', (platform) => {
  const menu = submenu(build(platform).find((item) => item.label === '視窗')!)
  expect(menu.some((item) => item.role === 'zoom' || item.role === 'front')).toBe(false)
  const toggle = menu.find((item) => item.label === '最大化／還原')!
  toggle.click!({} as never, {} as never, {} as never)
  expect(os.maximized).toBe(true)
  toggle.click!({} as never, {} as never, {} as never)
  expect(os.maximized).toBe(false)
  os.destroyed = true
  toggle.click!({} as never, {} as never, {} as never)
  expect(os.maximized).toBe(false)
  os.destroyed = false
  os.maximizable = false
  toggle.click!({} as never, {} as never, {} as never)
  expect(os.maximized).toBe(false)
})
