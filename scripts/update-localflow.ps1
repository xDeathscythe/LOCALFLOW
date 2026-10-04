param([Parameter(Mandatory=$true)][string]$From)
$ErrorActionPreference='Stop'
function Get-ComponentHash([string]$Path){$stream=[IO.File]::OpenRead($Path);$hash=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose();$stream.Dispose()}}
$previous=(Resolve-Path -LiteralPath $From).Path.TrimEnd('\')
if(-not (Test-Path -LiteralPath (Join-Path $previous 'LocalFlow.exe'))){throw 'From must name an installed LocalFlow release folder.'}
if(Get-Process -Name LocalFlow -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $previous 'LocalFlow.exe') }){throw 'Quit LocalFlow from its tray menu before updating so notes are saved.'}
$update=Split-Path -Parent $PSScriptRoot
$manifest=Get-Content -LiteralPath (Join-Path $update 'runtime-components.json') -Raw | ConvertFrom-Json
if($manifest.version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid release version.'}
$parent=Split-Path -Parent $previous
$target=Join-Path $parent "LocalFlow-$($manifest.version)-Windows-x64"
if(Test-Path -LiteralPath $target){throw 'The target release already exists; updates never overwrite a release.'}
# Verify every reused file before creating the replacement. No model downloads are needed.
$files=[Collections.Generic.List[object]]::new()
foreach($component in $manifest.components){foreach($file in $component.files){
  $relative=Join-Path $component.path $file.path
  $source=[IO.Path]::GetFullPath((Join-Path $previous $relative))
  if(-not $source.StartsWith($previous+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid component path.'}
  if(-not (Test-Path -LiteralPath $source -PathType Leaf) -or (Get-ComponentHash $source) -ne $file.sha256){throw "Installed component differs: $relative. Use the full release package."}
  $files.Add(@{source=$source;relative=$relative})
}}
New-Item -ItemType Directory -Path $target | Out-Null
Get-ChildItem -LiteralPath $update | Copy-Item -Destination $target -Recurse
foreach($file in $files){
  $destination=Join-Path $target $file.relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  try{New-Item -ItemType HardLink -Path $destination -Target $file.source -ErrorAction Stop | Out-Null}catch{Copy-Item -LiteralPath $file.source -Destination $destination}
}
Write-Output "LOCALFLOW_UPDATED $target"
