param([string]$Request)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$q=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Request))|ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ArtifactNativeDrag {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; public Point(int x,int y){X=x;Y=y;} }
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd,ref Point point);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
}
'@
[void][ArtifactNativeDrag]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$session=[Diagnostics.Process]::GetCurrentProcess().SessionId
foreach($owner in @($q.source,$q.target)){
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.processId)"
 if(!$p -or ![string]::Equals($p.ExecutablePath,$owner.executable,[StringComparison]::OrdinalIgnoreCase)){throw 'Refuse unrelated native process'}
 if($session -le 0 -or [Diagnostics.Process]::GetProcessById($owner.processId).SessionId -ne $session){throw 'Requires own interactive session'}
 [uint32]$pidOfWindow=0
 [void][ArtifactNativeDrag]::GetWindowThreadProcessId([IntPtr]::new([long]$owner.handle),[ref]$pidOfWindow)
 if($pidOfWindow -ne $owner.processId){throw 'Refuse unrelated native window'}
}
$source=[IntPtr]::new([long]$q.source.handle);$target=[IntPtr]::new([long]$q.target.handle)
$origin=[ArtifactNativeDrag+Point]::new(0,0)
if(![ArtifactNativeDrag]::ClientToScreen($source,[ref]$origin)){throw 'Source client origin missing'}
$scale=[ArtifactNativeDrag]::GetDpiForWindow($source)/96.0*[double]$q.zoom
$from=[ArtifactNativeDrag+Point]::new([int][Math]::Round($origin.X+$q.point.x*$scale),[int][Math]::Round($origin.Y+$q.point.y*$scale))
$r=[ArtifactNativeDrag+Rect]::new()
if(![ArtifactNativeDrag]::GetWindowRect($target,[ref]$r)){throw 'Target bounds missing'}
$to=[ArtifactNativeDrag+Point]::new([int](($r.Left+$r.Right)/2),[int](($r.Top+$r.Bottom)/2))
function Assert-OwnedPoint($point){
 $h=[ArtifactNativeDrag]::WindowFromPoint($point);[uint32]$actual=0
 [void][ArtifactNativeDrag]::GetWindowThreadProcessId($h,[ref]$actual)
 if($actual -ne $q.source.processId -and $actual -ne $q.target.processId){throw 'Pointer route crosses an unrelated window'}
}
[void][ArtifactNativeDrag]::SetForegroundWindow($source)
Start-Sleep -Milliseconds 150
[uint32]$foreground=0
[void][ArtifactNativeDrag]::GetWindowThreadProcessId([ArtifactNativeDrag]::GetForegroundWindow(),[ref]$foreground)
if($foreground -ne $q.source.processId){throw 'Own source did not obtain foreground'}
Assert-OwnedPoint $from
$original=[ArtifactNativeDrag+Point]::new(0,0);[void][ArtifactNativeDrag]::GetCursorPos([ref]$original)
$held=$false;$completed=$false
try {
 [void][ArtifactNativeDrag]::SetCursorPos($from.X,$from.Y)
 [ArtifactNativeDrag]::mouse_event(2,0,0,0,[UIntPtr]::Zero);$held=$true
 for($i=1;$i -le 30;$i++){
  $point=[ArtifactNativeDrag+Point]::new([int]($from.X+($to.X-$from.X)*$i/30),[int]($from.Y+($to.Y-$from.Y)*$i/30))
  Assert-OwnedPoint $point
  [void][ArtifactNativeDrag]::SetCursorPos($point.X,$point.Y)
  Start-Sleep -Milliseconds 60
 }
 $watch=[Diagnostics.Stopwatch]::StartNew();$entered=Join-Path $q.target.directory 'entered.json'
 while(!(Test-Path -LiteralPath $entered) -and $watch.Elapsed.TotalSeconds -lt 12){
  Assert-OwnedPoint $to
  [void][ArtifactNativeDrag]::SetCursorPos($to.X+1,$to.Y)
  Start-Sleep -Milliseconds 100
  [void][ArtifactNativeDrag]::SetCursorPos($to.X,$to.Y)
 }
 if(!(Test-Path -LiteralPath $entered)){throw 'Native target did not observe FileDrop DragEnter'}
 [ArtifactNativeDrag]::mouse_event(4,0,0,0,[UIntPtr]::Zero);$held=$false;$completed=$true
 [pscustomobject]@{sourceProcessId=$q.source.processId;targetProcessId=$q.target.processId;sessionId=$session;scale=$scale;from=@($from.X,$from.Y);to=@($to.X,$to.Y);nativeMouseInput=$true}|ConvertTo-Json -Compress
} finally {
 if($held){[void][ArtifactNativeDrag]::SetCursorPos($from.X,$from.Y);[ArtifactNativeDrag]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
 [void][ArtifactNativeDrag]::SetCursorPos($original.X,$original.Y)
}
