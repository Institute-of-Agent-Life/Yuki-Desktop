import { _electron as electron } from '@playwright/test'
import { basename, dirname } from 'node:path'
import { isolatedDesktop } from './isolated-desktop'

export async function launchShell(
  data: string,
  executablePath = process.env.YUKI_ELECTRON_EXECUTABLE,
) {
  if (!executablePath) {
    const desktop = await isolatedDesktop(dirname(data), { nativeShell: true })
    return desktop.launch(basename(data))
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined,
    ),
  )
  env.YUKI_DESKTOP_DATA = data
  return electron.launch({
    executablePath,
    args: [],
    env,
    chromiumSandbox: true,
  })
}
