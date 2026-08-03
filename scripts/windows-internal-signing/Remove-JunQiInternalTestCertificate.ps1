[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9A-Fa-f]{40}$')]
  [string]$Thumbprint
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$normalizedThumbprint = $Thumbprint.ToUpperInvariant()

$confirmation = Read-Host "Type REMOVE JUNQI TEST CERTIFICATE to remove $normalizedThumbprint"
if ($confirmation -cne 'REMOVE JUNQI TEST CERTIFICATE') {
  throw 'Certificate removal cancelled.'
}

foreach ($storeName in @('Root', 'TrustedPublisher')) {
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($storeName, 'CurrentUser')
  try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $matches = $store.Certificates.Find(
      [System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint,
      $normalizedThumbprint,
      $false
    )
    foreach ($certificate in $matches) {
      if ($certificate.Subject -ne 'CN=JunQi Internal Test Signing, O=陕西浚启智境科技有限公司') {
        throw "Refusing to remove a certificate with an unexpected subject: $($certificate.Subject)"
      }
      $store.Remove($certificate)
    }
  } finally {
    $store.Close()
  }
}

Write-Host 'JunQi internal test certificate removed for the current Windows user.'
