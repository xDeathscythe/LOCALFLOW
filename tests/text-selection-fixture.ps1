param([Parameter(Mandatory)][string]$BoundsPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SelectionFixtureWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window,int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int cx,int cy,uint flags);
}
'@
$form = New-Object Windows.Window
$form.Title = 'LocalFlow selection test'
$form.Left = 80
$form.Top = 80
$form.Width = 500
$form.Height = 250
$form.Topmost = $true
$inputBox = New-Object Windows.Controls.TextBox
$inputBox.FontSize = 24
$inputBox.Text = 'She go to school every day.'
$form.Content = $inputBox
$form.Add_ContentRendered({
  $handle = (New-Object Windows.Interop.WindowInteropHelper($form)).Handle
  [SelectionFixtureWindow]::ShowWindow($handle,5) | Out-Null
  [SelectionFixtureWindow]::SetWindowPos($handle,[IntPtr](-1),80,80,500,250,0x40) | Out-Null
  $inputBox.Focus() | Out-Null
  $inputBox.SelectAll()
  $point = $inputBox.PointToScreen((New-Object Windows.Point(25,16)))
  [IO.File]::WriteAllText($BoundsPath + '.tmp',(@{x=$point.X;y=$point.Y} | ConvertTo-Json))
  [IO.File]::Move($BoundsPath + '.tmp',$BoundsPath)
})
$form.ShowDialog() | Out-Null
