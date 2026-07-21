import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import { stageReleaseAssets, ReleaseAssetStagingError } from './stage-release-assets.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-release-assets-'));
  temporaryDirectories.push(root);
  return root;
}

describe('release asset staging', () => {
  test('flattens one installer per source into deterministic top-level names and digests', async () => {
    const root = await fixture();
    const dmgRoot = path.join(root, 'dmg');
    const nsisRoot = path.join(root, 'nsis');
    await mkdir(dmgRoot);
    await mkdir(nsisRoot);
    await writeFile(path.join(dmgRoot, 'JunQi.dmg'), 'dmg-bytes');
    await writeFile(path.join(nsisRoot, 'JunQi.exe'), 'exe-bytes');

    const result = await stageReleaseAssets({
      output: path.join(root, 'staged'),
      prefix: 'windows-x64',
      specs: [`${dmgRoot}|.dmg`, `${nsisRoot}|.exe`],
    });

    assert.deepEqual(result.files.map((file) => file.name), ['windows-x64-JunQi.dmg', 'windows-x64-JunQi.exe']);
    assert.equal(result.files.every((file) => !file.name.includes('/')), true);
    assert.equal((await readFile(path.join(root, 'staged', 'windows-x64-JunQi.dmg'), 'utf8')), 'dmg-bytes');
    assert.equal(result.files[0].sha256.length, 64);
  });

  test('rejects missing, ambiguous, and symlinked source inputs', async () => {
    const root = await fixture();
    const source = path.join(root, 'source');
    await mkdir(source);
    await writeFile(path.join(source, 'one.exe'), 'one');
    await writeFile(path.join(source, 'two.exe'), 'two');
    await assert.rejects(
      stageReleaseAssets({ output: path.join(root, 'out'), prefix: 'x', specs: [`${source}|.exe`] }),
      (error) => error instanceof ReleaseAssetStagingError && error.code === 'SOURCE_CARDINALITY',
    );

    const linked = path.join(root, 'linked');
    await symlink(source, linked);
    await assert.rejects(
      stageReleaseAssets({ output: path.join(root, 'out'), prefix: 'x', specs: [`${linked}|.exe`] }),
      (error) => error instanceof ReleaseAssetStagingError && error.code === 'SYMLINK_REJECTED',
    );
  });

  test('rejects unsafe prefixes and output/source overlap before deleting inputs', async () => {
    const root = await fixture();
    const source = path.join(root, 'source');
    await mkdir(source);
    await writeFile(path.join(source, 'one.exe'), 'one');
    await assert.rejects(
      stageReleaseAssets({ output: path.join(root, 'out'), prefix: '../escape', specs: [`${source}|.exe`] }),
      (error) => error instanceof ReleaseAssetStagingError && error.code === 'INVALID_PREFIX',
    );
    await assert.rejects(
      stageReleaseAssets({ output: path.join(source, 'staged'), prefix: 'safe', specs: [`${source}|.exe`] }),
      (error) => error instanceof ReleaseAssetStagingError && error.code === 'OUTPUT_SOURCE_OVERLAP',
    );
    await assert.rejects(
      stageReleaseAssets({ output: root, prefix: 'safe', specs: [`${source}|.exe`] }),
      (error) => error instanceof ReleaseAssetStagingError && error.code === 'OUTPUT_SOURCE_OVERLAP',
    );
    assert.equal(await readFile(path.join(source, 'one.exe'), 'utf8'), 'one');
  });

  test('bounds the number of source specs before traversing any filesystem tree', async () => {
    const root = await fixture();
    await assert.rejects(
      stageReleaseAssets({
        output: path.join(root, 'out'),
        prefix: 'safe',
        specs: Array.from({ length: 17 }, (_, index) => `${path.join(root, `source-${index}`)}|.exe`),
      }),
      (error) => error instanceof ReleaseAssetStagingError && error.code === 'TREE_LIMIT_EXCEEDED',
    );
  });
});
