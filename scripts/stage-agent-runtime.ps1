param([switch]$VerifyOnly, [ValidateSet('standard','full')][string]$Profile = 'standard')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetRoot = Join-Path $projectRoot $(if ($Profile -eq 'full') { 'runtime\distribution-full' } else { 'runtime\distribution' })
$engines = if ($Profile -eq 'full') { @('piper','xtts','omnivoice') } else { @('piper') }
$env:TEMP = Join-Path $projectRoot 'runtime\temp'
$env:TMP = $env:TEMP
$env:UV_CACHE_DIR = Join-Path $projectRoot 'runtime\build-cache\uv'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $projectRoot 'runtime\build-python'
$env:UV_PYTHON_PREFERENCE = 'only-managed'
$env:PYTHONPATH = ''
$env:PYTHONHOME = ''
$env:PYTHONNOUSERSITE = '1'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot 'runtime\browsers'
$uv = Join-Path $projectRoot 'runtime\tts\tools\uv\uv.exe'
$python = Join-Path $projectRoot 'runtime\python\python.exe'
$mcpEnv = Join-Path $projectRoot 'runtime\windows-mcp-build'
$marker = Join-Path $targetRoot 'distribution.json'
if (Test-Path -LiteralPath $marker) { $VerifyOnly = $true }
function Invoke-Checked([string]$command, [string[]]$arguments) {
    & $command @arguments
    if ($LASTEXITCODE -ne 0) { throw "Build command failed: $command (exit $LASTEXITCODE)" }
}
if (-not $VerifyOnly) {
    if (Test-Path -LiteralPath $targetRoot) { throw "Staging folder already exists: $targetRoot. Verify it or use a fresh staging directory before rebuilding." }
    New-Item -ItemType Directory -Force -Path $env:TEMP,$targetRoot | Out-Null
    if (-not (Test-Path -LiteralPath $uv)) { throw 'Run npm run setup:tts on the build machine first.' }
    Invoke-Checked $uv @('python','install','3.14.6')
    Invoke-Checked $uv @('venv','--python','3.14.6',$mcpEnv)
    Invoke-Checked $uv @('pip','install','--python',(Join-Path $mcpEnv 'Scripts\python.exe'),'--requirement',(Join-Path $projectRoot 'build\windows-mcp-requirements.txt'))
    Invoke-Checked $python @((Join-Path $PSScriptRoot 'stage-portable-python.py'),(Join-Path $mcpEnv 'Scripts\python.exe'),(Join-Path $targetRoot 'windows-mcp'))
    Invoke-Checked 'node' @((Join-Path $projectRoot 'node_modules\playwright\cli.js'),'install','chromium','--only-shell')
    foreach ($engine in $engines) {
        $source = Join-Path $projectRoot "runtime\tts\$engine"
        $destination = Join-Path $targetRoot "tts\$engine"
        New-Item -ItemType Directory -Force -Path $destination | Out-Null
        # Only model directories are shipped; caches, generated speech and build
        # environments are excluded. Copy-Item materializes Windows HF files.
        foreach ($modelDir in @('voices','models','hf_home')) {
            $modelSource = Join-Path $source $modelDir
            if (Test-Path -LiteralPath $modelSource) { Copy-Item -LiteralPath $modelSource -Destination $destination -Recurse -Force }
        }
        Invoke-Checked $python @((Join-Path $PSScriptRoot 'stage-portable-python.py'),(Join-Path $source '.venv\Scripts\python.exe'),(Join-Path $destination '.venv\Scripts'))
    }
    if ($Profile -eq 'full') { Copy-Item -LiteralPath (Join-Path $projectRoot 'runtime\tts\shared') -Destination (Join-Path $targetRoot 'tts\shared') -Recurse }
    $dependencies = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
    [ordered]@{ schemaVersion=1; windowsMcp='0.8.6'; python='3.14.6'; fastMcp='4.0.10'; mcpProtocol='2026-07-28'; codex=$dependencies.dependencies.'@openai/codex'; playwright=$dependencies.dependencies.playwright; mcpClient=$dependencies.dependencies.'@modelcontextprotocol/client'; builtAt=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding utf8
    & $uv pip freeze --python (Join-Path $mcpEnv 'Scripts\python.exe') | Set-Content (Join-Path $targetRoot 'windows-mcp-requirements.txt') -Encoding utf8
}
if (-not (Test-Path -LiteralPath $marker)) { throw 'Offline runtime has not been staged.' }
$staged = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
$package = Get-Content (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($staged.codex -ne $package.dependencies.'@openai/codex' -or $staged.playwright -ne $package.dependencies.playwright -or $staged.mcpClient -ne $package.dependencies.'@modelcontextprotocol/client') { throw 'Staged dependencies differ from package.json. Rebuild the offline runtime.' }
Invoke-Checked (Join-Path $targetRoot 'windows-mcp\python.exe') @('-m','windows_mcp','serve','--help')
foreach ($engine in $engines) {
    Invoke-Checked (Join-Path $targetRoot "tts\$engine\.venv\Scripts\python.exe") @((Join-Path $PSScriptRoot 'prepare-tts-models.py'),'--engine',$engine,'--root',(Join-Path $targetRoot 'tts'),'--manifest',(Join-Path $projectRoot 'tts\manifest.json'),'--verify-only')
}
Write-Output 'LOCALFLOW_OFFLINE_AGENT_RUNTIME_VERIFIED'
