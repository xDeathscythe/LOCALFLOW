param([switch]$ServiceOnly)
$ErrorActionPreference = 'Stop'
$accountRoot = Split-Path -Parent $PSScriptRoot
$serviceDirectory = Join-Path $accountRoot 'services\account'
$environmentFile = Join-Path $serviceDirectory '.env.local'
if (-not (Test-Path -LiteralPath $environmentFile)) { throw 'Configure services/account/.env.local before starting the development account service.' }
$originLine = Get-Content -LiteralPath $environmentFile | Where-Object { $_.StartsWith('LOCALFLOW_ACCOUNT_ORIGIN=') } | Select-Object -First 1
$origin = $originLine.Substring('LOCALFLOW_ACCOUNT_ORIGIN='.Length).Trim()
if (-not $origin.StartsWith('http://127.0.0.1:')) { throw 'This launcher is for a loopback development service only.' }
$configuration = $null
try { $configuration = Invoke-RestMethod -Uri "$origin/v1/config" -TimeoutSec 2 } catch {}
if (-not $configuration) {
    $logDirectory = Join-Path $accountRoot 'local-data\account-service'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $node = Join-Path $accountRoot 'runtime\node\node.exe'
    Start-Process -FilePath $node -ArgumentList @('--env-file=.env.local', 'server.mjs', '--development') -WorkingDirectory $serviceDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'service.log') -RedirectStandardError (Join-Path $logDirectory 'service-error.log') | Out-Null
    for ($attempt = 0; $attempt -lt 20 -and -not $configuration; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { $configuration = Invoke-RestMethod -Uri "$origin/v1/config" -TimeoutSec 1 } catch {}
    }
}
if ($configuration.protocol -ne 1 -or $configuration.issuer -ne $origin) { throw 'The LocalFlow account service did not start. Check local-data/account-service/service-error.log.' }
Write-Output "LocalFlow development account service: $origin"
if ($ServiceOnly) { return }
$version = (Get-Content -LiteralPath (Join-Path $accountRoot 'package.json') -Raw | ConvertFrom-Json).version
$appDirectory = Join-Path $accountRoot "release\LocalFlow-$version-Windows-x64"
$executable = Join-Path $appDirectory 'LocalFlow.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the current Windows package first.' }
$env:LOCALFLOW_ACCOUNT_SERVICE_URL = $origin
$env:LOCALFLOW_ACCOUNT_DEVELOPMENT = '1'
$env:LOCALFLOW_USER_DATA = Join-Path $accountRoot 'local-data\account-development'
$env:LOCALFLOW_APP_ROOT = $appDirectory
$env:LOCALFLOW_PACKAGED = '1'
& $executable
