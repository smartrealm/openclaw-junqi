[CmdletBinding()]
param(
  [ValidateSet('x64', 'x86', 'arm64')]
  [string]$Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$pathCommand = Get-Command signtool.exe -CommandType Application -ErrorAction SilentlyContinue
if ($null -ne $pathCommand) {
  return $pathCommand.Source
}

$kitRoots = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
foreach ($registryPath in @(
  'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows Kits\Installed Roots',
  'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows Kits\Installed Roots'
)) {
  try {
    $installedRoots = Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop
    foreach ($propertyName in @('KitsRoot10', 'KitsRoot81')) {
      $property = $installedRoots.PSObject.Properties[$propertyName]
      if ($null -ne $property -and -not [string]::IsNullOrWhiteSpace($property.Value)) {
        [void]$kitRoots.Add([string]$property.Value)
      }
    }
  } catch [System.Management.Automation.ItemNotFoundException] {
    # The corresponding Windows SDK generation is not installed.
  }
}

$programFilesX86 = [Environment]::GetFolderPath(
  [Environment+SpecialFolder]::ProgramFilesX86
)
if (-not [string]::IsNullOrWhiteSpace($programFilesX86)) {
  [void]$kitRoots.Add((Join-Path $programFilesX86 'Windows Kits\10'))
  [void]$kitRoots.Add((Join-Path $programFilesX86 'Windows Kits\8.1'))
}

$candidates = foreach ($kitRoot in $kitRoots) {
  $binRoot = Join-Path $kitRoot 'bin'
  if (Test-Path -LiteralPath $binRoot -PathType Container) {
    foreach ($versionDirectory in @(Get-ChildItem -LiteralPath $binRoot -Directory | Sort-Object Name -Descending)) {
      Join-Path $versionDirectory.FullName "$Architecture\signtool.exe"
    }
    Join-Path $binRoot "$Architecture\signtool.exe"
  }
  if ($Architecture -eq 'x64') {
    Join-Path $kitRoot 'App Certification Kit\signtool.exe'
  }
}

foreach ($candidate in $candidates) {
  if (Test-Path -LiteralPath $candidate -PathType Leaf) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }
}

throw 'signtool.exe was not found in PATH or a registered Windows SDK installation.'
