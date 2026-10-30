/* eslint @typescript-eslint/no-require-imports: off */
/* global require: readonly */
// The test entry loads this before the real app; only test-window activation is adapted.
const process = require('node:process')

if (process.platform === 'win32') {
  const { app } = require('electron')
  const { execFile } = require('node:child_process')
  const { Buffer } = require('node:buffer')
  const evidence = { processId: process.pid, showCalls: [] }
  globalThis.__yukiBackgroundWindows = evidence

  app.on('browser-window-created', (_event, window) => {
    window.setFocusable(false)
    window.show = () => {
      const handle = window.getNativeWindowHandle().readBigUInt64LE().toString()
      const call = { handle, completed: false }
      evidence.showCalls.push(call)
      const script = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BackgroundTestWindow {
  [DllImport("user32.dll",SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr handle,out uint processId);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll",SetLastError=true)] public static extern bool SetWindowPos(IntPtr handle,IntPtr after,int x,int y,int width,int height,uint flags);
}
'@
$handle=[IntPtr]::new([long]${handle})
[uint32]$owner=0
[void][BackgroundTestWindow]::GetWindowThreadProcessId($handle,[ref]$owner)
if($owner -ne ${process.pid}){throw 'Background window handle does not belong to this test process'}
$before=[BackgroundTestWindow]::GetForegroundWindow()
[uint32]$beforeOwner=0
[void][BackgroundTestWindow]::GetWindowThreadProcessId($before,[ref]$beforeOwner)
if(-not [BackgroundTestWindow]::SetWindowPos($handle,[IntPtr]::new(1),0,0,0,0,0x53)){
  throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
}
$after=[BackgroundTestWindow]::GetForegroundWindow()
[uint32]$afterOwner=0
[void][BackgroundTestWindow]::GetWindowThreadProcessId($after,[ref]$afterOwner)
[pscustomobject]@{
  method='win32-setwindowpos-bottom-noactivate'
  nativeProcessId=$owner
  foregroundBefore=$before.ToInt64().ToString()
  foregroundBeforeProcessId=$beforeOwner
  foregroundAfter=$after.ToInt64().ToString()
  foregroundAfterProcessId=$afterOwner
  foregroundIsSelf=($afterOwner -eq ${process.pid})
  flags=0x53
} | ConvertTo-Json -Compress
`
      execFile(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 20000, maxBuffer: 65536 },
        (error, stdout, stderr) => {
          if (error) {
            call.error = stderr.trim() || error.message
            process.stderr.write(`Background test window failed: ${call.error}\n`)
            app.exit(1)
            return
          }
          Object.assign(call, JSON.parse(stdout.trim()), { completed: true })
        },
      )
    }
  })
}
