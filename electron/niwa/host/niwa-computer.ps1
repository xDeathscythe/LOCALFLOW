param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$niwaAction = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NiwaInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr info);
}
'@
switch ($niwaAction.action) {
  'inspect' {
    $niwaWindows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
    $niwaResult = foreach ($niwaWindow in $niwaWindows) {
      try {
        $niwaControls = $niwaWindow.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
        $niwaItems = for ($niwaIndex=0; $niwaIndex -lt [Math]::Min(200,$niwaControls.Count); $niwaIndex++) {
          $niwaControl = $niwaControls.Item($niwaIndex).Current
          if ($niwaControl.IsOffscreen) { continue }
          $niwaRect = $niwaControl.BoundingRectangle
          if (@($niwaRect.X,$niwaRect.Y,$niwaRect.Width,$niwaRect.Height) | Where-Object { [double]::IsInfinity($_) -or [double]::IsNaN($_) }) { continue }
          @{ name=$niwaControl.Name; id=$niwaControl.AutomationId; type=$niwaControl.ControlType.ProgrammaticName; x=$niwaControl.BoundingRectangle.X; y=$niwaControl.BoundingRectangle.Y; width=$niwaControl.BoundingRectangle.Width; height=$niwaControl.BoundingRectangle.Height }
        }
        @{ window=$niwaWindow.Current.Name; processId=$niwaWindow.Current.ProcessId; controls=@($niwaItems) }
      } catch { }
    }
    ConvertTo-Json -InputObject @($niwaResult) -Depth 6 -Compress
  }
  'screenshot' {
    $niwaBounds = [Windows.Forms.SystemInformation]::VirtualScreen
    $niwaBitmap = New-Object Drawing.Bitmap($niwaBounds.Width,$niwaBounds.Height)
    $niwaGraphics = [Drawing.Graphics]::FromImage($niwaBitmap)
    $niwaStream = New-Object IO.MemoryStream
    try {
      $niwaGraphics.CopyFromScreen($niwaBounds.Location,[Drawing.Point]::Empty,$niwaBounds.Size)
      $niwaBitmap.Save($niwaStream,[Drawing.Imaging.ImageFormat]::Png)
      @{ image=[Convert]::ToBase64String($niwaStream.ToArray()); x=$niwaBounds.X; y=$niwaBounds.Y } | ConvertTo-Json -Compress
    } finally { $niwaStream.Dispose(); $niwaGraphics.Dispose(); $niwaBitmap.Dispose() }
  }
  'click' {
    if ($null -eq $niwaAction.x -or $null -eq $niwaAction.y) { throw 'Coordinates are required.' }
    [NiwaInput]::SetCursorPos($niwaAction.x,$niwaAction.y) | Out-Null
    [NiwaInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [NiwaInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    '{"ok":true}'
  }
  'type' {
    $niwaEscaped = [regex]::Replace([string]$niwaAction.text, '[+^%~(){}\[\]]', { param($niwaMatch) '{' + $niwaMatch.Value + '}' })
    [Windows.Forms.SendKeys]::SendWait($niwaEscaped)
    '{"ok":true}'
  }
  'key' {
    $niwaKeys = @{ enter='{ENTER}'; escape='{ESC}'; tab='{TAB}'; backspace='{BACKSPACE}'; copy='^c'; paste='^v'; select_all='^a' }
    if (!$niwaKeys.ContainsKey([string]$niwaAction.key)) { throw 'Unsupported key.' }
    [Windows.Forms.SendKeys]::SendWait($niwaKeys[[string]$niwaAction.key]); '{"ok":true}'
  }
  default { throw 'Unsupported computer action.' }
}
