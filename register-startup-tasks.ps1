$ErrorActionPreference = 'Stop'

$tasks = @(
  @{ Name = 'LocalFlow Desktop at Logon'; Path = (Join-Path $PSScriptRoot 'start-localflow-desktop.ps1'); Delay = 'PT10S' }
)

foreach ($t in $tasks) {
  if (-not (Test-Path $t.Path)) {
    throw "Missing startup script: $($t.Path)"
  }

  $existing = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
  }

  $action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $t.Path + '"')

  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $trigger.Delay = $t.Delay

  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

  Register-ScheduledTask `
    -TaskName $t.Name `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description ('Autostart for ' + $t.Name) | Out-Null
}

Get-ScheduledTask | Where-Object {
  $_.TaskName -eq 'LocalFlow Desktop at Logon'
} | Select-Object TaskName, State, TaskPath | ConvertTo-Json -Depth 3
