import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const taggedRelease = readFileSync(new URL('../.github/workflows/tag-release.yml', import.meta.url), 'utf8');
const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

function dependencyMinor(version, label) {
  const match = version.match(/^(?:[~^])?(\d+)\.(\d+)(?:\.\d+)?$/);
  assert.ok(match, `${label} must use an explicit semantic version`);
  return `${match[1]}.${match[2]}`;
}

function cargoDependencyVersion(name) {
  const match = cargo.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'm'));
  assert.ok(match, `${name} must have a direct Cargo version requirement`);
  return match[1];
}

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

test('Tauri JavaScript bindings and Rust plugins stay on the same minor', () => {
  for (const name of ['dialog', 'fs']) {
    const npmName = `@tauri-apps/plugin-${name}`;
    const cargoName = `tauri-plugin-${name}`;
    const npmVersion = packageJson.dependencies[npmName];
    const cargoVersion = cargoDependencyVersion(cargoName);

    assert.equal(
      dependencyMinor(cargoVersion, cargoName),
      dependencyMinor(npmVersion, npmName),
      `${npmName} and ${cargoName} must stay on the same major/minor`,
    );
    assert.match(cargoVersion, /^~/, `${cargoName} must not drift across minor releases`);
  }
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

test('candidate artifacts are flattened and bound to the immutable workflow run', () => {
  assert.match(release, /node scripts\/stage-release-assets\.mjs/);
  assert.match(release, /--prefix "\$\{\{ matrix\.stage_prefix \}\}"/);
  assert.match(release, /name: junqi-desktop-\$\{\{ matrix\.artifact_name \}\}-\$\{\{ github\.run_id \}\}/);
  assert.match(release, /pattern: junqi-desktop-\*-\$\{\{ github\.run_id \}\}/);
  assert.match(release, /merge-multiple: true/);
  assert.doesNotMatch(release, /path:\s*\$\{\{ matrix\.installer_paths \}\}/);
});

test('release candidates are manual and tag-owned workflow code cannot enter their path', () => {
  assert.match(release, /workflow_dispatch:/);
  assert.doesNotMatch(release, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.doesNotMatch(release, /tags:\s*\[/);
  assert.match(release, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(release, /persist-credentials: false/);
  assert.match(release, /node scripts\/release-source-policy\.mjs/);
});

test('trusted publication remains unreachable without a promotion decision', () => {
  const verification = release.slice(release.indexOf('  verify-version:'), release.indexOf('  build:'));
  const publish = release.slice(release.indexOf('  publish:'), release.indexOf('  release:'));
  assert.match(verification, /signing-enabled: \$\{\{ steps\.source\.outputs\.signing-enabled \}\}/);
  assert.match(publish, /needs\.verify-version\.outputs\.signing-enabled == 'true'/);
  assert.match(publish, /external-release-gate\.result == 'success'/);
  assert.match(publish, /external-release-decision-attest\.result == 'success'/);
  assert.match(release, /trusted promotion/i);
});

test('GitHub releases remain anchored to their pushed tag', () => {
  const publish = release.slice(release.indexOf('  publish:'), release.indexOf('  release:'));
  assert.doesNotMatch(publish, /--target\b/);
});

test('version tags retain a CI-gated four-platform desktop release path', () => {
  assert.match(taggedRelease, /tags: \['v\*'\]/);
  assert.match(taggedRelease, /git merge-base --is-ancestor "\$source_sha" origin\/main/);
  assert.match(taggedRelease, /actions\/workflows\/ci\.yml\/runs\?event=push&head_sha=\$\{SOURCE_SHA\}/);
  assert.match(taggedRelease, /\.head_branch == "main"/);
  for (const target of [
    'aarch64-apple-darwin',
    'x86_64-apple-darwin',
    'x86_64-pc-windows-msvc',
    'aarch64-pc-windows-msvc',
  ]) {
    assert.match(taggedRelease, new RegExp(`target: '${target}'`));
  }
  assert.match(taggedRelease, /generate-updater-manifest\.mjs/);
  assert.match(taggedRelease, /gh release create "\$RELEASE_TAG"/);
  assert.doesNotMatch(taggedRelease, /--clobber/);
});
