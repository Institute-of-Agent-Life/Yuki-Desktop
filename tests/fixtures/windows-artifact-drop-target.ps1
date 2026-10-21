param([string]$Directory,[string]$Filename,[string]$Sha256)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ProgressPreference='SilentlyContinue'
function Stage($value){[IO.File]::AppendAllText((Join-Path $Directory 'startup.log'),$value+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))}
Stage 'starting'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ArtifactDropWindow {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
}
'@
Stage 'types-ready'
[Windows.Forms.Application]::SetUnhandledExceptionMode([Windows.Forms.UnhandledExceptionMode]::ThrowException)
[void][ArtifactDropWindow]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
if(!(Test-Path -LiteralPath $Directory -PathType Container)){throw 'Missing isolated probe directory'}
$form=New-Object System.Windows.Forms.Form
$form.Text='Yuki artifact drop '+[IO.Path]::GetFileName($Directory)
$form.Width=230;$form.Height=180;$form.TopMost=$true;$form.AllowDrop=$true
$form.StartPosition='Manual'
$area=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location=[Drawing.Point]::new($area.Right-$form.Width-12,$area.Bottom-$form.Height-12)
$label=New-Object Windows.Forms.Label
$label.Text='Drop the original Yuki artifact here';$label.Dock='Fill';$label.TextAlign='MiddleCenter';$label.AllowDrop=$true
$form.Controls.Add($label)
$enter={
 param($sender,$event)
 if($event.Data.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)){
  $event.Effect=[Windows.Forms.DragDropEffects]::Copy
  [IO.File]::WriteAllText((Join-Path $Directory 'entered.json'),'{"nativeFileDrop":true}',[Text.UTF8Encoding]::new($false))
 }
}
$drop={
 param($sender,$event)
 try {
  $files=@($event.Data.GetData([Windows.Forms.DataFormats]::FileDrop))
  if($files.Count -ne 1){throw 'Expected one original file'}
  $file=[string]$files[0]
  [IO.File]::WriteAllText((Join-Path $Directory 'received.json'),([pscustomobject]@{files=$files;expectedFilename=$Filename;expectedSha256=$Sha256}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  if([IO.Path]::GetFileName($file) -cne $Filename){throw 'Unexpected original filename'}
  $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower()
  if($hash -cne $Sha256){throw 'Original content hash mismatch'}
  $destination=Join-Path $Directory $Filename
  if(Test-Path -LiteralPath $destination){throw 'Preserve an existing destination'}
  [IO.File]::Copy($file,$destination,$false)
  $receipt=[pscustomobject]@{event='native-WinForms-DragDrop';processId=$PID;handle=$form.Handle.ToInt64();source=$file;destination=$destination;sha256=$hash;filename=$Filename;effect='Copy';observed=[DateTime]::UtcNow.ToString('o')}
  [IO.File]::WriteAllText((Join-Path $Directory 'dropped.json'),($receipt|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  $label.Text='Original file received'
 } catch {
  [IO.File]::WriteAllText((Join-Path $Directory 'drop-error.json'),([pscustomobject]@{error=$_.Exception.Message}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
 }
}
$form.add_DragEnter($enter);$label.add_DragEnter($enter)
$form.add_DragDrop($drop);$label.add_DragDrop($drop)
$form.add_Shown({
 Stage 'shown'
 $r=[ArtifactDropWindow+Rect]::new()
 if(![ArtifactDropWindow]::GetWindowRect($form.Handle,[ref]$r)){throw 'Unable to read own target bounds'}
 $receipt=[pscustomobject]@{processId=$PID;handle=$form.Handle.ToInt64().ToString();executable=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName;sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId;directory=$Directory;rect=@($r.Left,$r.Top,($r.Right-$r.Left),($r.Bottom-$r.Top))}
 [IO.File]::WriteAllText((Join-Path $Directory 'target.json'),($receipt|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
})
$timer=New-Object Windows.Forms.Timer;$timer.Interval=120000;$timer.add_Tick({$form.Close()});$timer.Start()
Stage 'running'
try{[Windows.Forms.Application]::Run($form)}finally{$timer.Stop();$timer.Dispose();$form.Dispose()}
