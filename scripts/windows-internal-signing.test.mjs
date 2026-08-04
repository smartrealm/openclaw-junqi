import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`./windows-internal-signing/${name}`, import.meta.url), 'utf8');
const create = read('New-JunQiInternalTestCertificate.ps1');
const install = read('Install-JunQiInternalTestCertificate.ps1');
const remove = read('Remove-JunQiInternalTestCertificate.ps1');
const build = read('Invoke-JunQiInternalSignedBuild.ps1');
const ciCertificate = read('New-JunQiCiInternalTestCertificate.ps1');
const signToolResolver = read('Resolve-JunQiSignTool.ps1');
const taggedRelease = readFileSync(new URL('../.github/workflows/tag-release.yml', import.meta.url), 'utf8');
const releaseWorkflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const profile = JSON.parse(readFileSync(new URL('../src-tauri/tauri.internal-test.conf.json', import.meta.url), 'utf8'));
const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

const subject = 'CN=JunQi Internal Test Signing, O=陕西浚启智境科技有限公司';

test('internal certificate creation separates private and public material under ignored artifacts', () => {
  assert.match(create, /New-SelfSignedCertificate/);
  assert.match(create, /-Type CodeSigningCert/);
  assert.match(create, /-KeyLength 3072/);
  assert.match(create, /Export-PfxCertificate/);
  assert.match(create, /Export-Certificate/);
  assert.match(create, /CREATE JUNQI TEST CERTIFICATE/);
  assert.match(create, new RegExp(subject));
  assert.match(ignore, /^\.artifacts\/$/m);
});

test('tester trust is explicit, current-user only, and never receives the PFX', () => {
  assert.match(install, /TRUST JUNQI TEST CERTIFICATE/);
  assert.match(install, /'Root', 'TrustedPublisher'/);
  assert.match(install, /'CurrentUser'/);
  assert.match(install, /1\.3\.6\.1\.5\.5\.7\.3\.3/);
  assert.doesNotMatch(install, /LocalMachine|Import-PfxCertificate|\.pfx/iu);
});

test('certificate removal is pinned to both subject and thumbprint', () => {
  assert.match(remove, /ValidatePattern\('\^\[0-9A-Fa-f\]\{40\}\$'\)/);
  assert.match(remove, /FindByThumbprint/);
  assert.match(remove, new RegExp(subject));
  assert.match(remove, /REMOVE JUNQI TEST CERTIFICATE/);
});

test('ephemeral CI certificate is non-exportable, short-lived, and emits public trust material only', () => {
  const thumbprintOutput = ciCertificate.indexOf('"thumbprint=$($certificate.Thumbprint)"');
  const trustStoreWrite = ciCertificate.indexOf('X509Store]::new');
  assert.match(ciCertificate, /\$env:CI -ne 'true'/);
  assert.match(ciCertificate, /-KeyExportPolicy NonExportable/);
  assert.match(ciCertificate, /ValidDays must be between 1 and 30/);
  assert.match(ciCertificate, /Export-Certificate/);
  assert.doesNotMatch(ciCertificate, /Export-PfxCertificate|\.pfx/iu);
  assert.match(ciCertificate, /PublicTrust=None/);
  assert.match(ciCertificate, /X509Store/);
  assert.match(ciCertificate, /StoreLocation\]::CurrentUser/);
  assert.match(ciCertificate, /OpenFlags\]::ReadWrite/);
  assert.match(ciCertificate, /\$store\.Add\(\$publicCertificate\)/);
  assert.match(ciCertificate, /\$store\.Close\(\)/);
  assert.ok(thumbprintOutput >= 0 && thumbprintOutput < trustStoreWrite);
  assert.match(ciCertificate, /'Root', 'TrustedPublisher'/);
  assert.doesNotMatch(ciCertificate, /Import-Certificate/);
  assert.doesNotMatch(ciCertificate, /LocalMachine/);
});

test('internal build signs the app before NSIS bundling and verifies both artifacts', () => {
  const compile = build.indexOf('--no-bundle');
  const appSign = build.indexOf('Sign-AndVerify -Path $binaryPath');
  const bundle = build.indexOf('tauri bundle');
  const installerSign = build.indexOf('Sign-AndVerify -Path $installers[0].FullName');
  assert.ok(compile >= 0 && compile < appSign && appSign < bundle && bundle < installerSign);
  assert.match(build, /Import-PfxCertificate/);
  assert.match(build, /signtool sign \/fd SHA256 \/sha1/);
  assert.match(build, /\/tr \$TimestampUrl \/td SHA256/);
  assert.match(build, /signtool verify \/pa \/all \/tw/);
  assert.match(build, /Get-AuthenticodeSignature/);
  assert.equal(profile.bundle.createUpdaterArtifacts, false);
});

test('SignTool discovery supports PATH and registered Windows SDK locations', () => {
  assert.match(signToolResolver, /Get-Command signtool\.exe/);
  assert.match(signToolResolver, /Windows Kits\\Installed Roots/);
  assert.match(signToolResolver, /KitsRoot10/);
  assert.match(signToolResolver, /Windows Kits\\10/);
  assert.match(signToolResolver, /Resolve-Path -LiteralPath \$candidate/);
  assert.match(build, /Resolve-JunQiSignTool\.ps1/);
  assert.doesNotMatch(build, /Get-Command signtool\.exe/);
  assert.equal(releaseWorkflow.match(/Resolve-JunQiSignTool\.ps1/g)?.length, 1);
  assert.doesNotMatch(releaseWorkflow, /Get-Command signtool\.exe/);
});

test('tagged Windows test release signs the application before NSIS and publishes only public trust files', () => {
  const compile = taggedRelease.indexOf('Compile Windows application before internal signing');
  const appSign = taggedRelease.indexOf('Sign compiled Windows application for controlled internal testing');
  const bundle = taggedRelease.indexOf('Bundle Windows NSIS installer around the signed application');
  const installerSign = taggedRelease.indexOf('Sign and verify Windows NSIS installer for controlled internal testing');
  const cleanup = taggedRelease.indexOf('Remove ephemeral Windows signing certificate');
  assert.ok(compile >= 0 && compile < appSign && appSign < bundle && bundle < installerSign);
  assert.ok(installerSign < cleanup);
  assert.match(taggedRelease, /New-JunQiCiInternalTestCertificate\.ps1/);
  assert.equal(taggedRelease.match(/Resolve-JunQiSignTool\.ps1/g)?.length, 2);
  assert.match(taggedRelease, /\.artifacts\/windows-tag-internal-signing\/\*\.cer/);
  assert.match(taggedRelease, /\.artifacts\/windows-tag-internal-signing\/\*\.txt/);
  assert.doesNotMatch(taggedRelease, /windows-tag-internal-signing\/\*\.pfx/);
  assert.match(taggedRelease, /Smart App Control 开启时仍可能阻止/);
  assert.match(taggedRelease, /always\(\) && runner\.os == 'Windows'/);
  assert.match(taggedRelease, /'My', 'Root', 'TrustedPublisher'/);
});
