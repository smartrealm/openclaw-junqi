[CmdletBinding()]
param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\.artifacts\windows-internal-signing'),
  [int]$ValidMonths = 12
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ValidMonths -lt 1 -or $ValidMonths -gt 24) {
  throw 'ValidMonths must be between 1 and 24.'
}

$confirmation = Read-Host 'Type CREATE JUNQI TEST CERTIFICATE to create an internal-only signing identity'
if ($confirmation -cne 'CREATE JUNQI TEST CERTIFICATE') {
  throw 'Certificate creation cancelled.'
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$pfxPath = Join-Path $OutputDirectory 'junqi-internal-test-signing.pfx'
$cerPath = Join-Path $OutputDirectory 'junqi-internal-test-signing.cer'
$metadataPath = Join-Path $OutputDirectory 'certificate-info.txt'

foreach ($path in @($pfxPath, $cerPath, $metadataPath)) {
  if (Test-Path -LiteralPath $path) {
    throw "Refusing to overwrite existing signing material: $path"
  }
}

$password = Read-Host 'Enter a strong password for the private PFX' -AsSecureString
$subject = 'CN=JunQi Internal Test Signing, O=陕西浚启智境科技有限公司'
$certificate = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $subject `
  -FriendlyName 'JunQi Internal Test Signing' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -NotAfter (Get-Date).AddMonths($ValidMonths)

try {
  Export-Certificate -Cert $certificate -FilePath $cerPath -Type CERT | Out-Null
  Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $password -ChainOption EndEntityCertOnly | Out-Null

  @(
    'Purpose=JunQi internal testing only'
    "Subject=$($certificate.Subject)"
    "Thumbprint=$($certificate.Thumbprint)"
    "NotBefore=$($certificate.NotBefore.ToUniversalTime().ToString('o'))"
    "NotAfter=$($certificate.NotAfter.ToUniversalTime().ToString('o'))"
    "PublicCertificateSha256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $cerPath).Hash)"
  ) | Set-Content -LiteralPath $metadataPath -Encoding UTF8
} finally {
  Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($certificate.Thumbprint)" -Force -ErrorAction SilentlyContinue
}

Write-Host "Private signing key: $pfxPath"
Write-Host "Public test certificate: $cerPath"
Write-Host "Certificate information: $metadataPath"
Write-Warning 'Keep the PFX and its password only on the signing machine. Give testers the CER file, never the PFX.'
