[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [int]$ValidDays = 14
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($env:CI) -or $env:CI -ne 'true') {
  throw 'This certificate generator may run only in an ephemeral CI environment.'
}
if ($ValidDays -lt 1 -or $ValidDays -gt 30) {
  throw 'ValidDays must be between 1 and 30.'
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$cerPath = Join-Path $OutputDirectory 'junqi-internal-test-signing.cer'
$metadataPath = Join-Path $OutputDirectory 'junqi-internal-test-signing-info.txt'
foreach ($path in @($cerPath, $metadataPath)) {
  if (Test-Path -LiteralPath $path) {
    throw "Refusing to overwrite existing internal signing material: $path"
  }
}

$certificate = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject 'CN=JunQi Internal Test Signing, O=陕西浚启智境科技有限公司' `
  -FriendlyName 'JunQi Ephemeral CI Internal Test Signing' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy NonExportable `
  -NotAfter (Get-Date).AddDays($ValidDays)

Export-Certificate -Cert $certificate -FilePath $cerPath -Type CERT | Out-Null
"thumbprint=$($certificate.Thumbprint)" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
"certificate_path=$cerPath" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
"metadata_path=$metadataPath" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append

$publicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($cerPath)
try {
  foreach ($storeName in @('Root', 'TrustedPublisher')) {
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
      $storeName,
      [System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser
    )
    try {
      $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
      $store.Add($publicCertificate)
    } finally {
      $store.Close()
    }
  }
} finally {
  $publicCertificate.Dispose()
}
@(
  'Purpose=JunQi controlled internal testing only'
  'PublicTrust=None'
  'CiRunnerTrust=CurrentUserOnly'
  'SmartAppControlCompatibility=Not guaranteed; public CA signing is required by Microsoft policy'
  "Subject=$($certificate.Subject)"
  "Thumbprint=$($certificate.Thumbprint)"
  "NotBefore=$($certificate.NotBefore.ToUniversalTime().ToString('o'))"
  "NotAfter=$($certificate.NotAfter.ToUniversalTime().ToString('o'))"
  "PublicCertificateSha256=$((Get-FileHash -Algorithm SHA256 -LiteralPath $cerPath).Hash)"
) | Set-Content -LiteralPath $metadataPath -Encoding UTF8
