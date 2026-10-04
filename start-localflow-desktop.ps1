$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$LogDir = Join-Path $Root 'runtime\startup'
$Log = Join-Path $LogDir 'localflow-desktop.log'
$Electron = Join-Path $Root 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $Root)) { throw "LocalFlow root not found: $Root" }
if (-not (Test-Path -LiteralPath $Electron -PathType Leaf)) { throw 'LocalFlow desktop runtime is missing. Run npm ci once in the project folder.' }
if (-not (Test-Path -LiteralPath (Join-Path $Root 'dist\index.html') -PathType Leaf)) { throw 'LocalFlow UI is missing. Run npm run build once in the project folder.' }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $Root
"$(Get-Date -Format o) [boot] Starting LocalFlow desktop app from $Root" | Out-File -FilePath $Log -Encoding utf8 -Append
& $Electron $Root *>> $Log
exit $LASTEXITCODE
