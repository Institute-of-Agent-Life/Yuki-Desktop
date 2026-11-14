import { expect } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'
import type { NativeFileDialogOwner } from './windows-file-dialog'

interface Target extends NativeFileDialogOwner {
  directory: string
  sessionId: number
  rect: number[]
}
const encode = (value: string) => Buffer.from(value, 'utf16le').toString('base64')
async function run(source: string) {
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(source)],
    { encoding: 'utf8', timeout: 30000, windowsHide: true },
  ).catch((error: { stderr?: string; message: string }) => {
    throw Error(`Native artifact helper failed: ${error.stderr || error.message}`)
  })
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as unknown
}
export async function artifactDropTarget(directory: string, filename: string, sha256: string) {
  if (process.platform !== 'win32') throw Error('Requires Windows native drag and drop')
  await mkdir(directory, { recursive: false })
  const source = await readFile(
    new URL('./windows-artifact-drop-target.ps1', import.meta.url),
    'utf8',
  )
  const parameters = Buffer.from(JSON.stringify({ directory, filename, sha256 }), 'utf8').toString(
    'base64',
  )
  const script = `$ErrorActionPreference='Stop';$q=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${parameters}'))|ConvertFrom-Json;& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source, 'utf8').toString('base64')}')))) -Directory $q.directory -Filename $q.filename -Sha256 $q.sha256`
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encode(script)], {
    windowsHide: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString()
  })
  const close = async () => {
    if (child.exitCode === null) child.kill()
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve()
      else child.once('exit', () => resolve())
    })
    await writeFile(join(directory, 'receiver.stderr.log'), stderr)
  }
  try {
    const ready = join(directory, 'target.json')
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null) throw Error(stderr || `Drop target exited ${child.exitCode}`)
          return readFile(ready, 'utf8').then(
            () => true,
            () => false,
          )
        },
        { timeout: 15000 },
      )
      .toBe(true)
    const target = JSON.parse((await readFile(ready, 'utf8')).replace(/^\uFEFF/, '')) as Target
    expect(target.processId).toBe(child.pid)
    expect(target.sessionId).toBeGreaterThan(0)
    return { target, close }
  } catch (error) {
    await close()
    throw error
  }
}
export async function dragOriginalArtifact(
  source: NativeFileDialogOwner,
  target: Target,
  point: { x: number; y: number },
  zoom: number,
) {
  const script = await readFile(new URL('./windows-artifact-drag.ps1', import.meta.url), 'utf8')
  const parameters = Buffer.from(JSON.stringify({ source, target, point, zoom }), 'utf8').toString(
    'base64',
  )
  return run(
    `$ErrorActionPreference='Stop';& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(script, 'utf8').toString('base64')}')))) -Request '${parameters}'`,
  )
}

export interface RevealedArtifact {
  handle: number
  directory: string
  selected: string[]
}
export async function revealedArtifact(
  directory: string,
  close = false,
): Promise<RevealedArtifact | null> {
  const parameters = Buffer.from(JSON.stringify({ directory, close }), 'utf8').toString('base64')
  return (await run(
    `$ErrorActionPreference='Stop';$q=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${parameters}'))|ConvertFrom-Json;$shell=New-Object -ComObject Shell.Application;foreach($window in $shell.Windows()){try{if([IO.Path]::GetFileName([string]$window.FullName) -ine 'explorer.exe'){continue};$folder=[string]$window.Document.Folder.Self.Path;if(![string]::Equals($folder,$q.directory,[StringComparison]::OrdinalIgnoreCase)){continue};$selected=@($window.Document.SelectedItems()|ForEach-Object {$_.Path});$result=[pscustomobject]@{handle=[long]$window.HWND;directory=$folder;selected=$selected};if($q.close){$window.Quit()};$result|ConvertTo-Json -Compress;exit 0}catch{continue}};Write-Output 'null'`,
  )) as RevealedArtifact | null
}
