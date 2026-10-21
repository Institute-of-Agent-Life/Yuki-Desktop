import { _electron as electron } from '@playwright/test'

export function launchShell(data: string, executablePath = process.env.YUKI_ELECTRON_EXECUTABLE) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined,
    ),
  )
  env.YUKI_DESKTOP_DATA = data
  return electron.launch({
    executablePath,
    args: executablePath ? [] : ['.'],
    env,
    chromiumSandbox: true,
  })
}
