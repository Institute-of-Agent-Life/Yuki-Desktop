import { join } from 'node:path'

/** Bounded test workload: a file notification releases the original native command. */
export function nativeProbe(project: string, marker: string) {
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
  const path = join(project, 'native-probe.ps1')
  return {
    path,
    command: `& ${quote(path)}`,
    content: `
$ErrorActionPreference='Stop'
$utf8=[Text.UTF8Encoding]::new($false)
$marker=${quote(marker)}
$watcher=[IO.FileSystemWatcher]::new($PSScriptRoot,'release')
$eventName='yuki-live-'+$marker
$subscription=Register-ObjectEvent -InputObject $watcher -EventName Created -SourceIdentifier $eventName
$watcher.EnableRaisingEvents=$true
try {
  [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'invocations.txt'),$marker+"\n",$utf8)
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'started.txt'),$marker,$utf8)
  if (![IO.File]::Exists((Join-Path $PSScriptRoot 'release'))) {
    $signal=Wait-Event -SourceIdentifier $eventName -Timeout 120
    if ($null -eq $signal) { throw 'The isolated test did not release its file-notification gate' }
    Remove-Event -EventIdentifier $signal.EventIdentifier
  }
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'result.txt'),$marker,$utf8)
  [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'result.txt'),$utf8)
} finally {
  Unregister-Event -SourceIdentifier $eventName
  $watcher.Dispose()
}
`,
  }
}
