# dsh-winui-skin — remove from a DSH profile.
#
# Deselects the bundle, drops the dependency entry and deletes the installed
# copy. The running page drops the token layer and the stylesheet together with
# the plugin, so the original skin returns on the next recomposition.
#
# Usage:
#   .\uninstall.cmd
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
[CmdletBinding()]
param(
  [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { (Join-Path $HOME '.dsh') }),
  [switch]$KeepBackup
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'winui-skin.common.ps1')

$PackageName = 'dsh-winui-skin'
$ProfileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$ManifestPath = Join-Path $ProfileDir 'package.json'
$Target = Join-Path (Join-Path $ProfileDir 'node_modules') $PackageName
$Backup = "$ManifestPath.before-$PackageName"

function Info([string]$Message) { Write-Host "[winui-skin] $Message" }

if (-not (Test-Path -LiteralPath $ManifestPath)) { throw "Profile manifest not found: $ManifestPath" }

$manifest = (Read-Utf8 $ManifestPath) | ConvertFrom-Json

if ($manifest.PSObject.Properties['dsh'] -and $manifest.dsh.PSObject.Properties['profile'] -and
    $manifest.dsh.profile.PSObject.Properties['bundles']) {
  $bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne $PackageName })
  $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue $bundles -Force
  Info "bundle list: $(if ($bundles.Count) { $bundles -join ', ' } else { '(empty)' })"
}
if ($manifest.PSObject.Properties['dependencies'] -and $manifest.dependencies.PSObject.Properties[$PackageName]) {
  $manifest.dependencies.PSObject.Properties.Remove($PackageName)
  Info 'removed the dependency entry'
}

Write-Utf8NoBom $ManifestPath (ConvertTo-JsonPretty $manifest)

if (Test-Path -LiteralPath $Target) {
  Remove-Item -LiteralPath $Target -Recurse -Force
  Info "deleted $Target"
}
if (-not $KeepBackup -and (Test-Path -LiteralPath $Backup)) {
  Remove-Item -LiteralPath $Backup -Force
  Info 'removed the manifest backup'
}

$null = (Read-Utf8 $ManifestPath) | ConvertFrom-Json
Info 'Done. The original DSH skin returns on the next recomposition.'
