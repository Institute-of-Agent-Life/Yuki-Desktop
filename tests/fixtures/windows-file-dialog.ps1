param(
  [Parameter(Mandatory)][int]$OwnerProcessId,
  [Parameter(Mandatory)][long]$OwnerWindowHandle,
  [Parameter(Mandatory)][string]$ExpectedExecutable,
  [Parameter(Mandatory)][string]$SelectionPath,
  [Parameter(Mandatory)][ValidateSet('open', 'save')][string]$Action
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($Action -eq 'open' -and -not (Test-Path -LiteralPath $SelectionPath -PathType Leaf)) { throw 'Test input does not exist' }
if ($Action -eq 'save' -and (Test-Path -LiteralPath $SelectionPath)) { throw 'Refusing to overwrite an existing test destination' }
$owner = Get-Process -Id $OwnerProcessId
if ($owner.SessionId -le 0 -or -not [string]::Equals($owner.Path, $ExpectedExecutable, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected app process or desktop session' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$OwnerWindowHandle)
if ($root.Current.ProcessId -ne $OwnerProcessId) { throw 'Window belongs to another process' }
$dialogCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')
$watch = [Diagnostics.Stopwatch]::StartNew()
$nativeDialog = $null
while ($watch.Elapsed.TotalSeconds -lt 15) {
  $nativeDialog = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $dialogCondition)
  if ($nativeDialog) { break }
  Start-Sleep -Milliseconds 100
}
if (-not $nativeDialog -or $nativeDialog.Current.ProcessId -ne $OwnerProcessId) { throw 'Own native file dialog did not open' }
# Electron uses the classic filename combo in its Open dialog and the modern
# FileNameControlHost in its Save dialog on this Windows host.
$filenameId = if ($Action -eq 'open') { 1148 } else { 1001 }
$filenameRoot = $nativeDialog
if ($Action -eq 'save') {
  $hostCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'FileNameControlHost')
  $filenameRoot = $nativeDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $hostCondition)
  if (-not $filenameRoot) { throw 'Own native Save dialog has no filename host' }
}
$editCondition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, [string]$filenameId),
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Edit'))
$buttonCondition = [System.Windows.Automation.AndCondition]::new(
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1'),
  [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'Button'))
$edit = $filenameRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
$button = $nativeDialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
if (-not $edit -or -not $button) { throw 'Native filename field or default button is missing' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class YukiFileDialogControls {
 [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SetText(IntPtr h,uint m,IntPtr w,string text,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", SetLastError=true)] public static extern IntPtr Click(IntPtr h,uint m,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint f);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder text,int length);
 [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@
$editHandle = [IntPtr]$edit.Current.NativeWindowHandle
$buttonHandle = [IntPtr]$button.Current.NativeWindowHandle
[uint32]$editProcess = 0
[uint32]$buttonProcess = 0
[void][YukiFileDialogControls]::GetWindowThreadProcessId($editHandle, [ref]$editProcess)
[void][YukiFileDialogControls]::GetWindowThreadProcessId($buttonHandle, [ref]$buttonProcess)
$dialogHandle = [YukiFileDialogControls]::GetAncestor($editHandle, 2)
$dialogClass = [Text.StringBuilder]::new(128)
[void][YukiFileDialogControls]::GetClassName($dialogHandle, $dialogClass, $dialogClass.Capacity)
if ($editProcess -ne $OwnerProcessId -or $buttonProcess -ne $OwnerProcessId -or
    [YukiFileDialogControls]::GetDlgCtrlID($editHandle) -ne $filenameId -or [YukiFileDialogControls]::GetDlgCtrlID($buttonHandle) -ne 1 -or
    [YukiFileDialogControls]::GetAncestor($buttonHandle, 2) -ne $dialogHandle -or
    [YukiFileDialogControls]::GetAncestor($dialogHandle, 3) -ne [IntPtr]$OwnerWindowHandle -or $dialogClass.ToString() -ne '#32770') {
  throw 'Native controls do not belong to the expected app file dialog'
}
if (-not [YukiFileDialogControls]::IsWindowVisible($dialogHandle) -or
    -not [YukiFileDialogControls]::IsWindowEnabled($editHandle) -or -not [YukiFileDialogControls]::IsWindowEnabled($buttonHandle)) { throw 'Own file dialog controls are not usable' }
$receipt = [pscustomobject]@{
  Action = $Action; ProcessId = $OwnerProcessId; SessionId = $owner.SessionId; DialogClass = $dialogClass.ToString()
  OwnerWindowHandle = $OwnerWindowHandle; DialogHandle = $dialogHandle.ToInt64()
  FilenameControl = $filenameId; DefaultButton = 1; Method = 'native-win32-controls'
}
# This host exposes its native Edit/Button as UIA Pane without Value/Invoke patterns.
# Query only the app HWND subtree, then validate native ownership before GUI messages.
[IntPtr]$messageResult = [IntPtr]::Zero
if ([YukiFileDialogControls]::SetText($editHandle, 0x000C, [IntPtr]::Zero, $SelectionPath, 2, 5000, [ref]$messageResult) -eq [IntPtr]::Zero -or $messageResult -eq [IntPtr]::Zero) { throw 'Native filename field did not accept text' }
[void][YukiFileDialogControls]::SetForegroundWindow($dialogHandle)
if ([YukiFileDialogControls]::Click($buttonHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero, 2, 5000, [ref]$messageResult) -eq [IntPtr]::Zero) { throw 'Native default button did not receive input' }
$receipt | ConvertTo-Json -Compress
