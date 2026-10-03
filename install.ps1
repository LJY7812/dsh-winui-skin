# dsh-winui-skin — install into a DSH profile.
#
# Copies the bundle files into the profile's own node_modules and selects the
# bundle in the profile manifest. The enabled hmr plugin watches that manifest,
# so DSH recomposes the profile inside the running app; the page then loads the
# new client bundle and the skin appears without restarting DSH.
#
# Usage:
#   .\install.cmd                          # current profile, policy bypassed
#   .\install.cmd -Profile web
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
#   .\install.cmd -WhatIfOnly              # print the plan, change nothing
#
# Works on Windows PowerShell 5.1 and PowerShell 7.
[CmdletBinding()]
param(
  [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { (Join-Path $HOME '.dsh') }),
  [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'winui-skin.common.ps1')

# Bundle payload only: the profile must not receive this installer, its shared
# helpers, or its thumbnails.
$PackageName = 'dsh-winui-skin'
$Payload = @('package.json', 'cordis.patch.yml', 'lib', 'README.md')

$ProfileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$ManifestPath = Join-Path $ProfileDir 'package.json'
$Target = Join-Path (Join-Path $ProfileDir 'node_modules') $PackageName
$Backup = "$ManifestPath.before-$PackageName"

function Info([string]$Message) { Write-Host "[winui-skin] $Message" }

if (-not (Test-Path -LiteralPath $ManifestPath)) {
  throw "Profile manifest not found: $ManifestPath. Pass -Profile <name> and/or -DshHome <dir>."
}

$packageJson = (Read-Utf8 (Join-Path $PSScriptRoot 'package.json')) | ConvertFrom-Json

Info "profile    : $ProfileDir"
Info "bundle     : $($packageJson.name) $($packageJson.version)"
Info "destination: $Target"

if ($WhatIfOnly) {
  Info "would copy $($Payload -join ', ') and select the '$PackageName' bundle"
  return
}

# ------------------------------------------------------------------ copy ---
if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $Target 'lib') -Force | Out-Null
foreach ($item in $Payload) {
  $from = Join-Path $PSScriptRoot $item
  if (-not (Test-Path -LiteralPath $from)) { throw "Missing bundle file: $from" }
  Copy-Item -LiteralPath $from -Destination $Target -Recurse -Force
}
Info "copied $((Get-ChildItem -LiteralPath $Target -Recurse -File).Count) files"

# -------------------------------------------------------------- manifest ---
$raw = Read-Utf8 $ManifestPath
if (-not (Test-Path -LiteralPath $Backup)) {
  Write-Utf8NoBom $Backup $raw
  Info "manifest backup: $Backup"
}

$manifest = $raw | ConvertFrom-Json
if (-not $manifest.PSObject.Properties['dependencies']) {
  $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue (New-Object psobject)
}
if ($manifest.dependencies.PSObject.Properties[$PackageName]) {
  $manifest.dependencies.$PackageName = $packageJson.version
  Info 'dependency entry already present; version refreshed'
} else {
  $manifest.dependencies | Add-Member -NotePropertyName $PackageName -NotePropertyValue $packageJson.version
  Info "added dependency '$PackageName': $($packageJson.version)"
}

if (-not $manifest.PSObject.Properties['dsh']) {
  $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue (New-Object psobject)
}
if (-not $manifest.dsh.PSObject.Properties['profile']) {
  $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue (New-Object psobject)
}
$bundles = @()
if ($manifest.dsh.profile.PSObject.Properties['bundles']) { $bundles = @($manifest.dsh.profile.bundles) }
if ($bundles -notcontains $PackageName) {
  $bundles += $PackageName
  Info "appended '$PackageName' to dsh.profile.bundles"
} else {
  Info "'$PackageName' is already selected in dsh.profile.bundles"
}
$manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force

Write-Utf8NoBom $ManifestPath (ConvertTo-JsonPretty $manifest)
Info 'manifest updated'

# Re-read through the same codec DSH uses, so a broken write fails here rather
# than at the next profile recomposition.
$null = (Read-Utf8 $ManifestPath) | ConvertFrom-Json
Info 'manifest re-parsed successfully'

Info ''
Info 'DSH recomposes a running profile when the manifest changes, so the skin'
Info 'usually applies on the open page within a moment. If it does not, reload'
Info 'the page once; restart DSH only as a last resort.'
