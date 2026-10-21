import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { execFileSync } from 'node:child_process'

const nativeFrame = { frame: true, titleBarStyle: 'default', titleBarOverlay: false } as const

function linuxFrameOptions(
  platform: NodeJS.Platform,
  desktop: string,
): Pick<BrowserWindowConstructorOptions, 'frame' | 'titleBarStyle' | 'titleBarOverlay'> {
  if (platform !== 'linux' || !/(^|:)(gnome(?:-[^:]*)?|ubuntu(?:-[^:]*)?)(:|$)/i.test(desktop))
    return {}
  try {
    const output = execFileSync(
      'gsettings',
      ['get', 'org.gnome.desktop.wm.preferences', 'button-layout'],
      { encoding: 'utf8', timeout: 1000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const layout = output.trim().match(/^(['"])([^\r\n]*)\1$/)?.[2]
    // Electron 42 WCO has a fixed button layout. Keep native decorations for other layouts.
    return layout === ':minimize,maximize,close' ? {} : nativeFrame
  } catch {
    // An unavailable session bus, schema or command must not replace the user's layout.
    return nativeFrame
  }
}

export function createPlatformWindow(
  options: BrowserWindowConstructorOptions,
  platform: NodeJS.Platform = process.platform,
  desktop = process.env.XDG_CURRENT_DESKTOP ||
    process.env.XDG_SESSION_DESKTOP ||
    process.env.DESKTOP_SESSION ||
    '',
): BrowserWindow {
  const frame = linuxFrameOptions(platform, desktop)
  try {
    return new BrowserWindow({ ...options, ...frame })
  } catch (error) {
    if (platform !== 'linux' || !options.titleBarOverlay || frame.titleBarOverlay === false)
      throw error
    try {
      return new BrowserWindow({ ...options, ...nativeFrame })
    } catch (fallbackError) {
      throw new AggregateError([error, fallbackError], 'The desktop window could not be created')
    }
  }
}
