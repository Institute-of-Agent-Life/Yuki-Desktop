param([int]$ExpectedProcessId,[long]$WindowHandle,[string]$Executable,[string[]]$Path,[switch]$Dismiss)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class OwnedMenuWindows {
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 public delegate bool EnumProc(IntPtr hwnd,IntPtr extra);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback,IntPtr extra);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr key,IntPtr extra);
 public static IntPtr[] ForProcess(uint expected) {
  var handles=new List<IntPtr>();
  EnumWindows((hwnd,extra)=>{uint pid;GetWindowThreadProcessId(hwnd,out pid);if(pid==expected&&IsWindowVisible(hwnd))handles.Add(hwnd);return true;},IntPtr.Zero);
  return handles.ToArray();
 }
}
'@
if([OwnedMenuWindows]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) -eq [IntPtr]::Zero){throw 'Physical coordinates unavailable'}
$owned=Get-CimInstance Win32_Process -Filter "ProcessId=$ExpectedProcessId"
if(!$owned -or $owned.ExecutablePath -cne $Executable){throw 'Refuse unrelated process'}
$session=[Diagnostics.Process]::GetProcessById($ExpectedProcessId).SessionId
if(!$session -or $session -ne [Diagnostics.Process]::GetCurrentProcess().SessionId){throw 'Requires the same interactive session'}
[uint32]$windowOwner=0
[void][OwnedMenuWindows]::GetWindowThreadProcessId([IntPtr]::new($WindowHandle),[ref]$windowOwner)
if($windowOwner -ne $ExpectedProcessId){throw 'Refuse unrelated owner window'}
$condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::MenuItem)
function Get-OwnedItems {
 $items=@();$seen=@{}
 foreach($handle in [OwnedMenuWindows]::ForProcess($ExpectedProcessId)){
  $element=[Windows.Automation.AutomationElement]::FromHandle($handle)
  foreach($item in $element.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)){
   if($item.Current.ProcessId -ne $ExpectedProcessId){throw 'Refuse unrelated menu element'}
   $key=($item.GetRuntimeId() -join ',')
   if(!$item.Current.IsOffscreen -and !$seen.ContainsKey($key)){$items+=,[pscustomobject]@{element=$item;windowHandle=$handle.ToInt64()};$seen[$key]=$true}
  }
 }
 return $items
}
$steps=@()
foreach($label in $Path){
 $deadline=[DateTime]::UtcNow.AddSeconds(5);$target=$null
 do {
  $matches=@(Get-OwnedItems | Where-Object {
   $name=$_.element.Current.Name
   ($name -ceq $label) -or ($name.StartsWith($label+' ',[StringComparison]::Ordinal) -and $name.Substring($label.Length+1) -match '^(Ctrl|Alt|Shift|Win)\+')
  })
  if($matches.Count -eq 1){$target=$matches[0].element;break}
  if($matches.Count -gt 1){throw "Ambiguous owned native menu item: $label"}
  Start-Sleep -Milliseconds 100
 } while([DateTime]::UtcNow -lt $deadline)
 if(!$target -or !$target.Current.IsEnabled){throw "Native menu item unavailable: $label; available=$((Get-OwnedItems | ForEach-Object {$_.element.Current.Name}) -join ' | ')"}
 $supported=@($target.GetSupportedPatterns() | ForEach-Object {$_.ProgrammaticName})
 if($supported -contains 'ExpandCollapsePatternIdentifiers.Pattern'){
  $target.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
  $method='UIA ExpandCollapsePattern.Expand'
 } elseif($supported -contains 'InvokePatternIdentifiers.Pattern'){
  $target.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
  $method='UIA InvokePattern.Invoke'
 } else {throw "Native menu item has no supported action: $label"}
 $steps+=[pscustomobject]@{name=$label;method=$method}
}
$items=@()
foreach($item in (Get-OwnedItems)){
 $c=$item.element.Current;$rect=$c.BoundingRectangle
 $items+=[pscustomobject]@{name=$c.Name;windowHandle=$item.windowHandle;class=$c.ClassName;processId=$c.ProcessId;enabled=$c.IsEnabled;rect=@($rect.X,$rect.Y,$rect.Width,$rect.Height);patterns=@($item.element.GetSupportedPatterns()|ForEach-Object {$_.ProgrammaticName})}
}
if($Dismiss){
 $foreground=[OwnedMenuWindows]::GetForegroundWindow();[uint32]$foregroundOwner=0
 [void][OwnedMenuWindows]::GetWindowThreadProcessId($foreground,[ref]$foregroundOwner)
 if($foregroundOwner -ne $ExpectedProcessId){throw 'Refuse keyboard input to unrelated foreground window'}
 if(![OwnedMenuWindows]::PostMessage($foreground,0x0100,[IntPtr]::new(0x1B),[IntPtr]::Zero)){throw 'Escape key down failed'}
 if(![OwnedMenuWindows]::PostMessage($foreground,0x0101,[IntPtr]::new(0x1B),[IntPtr]::Zero)){throw 'Escape key up failed'}
}
[pscustomobject]@{processId=$ExpectedProcessId;sessionId=$session;ownerWindowHandle=$WindowHandle;steps=$steps;items=$items;dismissed=[bool]$Dismiss;method='owned-native-menu-uia'}|ConvertTo-Json -Depth 7 -Compress
