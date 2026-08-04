[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PfxPath,
  [string]$Target = 'x86_64-pc-windows-msvc',
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$resolvedPfxPath = (Resolve-Path -LiteralPath $PfxPath).Path
$securePassword = Read-Host 'Enter the password for the internal test signing PFX' -AsSecureString
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedPfxPath)
if ($certificate.Subject -ne 'CN=JunQi Internal Test Signing, O=陕西浚启智境科技有限公司') {
  throw "Unexpected signing certificate subject: $($certificate.Subject)"
}
$existingSigningCertificate = Test-Path -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)"
$importedCertificate = Import-PfxCertificate `
  -FilePath $resolvedPfxPath `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -Password $securePassword `
  -Exportable:$false

$signtool = & (Join-Path $PSScriptRoot 'Resolve-JunQiSignTool.ps1')
$binaryPath = Join-Path $repoRoot "src-tauri\target\$Target\release\junqi-desktop.exe"
$bundleRoot = Join-Path $repoRoot "src-tauri\target\$Target\release\bundle\nsis"
$buildConfig = Join-Path $repoRoot 'src-tauri\tauri.no-updater-artifacts.conf.json'

function Invoke-CheckedCommand {
  param([Parameter(Mandatory = $true)][scriptblock]$Command, [Parameter(Mandatory = $true)][string]$Failure)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw $Failure
  }
}

function Sign-AndVerify {
  param([Parameter(Mandatory = $true)][string]$Path)
  Invoke-CheckedCommand -Failure "Signing failed: $Path" -Command {
    & $signtool sign /fd SHA256 /sha1 $importedCertificate.Thumbprint /tr $TimestampUrl /td SHA256 $Path
  }
  Invoke-CheckedCommand -Failure "Authenticode verification failed: $Path" -Command {
    & $signtool verify /pa /all /tw $Path
  }
}

Push-Location $repoRoot
try {
  Invoke-CheckedCommand -Failure 'Tauri application compilation failed.' -Command {
    & pnpm exec tauri build --target $Target --no-bundle --config $buildConfig --ci
  }
  if (-not (Test-Path -LiteralPath $binaryPath)) {
    throw "Compiled application was not found: $binaryPath"
  }
  Sign-AndVerify -Path $binaryPath

  Invoke-CheckedCommand -Failure 'Tauri NSIS bundling failed.' -Command {
    & pnpm exec tauri bundle --target $Target --bundles nsis --config $buildConfig --ci
  }

  $installers = @(Get-ChildItem -LiteralPath $bundleRoot -Filter '*.exe' -File)
  if ($installers.Count -ne 1) {
    throw "Expected exactly one NSIS installer under $bundleRoot, found $($installers.Count)."
  }
  Sign-AndVerify -Path $installers[0].FullName

  $installedBinarySignature = Get-AuthenticodeSignature -LiteralPath $binaryPath
  $installerSignature = Get-AuthenticodeSignature -LiteralPath $installers[0].FullName
  if ($installedBinarySignature.Status -ne 'Valid' -or $installerSignature.Status -ne 'Valid') {
    throw 'One or more signed artifacts did not report a valid Authenticode signature.'
  }

  Write-Host "Signed application: $binaryPath"
  Write-Host "Signed installer: $($installers[0].FullName)"
  Write-Warning 'This build is for controlled internal testing only. It remains untrusted on devices where the public CER has not been installed explicitly.'
} finally {
  if (-not $existingSigningCertificate) {
    Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($importedCertificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
  }
  $securePassword = $null
  Pop-Location
}
