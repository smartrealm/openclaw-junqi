import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`./windows-internal-signing/${name}`, import.meta.url), 'utf8');
const create = read('New-JunQiInternalTestCertificate.ps1');
const install = read('Install-JunQiInternalTestCertificate.ps1');
const remove = read('Remove-JunQiInternalTestCertificate.ps1');
const build = read('Invoke-JunQiInternalSignedBuild.ps1');
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
