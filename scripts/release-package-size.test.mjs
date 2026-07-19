import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

test('production Rust profile is optimized for package size', () => {
  assert.doesNotMatch(cargo, /features\s*=\s*\[[^\]]*"devtools"/s);
  assert.match(cargo, /\[profile\.release\]/);
  assert.match(cargo, /codegen-units\s*=\s*1/);
  assert.match(cargo, /lto\s*=\s*true/);
  assert.match(cargo, /opt-level\s*=\s*"z"/);
  assert.match(cargo, /panic\s*=\s*"abort"/);
  assert.match(cargo, /strip\s*=\s*"symbols"/);
  assert.match(cargo, /zip\s*=\s*\{[^}]*default-features\s*=\s*false[^}]*features\s*=\s*\["deflate-flate2",\s*"flate2"\]/s);
});

test('macOS release packages are split by architecture', () => {
  assert.match(release, /target: 'aarch64-apple-darwin'/);
  assert.match(release, /target: 'x86_64-apple-darwin'/);
  assert.match(release, /name: macOS x64\s+artifact_name: macos-x86_64\s+platform: macos-15-intel\s+target: 'x86_64-apple-darwin'/);
  assert.doesNotMatch(release, /target: 'universal-apple-darwin'/);
});

test('Windows packages download the WebView2 bootstrapper instead of embedding it', () => {
  assert.equal(tauri.bundle.windows.webviewInstallMode.type, 'downloadBootstrapper');
  assert.equal(tauri.bundle.windows.webviewInstallMode.silent, true);
  assert.doesNotMatch(release, /package_variant: offline/);
  assert.doesNotMatch(release, /Mark offline Windows installers/);
});

test('release downloads are split by installer purpose', () => {
  assert.match(release, /artifact_name \}\}-dmg/);
  assert.match(release, /artifact_name \}\}-updater/);
  assert.match(release, /artifact_name \}\}-nsis/);
  assert.match(release, /artifact_name \}\}-msi-en-us/);
  assert.match(release, /artifact_name \}\}-msi-zh-cn/);
  assert.doesNotMatch(release, /path:\s*\$\{\{ matrix\.installer_paths \}\}/);
});

test('tag releases require a commit already contained in main', () => {
  assert.match(release, /fetch-depth:\s*0/);
  assert.match(release, /RELEASE_REF: \$\{\{ github\.event\.inputs\.ref \|\| github\.ref_name \}\}/);
  assert.match(release, /refs\/tags\/\$\{release_ref\}\^\{commit\}/);
  assert.match(release, /refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(release, /git merge-base --is-ancestor "\$tag_commit" "\$main_commit"/);
});

test('tag releases wait for successful CI on the exact tagged commit', () => {
  const verification = release.slice(release.indexOf('  verify-version:'), release.indexOf('  build:'));
  assert.match(verification, /actions:\s*read/);
  assert.match(verification, /name: Require successful CI run for tagged commit/);
  assert.match(verification, /public version tag must prove the exact commit passed the CI workflow/);
  assert.match(verification, /if: startsWith\(github\.ref, 'refs\/tags\/v'\) \|\| startsWith\(github\.event\.inputs\.ref, 'v'\)/);
  assert.match(verification, /TAG_COMMIT: \$\{\{ steps\.release-context\.outputs\.tag_commit \}\}/);
  assert.match(verification, /actions\/workflows\/\$\{CI_WORKFLOW_FILE\}\/runs\?event=push&head_sha=\$\{TAG_COMMIT\}/);
  assert.match(verification, /gh api --paginate --slurp "\$api_path"/);
  assert.match(verification, /\.head_sha == \$sha and \.event == "push"/);
  assert.match(verification, /\.conclusion == "success"/);
  assert.match(verification, /CI_POLL_SECONDS: '15'/);
  assert.match(verification, /CI_WAIT_TIMEOUT_SECONDS: '1800'/);
  assert.match(verification, /timeout-minutes: 32/);
  assert.match(release, /needs: verify-version/);
});

test('GitHub releases remain anchored to their pushed tag', () => {
  const publish = release.slice(release.indexOf('  publish:'), release.indexOf('  release:'));
  assert.doesNotMatch(publish, /--target\b/);
});
