param([int]$ExpectedProcessId,[long]$WindowHandle,[string]$Executable,[string]$OutputPath,[string]$InvokeName,[switch]$CaptureOnly)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
if(!$CaptureOnly){
 Add-Type -AssemblyName UIAutomationClient
 Add-Type -AssemblyName UIAutomationTypes
}
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class DesktopWindowCapture {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
 [DllImport("user32.dll",SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint id);
 [DllImport("user32.dll",SetLastError=true)] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll",SetLastError=true)] public static extern bool PrintWindow(IntPtr hwnd,IntPtr hdc,uint flags);
 public static int[] Save(IntPtr hwnd,string path) {
  Rect r; if(!GetWindowRect(hwnd,out r))throw new Exception("Window rectangle unavailable");
  int w=r.Right-r.Left,h=r.Bottom-r.Top;
  if(w<=0||h<=0||w>10000||h>10000)throw new Exception("Invalid own-window rectangle");
  using(var bitmap=new Bitmap(w,h,PixelFormat.Format32bppArgb))using(var graphics=Graphics.FromImage(bitmap)) {
   IntPtr hdc=graphics.GetHdc();
   try { if(!PrintWindow(hwnd,hdc,2))throw new Exception("Own-window PrintWindow failed"); }
   finally { graphics.ReleaseHdc(hdc); }
   bitmap.Save(path,ImageFormat.Png);
  }
  return new int[]{r.Left,r.Top,w,h};
 }
}
'@
if([DesktopWindowCapture]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) -eq [IntPtr]::Zero){throw 'Unable to select physical pixel coordinates'}
$ownedProcess=[Diagnostics.Process]::GetProcessById($ExpectedProcessId)
if($ownedProcess.MainModule.FileName -cne $Executable){throw 'Refuse unrelated process'}
$sessionId=$ownedProcess.SessionId
if($sessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId -or $sessionId -eq 0){throw 'Requires the same interactive session'}
$handle=[IntPtr]::new($WindowHandle)
[uint32]$ownerId=0
[void][DesktopWindowCapture]::GetWindowThreadProcessId($handle,[ref]$ownerId)
if($ownerId -ne $ExpectedProcessId){throw 'Refuse unrelated window'}
$buttons=@()
$invoked=$null
if(!$CaptureOnly){
$element=[Windows.Automation.AutomationElement]::FromHandle($handle)
$condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
$target=$null
foreach($button in $element.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)){
 $current=$button.Current;$r=$current.BoundingRectangle
 if($current.ClassName -ne 'WinCaptionButton'){continue}
 if($current.ProcessId -ne $ExpectedProcessId){throw 'Refuse unrelated caption button'}
 if($InvokeName -and $current.Name -ceq $InvokeName){if($target){throw 'Ambiguous native caption button'};$target=$button}
 $buttons+= [pscustomobject]@{name=$current.Name;id=$current.AutomationId;class=$current.ClassName;processId=$current.ProcessId;handle=$current.NativeWindowHandle;offscreen=$current.IsOffscreen;enabled=$current.IsEnabled;rect=@($r.X,$r.Y,$r.Width,$r.Height);patterns=@($button.GetSupportedPatterns()|ForEach-Object {$_.ProgrammaticName})}
}
if($InvokeName){
 if(!$target -or !$target.Current.IsEnabled -or $target.Current.IsOffscreen){throw 'Native caption button unavailable'}
 $pattern=$target.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
 $pattern.Invoke()
 $invoked=$InvokeName
}
}
$rect=$null
if($OutputPath){
 if(Test-Path -LiteralPath $OutputPath){throw 'Preserve existing capture'}
 $rect=[DesktopWindowCapture]::Save($handle,$OutputPath)
}
$method=if($CaptureOnly){'own-hwnd-printwindow'}else{'native-uia-caption-and-own-hwnd-printwindow'}
[pscustomobject]@{invoked=$invoked;processId=$ExpectedProcessId;sessionId=$sessionId;handle=$WindowHandle;method=$method;physicalCoordinates=$true;windowDpi=[DesktopWindowCapture]::GetDpiForWindow($handle);rect=$rect;output=$OutputPath;buttons=$buttons}|ConvertTo-Json -Depth 6 -Compress
