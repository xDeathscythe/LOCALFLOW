$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$venvPackages = Join-Path $projectRoot ".venv\Lib\site-packages"
$runtimeRoot = Join-Path $projectRoot "runtime"
$pythonTarget = Join-Path $runtimeRoot "python"
$packagesTarget = Join-Path $runtimeRoot "python-packages"

if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
  throw "LocalFlow Python environment is missing. Run npm run setup:python first."
}

$pythonSource = (& $venvPython -c "import sys; print(sys.base_prefix)").Trim()
if (-not (Test-Path -LiteralPath (Join-Path $pythonSource "python.exe") -PathType Leaf)) {
  throw "Python base runtime is missing: $pythonSource"
}
if (-not (Test-Path -LiteralPath $venvPackages -PathType Container)) {
  throw "LocalFlow Python packages are missing: $venvPackages"
}

New-Item -ItemType Directory -Path $pythonTarget,$packagesTarget -Force | Out-Null
Copy-Item -Path (Join-Path $pythonSource "*") -Destination $pythonTarget -Recurse -Force
Copy-Item -Path (Join-Path $venvPackages "*") -Destination $packagesTarget -Recurse -Force

$previousPythonPath = $env:PYTHONPATH
$env:PYTHONPATH = $packagesTarget
try {
  & (Join-Path $pythonTarget "python.exe") -c "from faster_whisper import WhisperModel; import onnx_asr; print('Portable transcription runtime ready')"
  if ($LASTEXITCODE -ne 0) {
    throw "Portable transcription runtime validation failed."
  }
} finally {
  $env:PYTHONPATH = $previousPythonPath
}
