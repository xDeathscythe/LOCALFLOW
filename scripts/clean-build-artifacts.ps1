param([switch]$Apply, [ValidateRange(2,20)][int]$KeepVersions = 2)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$prefix = $projectRoot.TrimEnd('\') + '\'
$releaseRoot = Join-Path $projectRoot 'release'
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$verified = @{}

function Assert-ArtifactPath([string]$Path) {
    $absolute = [IO.Path]::GetFullPath($Path)
    if (!$absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Outside project: $absolute" }
    # Check ancestors too: a normal file inside a junction is still outside our ownership.
    for ($part = $absolute; $part -and $part -ne $projectRoot; $part = Split-Path -Parent $part) {
        if ((Test-Path -LiteralPath $part) -and ((Get-Item -LiteralPath $part -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Refusing linked artifact: $part" }
    }
    return $absolute
}

function Test-Release([string]$Directory, [string]$Version, [bool]$Offline) {
    $key = "$Directory|$Version"
    if ($verified.ContainsKey($key)) { return $verified[$key] }
    $verified[$key] = $false
    $checksum = Join-Path $Directory "SHA256SUMS-$Version.txt"
    if (!(Test-Path -LiteralPath $checksum)) { $checksum = Join-Path $Directory 'SHA256SUMS.txt' }
    if (!(Test-Path -LiteralPath $checksum)) { return $false }
    $null = Assert-ArtifactPath $checksum
    $hashes = @{}
    foreach ($line in Get-Content -LiteralPath $checksum) {
        if ($line -match '^([a-fA-F0-9]{64})\s+\*?(.+)$') { $hashes[$Matches[2]] = $Matches[1] }
    }
    $names = if ($Offline) { @("LocalFlow Offline Setup $Version.exe", "localflow-$Version-x64.nsis.7z") } else { @("LocalFlow-Setup-$Version.exe") }
    foreach ($name in $names) {
        $file = Assert-ArtifactPath (Join-Path $Directory $name)
        if (!$hashes.ContainsKey($name) -or !(Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hashes[$name]) { return $false }
    }
    $verified[$key] = $true
    return $true
}

$targets = @('release\win-unpacked', 'release\nsis-web', 'runtime\distribution\tts\xtts', 'runtime\distribution\tts\omnivoice', 'runtime\distribution\tts\shared') | ForEach-Object { Join-Path $projectRoot $_ }
$retained = @()
$currentVerified = $false
$legacy = Join-Path $releaseRoot 'windows'
if (Test-Path -LiteralPath $legacy) {
    $null = Assert-ArtifactPath $legacy
    $installers = @(Get-ChildItem -LiteralPath $legacy -File -Filter 'LocalFlow-Setup-*.exe' | Where-Object { $_.BaseName -match '^LocalFlow-Setup-(\d+\.\d+\.\d+)$' } | Sort-Object { [version]($_.BaseName -replace '^LocalFlow-Setup-','') } -Descending)
    $kept = 0
    foreach ($installer in $installers) {
        $version = $installer.BaseName -replace '^LocalFlow-Setup-',''
        if ($version -eq $package.version -or $kept -lt $KeepVersions) {
            $valid = Test-Release $legacy $version $false
            if ($valid) { $kept++ }
            if ($version -eq $package.version -and $valid) { $currentVerified = $true }
            $retained += $installer.FullName
        } else {
            $targets += $installer.FullName, ($installer.FullName + '.blockmap'), (Join-Path $legacy "SHA256SUMS-$version.txt")
        }
    }
}

$profiles = if (Test-Path -LiteralPath $releaseRoot) {
    Get-ChildItem -LiteralPath $releaseRoot -Directory | ForEach-Object {
        if ($_.Name -match '^(windows(?:-[a-z0-9]+)*)-(\d+\.\d+\.\d+)$') {
            [pscustomobject]@{ Profile=$Matches[1]; Version=$Matches[2]; Path=$_.FullName }
        }
    }
}
foreach ($group in ($profiles | Group-Object Profile)) {
    $kept = 0
    foreach ($release in ($group.Group | Sort-Object { [version]$_.Version } -Descending)) {
        $null = Assert-ArtifactPath $release.Path
        if ($group.Count -le $KeepVersions -or $release.Version -eq $package.version -or $kept -lt $KeepVersions) {
            # A profile with only two versions is retained intact; no need to hash gigabytes twice.
            if ($group.Count -gt $KeepVersions -or $release.Version -eq $package.version) {
                $valid = Test-Release (Join-Path $release.Path 'nsis-web') $release.Version $true
                if ($valid) { $kept++ }
                if ($release.Version -eq $package.version -and $valid) { $currentVerified = $true }
            }
            $retained += $release.Path
        } else { $targets += $release.Path }
    }
}
if ($Apply -and !$currentVerified) { throw 'Build and verify the complete current installer and payload before removing older artifacts.' }

$processes = @(Get-CimInstance Win32_Process)
$skipped = @()
$plan = @(foreach ($target in ($targets | Select-Object -Unique)) {
    $absolute = Assert-ArtifactPath $target
    if (!(Test-Path -LiteralPath $absolute)) { continue }
    if ($processes | Where-Object { ($_.ExecutablePath -and ($_.ExecutablePath -eq $absolute -or $_.ExecutablePath.StartsWith($absolute + '\', [StringComparison]::OrdinalIgnoreCase))) -or ($_.CommandLine -and $_.CommandLine.IndexOf($absolute, [StringComparison]::OrdinalIgnoreCase) -ge 0) }) {
        $skipped += [pscustomobject]@{ Path=$absolute; Reason='Running process references this artifact' }; continue
    }
    $item = Get-Item -LiteralPath $absolute -Force
    $entries = @($item)
    if ($item.PSIsContainer) { $entries += @(Get-ChildItem -LiteralPath $absolute -Recurse -Force) }
    if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw "Refusing linked artifact: $absolute" }
    $bytes = ($entries | Where-Object { !$_.PSIsContainer } | Measure-Object Length -Sum).Sum
    [pscustomobject]@{ Path=$absolute; Bytes=[long]$bytes }
})
# Validate every target before the first removal. Model sources and user data are never targets.
if ($Apply) { foreach ($item in $plan) { Remove-Item -LiteralPath $item.Path -Recurse -Force } }
[pscustomobject]@{ Applied=[bool]$Apply; CurrentReleaseVerified=$currentVerified; LogicalGiB=[math]::Round(($plan | Measure-Object Bytes -Sum).Sum/1GB,3); Retained=$retained; Skipped=$skipped; Artifacts=$plan } | ConvertTo-Json -Depth 4
