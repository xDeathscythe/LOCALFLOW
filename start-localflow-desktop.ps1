$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$LogDir = Join-Path $Root 'runtime\startup'
$Log = Join-Path $LogDir 'localflow-desktop.log'
$Executable = Join-Path $Root 'LocalFlow.exe'
$SourceCheckout = -not (Test-Path -LiteralPath $Executable -PathType Leaf)
if ($SourceCheckout) { $Executable = Join-Path $Root 'src-tauri\target\release\localflow-desktop.exe' }

if (-not (Test-Path $Root)) { throw "LocalFlow root not found: $Root" }
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw 'LocalFlow native application is missing. Run npm run desktop:build.' }
if (-not (Test-Path -LiteralPath (Join-Path $Root 'runtime\node\node.exe') -PathType Leaf)) { throw 'LocalFlow feature runtime is missing. Run npm run runtime:native.' }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Root
"$(Get-Date -Format o) [boot] Starting LocalFlow desktop app from $Root" | Out-File -FilePath $Log -Encoding utf8 -Append
$env:LOCALFLOW_APP_ROOT = $Root
$env:LOCALFLOW_PACKAGED = if ($SourceCheckout) { '0' } else { '1' }
& $Executable *>> $Log
exit $LASTEXITCODE
