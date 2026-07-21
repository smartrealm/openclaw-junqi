import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, test } from 'node:test';

import { createReleaseAssetManifest, ReleaseAssetManifestError } from './create-release-asset-manifest.mjs';

const temporaryDirectories = [];
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const currentSourceSha = execFileSync('git', ['rev-parse', 'HEAD^{commit}'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'junqi-asset-manifest-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('release asset manifest', () => {
  test('creates a source and bundle-bound manifest for a flat installer tree', async () => {
    const root = await fixture();
    const assets = path.join(root, 'assets');
    await mkdir(assets);
    await writeFile(path.join(assets, 'macos-universal-JunQi.dmg'), 'dmg');
    await writeFile(path.join(assets, 'windows-x86_64-JunQi.exe'), 'exe');
    const output = path.join(root, 'manifest.json');
    const manifest = await createReleaseAssetManifest({
      root: assets,
      output,
      sourceSha: currentSourceSha,
      releaseRef: 'refs/heads/main',
    });
    assert.deepEqual(manifest.source, { commit: currentSourceSha, releaseRef: 'refs/heads/main' });
    assert.equal(manifest.artifacts.length, 2);
    assert.equal(manifest.bundleSha256.length, 64);
  });

  test('rejects nested files, symlinks, and non-installer files before writing a manifest', async () => {
    const root = await fixture();
    const assets = path.join(root, 'assets');
    await mkdir(path.join(assets, 'nested'), { recursive: true });
    await writeFile(path.join(assets, 'nested', 'JunQi.exe'), 'nested');
    await assert.rejects(
      createReleaseAssetManifest({
        root: assets,
        output: path.join(root, 'manifest.json'),
        sourceSha: currentSourceSha,
        releaseRef: 'refs/tags/v0.5.4',
      }),
      (error) => error instanceof ReleaseAssetManifestError && error.code === 'NESTED_ASSET',
    );
  });

  test('rejects symlinked asset roots without following them', async () => {
    const root = await fixture();
    const real = path.join(root, 'real');
    await mkdir(real);
    await writeFile(path.join(real, 'JunQi.exe'), 'bytes');
    const linked = path.join(root, 'linked');
    await symlink(real, linked);
    await assert.rejects(
      createReleaseAssetManifest({
        root: linked,
        output: path.join(root, 'manifest.json'),
        sourceSha: '0'.repeat(40),
        releaseRef: 'refs/tags/v0.5.4',
      }),
      (error) => error instanceof ReleaseAssetManifestError && error.code === 'ROOT_INVALID',
    );
  });

  test('rejects output paths that could overwrite the source tree', async () => {
    const root = await fixture();
    const assets = path.join(root, 'assets');
    await mkdir(assets);
    await writeFile(path.join(assets, 'JunQi.exe'), 'bytes');
    await assert.rejects(
      createReleaseAssetManifest({
        root: assets,
        output: assets,
        sourceSha: currentSourceSha,
        releaseRef: 'refs/heads/main',
      }),
      (error) => error instanceof ReleaseAssetManifestError && error.code === 'OUTPUT_ROOT_OVERLAP',
    );
    await assert.rejects(
      createReleaseAssetManifest({
        root: assets,
        output: path.join(assets, 'manifest.json'),
        sourceSha: currentSourceSha,
        releaseRef: 'refs/heads/main',
      }),
      (error) => error instanceof ReleaseAssetManifestError && error.code === 'OUTPUT_ROOT_OVERLAP',
    );
  });
});
