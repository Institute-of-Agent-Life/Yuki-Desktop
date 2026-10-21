import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { NativeFileDialogOwner } from './windows-file-dialog'

export interface NativeMenuReceipt {
  processId: number
  sessionId: number
  ownerWindowHandle: number
  steps: { name: string; method: string }[]
  items: {
    name: string
    windowHandle: number
    class: string
    processId: number
    enabled: boolean
    rect: [number, number, number, number]
    patterns: string[]
  }[]
  dismissed: boolean
  method: 'owned-native-menu-uia'
}

/** Opens real menu items through UIA within the selected app's interactive process. */
export async function nativeWindowsMenu(
  owner: NativeFileDialogOwner,
  options: { path?: string[]; dismiss?: boolean } = {},
): Promise<NativeMenuReceipt> {
  if (process.platform !== 'win32') throw Error('Requires a Windows interactive desktop')
  const source = await readFile(new URL('./windows-application-menu.ps1', import.meta.url), 'utf8')
  const payload = Buffer.from(
    JSON.stringify({ path: [], dismiss: false, ...owner, ...options }),
    'utf8',
  ).toString('base64')
  const command = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source, 'utf8').toString('base64')}')))) -ExpectedProcessId $request.processId -WindowHandle $request.handle -Executable $request.executable -Path @($request.path) -Dismiss:([bool]$request.dismiss)`
  let stdout: string
  try {
    ;({ stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 65536 },
    ))
  } catch (error) {
    const stderr = (error as Error & { stderr?: string }).stderr
    throw Error(`Native Windows menu failed: ${stderr?.slice(-3000) ?? 'process did not complete'}`)
  }
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as NativeMenuReceipt
}
