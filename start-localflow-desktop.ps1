$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$LogDir = Join-Path $Root 'runtime\startup'
$Log = Join-Path $LogDir 'localflow-desktop.log'
$Npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source

if (-not (Test-Path $Root)) { throw "LocalFlow root not found: $Root" }
if (-not $Npm) { throw 'npm.cmd not found in PATH' }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Root
"$(Get-Date -Format o) [boot] Starting LocalFlow desktop app from $Root" | Out-File -FilePath $Log -Encoding utf8 -Append
& $Npm start *>> $Log
