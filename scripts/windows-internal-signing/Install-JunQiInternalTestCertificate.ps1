[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$CertificatePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedPath = (Resolve-Path -LiteralPath $CertificatePath).Path
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($resolvedPath)
$expectedSubject = 'CN=JunQi Internal Test Signing, O=陕西浚启智境科技有限公司'

if ($certificate.Subject -ne $expectedSubject) {
  throw "Unexpected certificate subject: $($certificate.Subject)"
}
$enhancedKeyUsage = $certificate.Extensions |
  Where-Object { $_.Oid.Value -eq '2.5.29.37' } |
  Select-Object -First 1
if ($null -eq $enhancedKeyUsage) {
  throw 'The certificate has no enhanced key usage extension.'
}
$codeSigningOid = [System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3')
$codeSigningUsage = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$enhancedKeyUsage
if (-not ($codeSigningUsage.EnhancedKeyUsages | Where-Object { $_.Value -eq $codeSigningOid.Value })) {
  throw 'The certificate is not valid for code signing.'
}

Write-Host 'Internal test certificate details:'
Write-Host "  Subject: $($certificate.Subject)"
Write-Host "  Thumbprint: $($certificate.Thumbprint)"
Write-Host "  Expires: $($certificate.NotAfter.ToString('u'))"
Write-Warning 'This certificate is not a public trust certificate. Trust software signed by it only on a dedicated JunQi test device.'
$confirmation = Read-Host 'Type TRUST JUNQI TEST CERTIFICATE to continue'
if ($confirmation -cne 'TRUST JUNQI TEST CERTIFICATE') {
  throw 'Certificate installation cancelled.'
}

foreach ($storeName in @('Root', 'TrustedPublisher')) {
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, 'CurrentUser')
  try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $store.Add($certificate)
  } finally {
    $store.Close()
  }
}

Write-Host 'The certificate is trusted for the current Windows user only.'
Write-Host "Record this thumbprint for removal: $($certificate.Thumbprint)"
