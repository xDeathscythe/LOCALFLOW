param([switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
# Use this PowerShell's built-ins even when Node inherits a different host's module path.
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$destination = Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\prerequisites'
$executable = Join-Path $destination 'vc_redist.x64.exe'
$source = 'https://aka.ms/vc14/vc_redist.x64.exe'
if (-not (Test-Path -LiteralPath $executable)) {
  if ($VerifyOnly) { throw 'Visual C++ runtime missing. Run npm run runtime:prerequisites.' }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $download = "$executable.download"
  Invoke-WebRequest -Uri $source -OutFile $download
  $signature = Get-AuthenticodeSignature -LiteralPath $download
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|, )CN=Microsoft Corporation(,|$)') {
    throw 'Visual C++ download does not have a valid Microsoft signature.'
  }
  Move-Item -LiteralPath $download -Destination $executable -Force
}
$signature = Get-AuthenticodeSignature -LiteralPath $executable
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|, )CN=Microsoft Corporation(,|$)') {
  throw 'Bundled Visual C++ runtime does not have a valid Microsoft signature.'
}
$version = (Get-Item -LiteralPath $executable).VersionInfo.FileVersion
$hash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not $VerifyOnly) {
  @{ source = $source; version = $version; sha256 = $hash } | ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $destination 'vc-runtime.json') -Encoding utf8
}
Write-Output "Verified Microsoft Visual C++ x64 $version; SHA256 $hash"
