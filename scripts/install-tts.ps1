param(
    [string]$ResourcesRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$TtsRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\tts'),
    [switch]$VerifyOnly,
    [ValidateSet('piper','xtts','omnivoice')][string]$OnlyEngine
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ResourcesRoot = [IO.Path]::GetFullPath($ResourcesRoot)
$TtsRoot = [IO.Path]::GetFullPath($TtsRoot)
$ManifestPath = Join-Path $ResourcesRoot 'tts\manifest.json'
$PrepareScript = Join-Path $ResourcesRoot 'scripts\prepare-tts-models.py'
$AssetRefs = Join-Path $ResourcesRoot 'assets\tts\refs'
$LogDir = Join-Path $TtsRoot 'logs'
$LogPath = Join-Path $LogDir 'install.log'

function Get-Sha256([string]$Path) {
    $Stream = [IO.File]::OpenRead($Path)
    try {
        $Hasher = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
        } finally {
            $Hasher.Dispose()
        }
    } finally {
        $Stream.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $TtsRoot,$LogDir | Out-Null
Start-Transcript -Path $LogPath -Append | Out-Null

try {
    if (-not (Test-Path -LiteralPath $ManifestPath)) { throw "TTS manifest missing: $ManifestPath" }
    if (-not (Test-Path -LiteralPath $PrepareScript)) { throw "TTS model helper missing: $PrepareScript" }
    $Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

    $UvDir = Join-Path $TtsRoot 'tools\uv'
    $UvExe = Join-Path $UvDir 'uv.exe'
    $env:UV_CACHE_DIR = Join-Path $TtsRoot '.uv-cache'
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $TtsRoot 'python'
    $env:UV_NO_MODIFY_PATH = '1'

    if (-not $VerifyOnly -and -not (Test-Path -LiteralPath $UvExe)) {
        New-Item -ItemType Directory -Force -Path $UvDir | Out-Null
        $UvZip = Join-Path $UvDir 'uv.zip'
        Invoke-WebRequest -Uri $Manifest.uv.url -OutFile $UvZip
        $ActualUvHash = Get-Sha256 $UvZip
        if ($ActualUvHash -ne $Manifest.uv.sha256.ToLowerInvariant()) {
            throw "uv archive SHA-256 mismatch: $ActualUvHash"
        }
        Expand-Archive -LiteralPath $UvZip -DestinationPath $UvDir -Force
    }

    $EngineNames = if ($OnlyEngine) { @($OnlyEngine) } else { @('piper','xtts','omnivoice') }
    foreach ($Engine in $EngineNames) {
        $Python = Join-Path $TtsRoot "$Engine\.venv\Scripts\python.exe"
        if (-not $VerifyOnly) {
            if (-not (Test-Path -LiteralPath $UvExe)) { throw "uv executable missing: $UvExe" }
            if (-not (Test-Path -LiteralPath $Python)) {
                & $UvExe venv --python $Manifest.pythonVersion (Join-Path $TtsRoot "$Engine\.venv")
                if ($LASTEXITCODE -ne 0) { throw "Failed to create $Engine environment" }
            }
            $Requirements = Join-Path $ResourcesRoot $Manifest.engines.$Engine.requirements
            & $UvExe pip install --python $Python --requirement $Requirements
            if ($LASTEXITCODE -ne 0) { throw "Failed to install $Engine requirements" }
        }
        if (-not (Test-Path -LiteralPath $Python)) { throw "$Engine Python runtime missing: $Python" }
        $PrepareArgs = @($PrepareScript,'--engine',$Engine,'--root',$TtsRoot,'--manifest',$ManifestPath)
        if ($VerifyOnly) { $PrepareArgs += '--verify-only' }
        & $Python @PrepareArgs
        if ($LASTEXITCODE -ne 0) { throw "$Engine model preparation failed" }
    }

    $TargetRefs = Join-Path $TtsRoot 'shared\refs'
    New-Item -ItemType Directory -Force -Path $TargetRefs | Out-Null
    foreach ($Reference in $(if ($OnlyEngine -ne 'piper') { $Manifest.references })) {
        $Source = Join-Path $AssetRefs $Reference.file
        $Target = Join-Path $TargetRefs $Reference.file
        if (-not $VerifyOnly) {
            if (-not (Test-Path -LiteralPath $Source)) { throw "Bundled reference missing: $Source" }
            Copy-Item -LiteralPath $Source -Destination $Target -Force
        }
        if (-not (Test-Path -LiteralPath $Target)) { throw "TTS reference missing: $Target" }
        $ActualHash = Get-Sha256 $Target
        if ($ActualHash -ne $Reference.sha256.ToLowerInvariant()) {
            throw "Reference SHA-256 mismatch: $Target"
        }
    }

    if (-not $VerifyOnly) {
        [ordered]@{
            schemaVersion = $Manifest.schemaVersion
            installedAt = (Get-Date).ToUniversalTime().ToString('o')
            root = $TtsRoot
            engines = $EngineNames
        } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $TtsRoot 'install-state.json') -Encoding utf8
    }
    Write-Output "LocalFlow TTS runtime ready: $TtsRoot"
} finally {
    Stop-Transcript | Out-Null
}
