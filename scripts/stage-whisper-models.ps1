param(
  [string]$SourceRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) "models\whisper")
)

$ErrorActionPreference = "Stop"
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$destinationRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSScriptRoot) "models\whisper"))
$models = @("large-v3")

function ModelFiles($model) {
  @('config.json', 'model.bin', 'tokenizer.json')
  @('preprocessor_config.json', 'vocabulary.json')
}

foreach ($model in $models) {
  foreach ($fileName in (ModelFiles $model)) {
    $sourceFile = Join-Path (Join-Path $SourceRoot $model) $fileName
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
      throw "Missing Whisper model file: $sourceFile"
    }
  }
}

foreach ($model in $models) {
  $destinationPath = Join-Path $destinationRoot $model
  if ($SourceRoot -ne $destinationRoot) {
    New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
    foreach ($fileName in (ModelFiles $model)) {
      $sourceFile = Get-Item -LiteralPath (Join-Path (Join-Path $SourceRoot $model) $fileName)
      $destinationFile = Join-Path $destinationPath $fileName
      Copy-Item -LiteralPath $sourceFile.FullName -Destination $destinationFile -Force
      if ($sourceFile.Length -ne (Get-Item -LiteralPath $destinationFile).Length) {
        throw "Staged Whisper model file has the wrong size: $destinationFile"
      }
    }
  }
  Write-Output "Whisper model ready: $destinationPath"
}
