import type { ElectronApplication } from '@playwright/test'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

export interface NativeFileDialogReceipt {
  Action: 'open' | 'save' | 'folder'
  ProcessId: number
  SessionId: number
  DialogClass: string
  OwnerWindowHandle: number
  DialogHandle: number
  FilenameControl: number
  DefaultButton: number
  Method: 'native-win32-controls'
}

export interface NativeFileDialogOwner {
  processId: number
  executable: string
  handle: string
}

/** Capture the owner before opening a modal native picker. */
export async function windowsFileDialogOwner(
  app: ElectronApplication,
): Promise<NativeFileDialogOwner> {
  return app.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    return {
      processId: process.pid,
      executable: app.getPath('exe'),
      handle: window.getNativeWindowHandle().readBigUInt64LE().toString(),
    }
  })
}

/** Completes the real picker. Its native callback and resulting bytes remain under test. */
export async function completeWindowsFileDialog(
  owner: NativeFileDialogOwner,
  selectionPath: string,
  action: 'open' | 'save' | 'folder',
): Promise<NativeFileDialogReceipt> {
  if (process.platform !== 'win32') throw Error('Requires a Windows interactive desktop')
  const script = await readFile(new URL('./windows-file-dialog.ps1', import.meta.url), 'utf8')
  const request = Buffer.from(JSON.stringify({ ...owner, selectionPath, action })).toString(
    'base64',
  )
  const command =
    `$request=ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request}')));\n` +
    `& {\n${script}\n} -OwnerProcessId ([int]$request.processId) -OwnerWindowHandle ([long]$request.handle) ` +
    '-ExpectedExecutable $request.executable -SelectionPath $request.selectionPath -Action $request.action'
  try {
    const result = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(command, 'utf16le').toString('base64'),
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024 },
    )
    return JSON.parse(result.stdout) as NativeFileDialogReceipt
  } catch (error) {
    const stderr = (error as Error & { stderr?: string }).stderr
    throw Error(
      `Native Windows file dialog failed: ${stderr?.slice(0, 2500) ?? 'process did not complete'}`,
    )
  }
}
