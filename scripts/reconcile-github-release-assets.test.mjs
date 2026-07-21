import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  GitHubReleaseReconciliationError,
  parseReconciliationArgs,
  planReleaseAssetUploads,
  reconcileGitHubReleaseAssets,
} from './reconcile-github-release-assets.mjs';
import {
  cleanupOwnedStarterAsset,
  GitHubReleaseAssetCleanupError,
} from './cleanup-github-release-asset.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const localAssets = [
  { name: 'macos-universal.dmg', bytes: 10, sha256: 'b'.repeat(64) },
  { name: 'windows-x64.exe', bytes: 20, sha256: 'c'.repeat(64) },
];
const release = {
  id: 41,
  draft: true,
  tag_name: 'v1.2.3',
  body: `notes\n<!-- junqi-release-source-sha: ${SOURCE_SHA} -->`,
};
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof GitHubReleaseReconciliationError && error.code === code);
}

describe('GitHub release asset reconciler', () => {
  test('returns only missing assets and preserves already verified remote assets', () => {
    assert.deepEqual(
      planReleaseAssetUploads({
        localAssets,
        release,
        tag: 'v1.2.3',
        sourceSha: SOURCE_SHA,
        remoteAssets: [{
          id: 1,
          name: 'macos-universal.dmg',
          size: 10,
          state: 'uploaded',
          digest: `sha256:${'b'.repeat(64)}`,
        }],
      }),
      { status: 'READY', releaseId: 41, missing: ['windows-x64.exe'] },
    );
  });

  test('is idempotent after every asset is present and exact', () => {
    assert.deepEqual(
      planReleaseAssetUploads({
        localAssets,
        release,
        tag: 'v1.2.3',
        sourceSha: SOURCE_SHA,
        remoteAssets: localAssets.map((asset) => ({
          id: asset.name === 'macos-universal.dmg' ? 1 : 2,
          name: asset.name,
          size: asset.bytes,
          state: 'uploaded',
          digest: `sha256:${asset.sha256}`,
        })),
      }),
      { status: 'READY', releaseId: 41, missing: [] },
    );
  });

  test('refuses ownership, extra, conflicting, and digestless remote assets', () => {
    expectCode(
      () => planReleaseAssetUploads({ localAssets, release: { ...release, body: 'other' }, tag: 'v1.2.3', sourceSha: SOURCE_SHA, remoteAssets: [] }),
      'RELEASE_OWNERSHIP_MISMATCH',
    );
    expectCode(
      () => planReleaseAssetUploads({ localAssets, release, tag: 'v1.2.3', sourceSha: SOURCE_SHA, remoteAssets: [{ id: 1, name: 'other.exe', size: 1, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` }] }),
      'UNEXPECTED_REMOTE_ASSET',
    );
    expectCode(
      () => planReleaseAssetUploads({ localAssets, release, tag: 'v1.2.3', sourceSha: SOURCE_SHA, remoteAssets: [{ id: 1, name: 'macos-universal.dmg', size: 10, state: 'uploaded' }] }),
      'REMOTE_ASSET_DIGEST_UNAVAILABLE',
    );
    expectCode(
      () => planReleaseAssetUploads({ localAssets, release, tag: 'v1.2.3', sourceSha: SOURCE_SHA, remoteAssets: [{ id: 1, name: 'macos-universal.dmg', size: 10, state: 'uploaded', digest: `sha256:${'d'.repeat(64)}` }] }),
      'REMOTE_ASSET_CONFLICT',
    );
  });

  test('plans only empty starter assets for owned cleanup', () => {
    assert.deepEqual(
      planReleaseAssetUploads({
        localAssets,
        release,
        tag: 'v1.2.3',
        sourceSha: SOURCE_SHA,
        remoteAssets: [{ id: 9, name: 'macos-universal.dmg', size: 0, state: 'starter', digest: null }],
      }),
      { status: 'CLEANUP_REQUIRED', releaseId: 41, cleanup: [{ id: 9, name: 'macos-universal.dmg' }] },
    );
    expectCode(
      () => planReleaseAssetUploads({
        localAssets,
        release,
        tag: 'v1.2.3',
        sourceSha: SOURCE_SHA,
        remoteAssets: [{ id: 9, name: 'macos-universal.dmg', size: 0, state: 'processing', digest: null }],
      }),
      'REMOTE_ASSET_STATE_UNAVAILABLE',
    );
    expectCode(
      () => planReleaseAssetUploads({
        localAssets,
        release,
        tag: 'v1.2.3',
        sourceSha: SOURCE_SHA,
        remoteAssets: [{ id: 9, name: 'macos-universal.dmg', size: 1, state: 'starter', digest: null }],
      }),
      'REMOTE_ASSET_CONFLICT',
    );
  });

  test('deletes a precisely identified starter residue before returning a new upload plan', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-reconcile-assets-'));
    roots.push(root);
    const installer = 'installer';
    const installerSha = createHash('sha256').update(installer).digest('hex');
    await writeFile(path.join(root, 'junqi.exe'), installer);
    await writeFile(path.join(root, 'release-assets-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      artifacts: [{ name: 'junqi.exe', bytes: installer.length, sha256: installerSha }],
    })}\n`);

    const requests = [];
    let assetList = 0;
    const result = await reconcileGitHubReleaseAssets({
      apiBase: 'https://api.example.test',
      repo: 'owner/repo',
      tag: 'v1.2.3',
      releaseId: '41',
      sourceSha: SOURCE_SHA,
      root,
      token: 'token',
      sleep: async () => {},
      fetchImpl: async (url, options) => {
        requests.push({ url, method: options.method ?? 'GET' });
        if (options.method === 'DELETE') return new Response(null, { status: 204 });
        if (url.endsWith('/releases/assets/9')) {
          return new Response(JSON.stringify({
            id: 9,
            name: 'junqi.exe',
            size: 0,
            state: 'starter',
            digest: null,
          }), { status: 200 });
        }
        if (url.includes('/assets?')) {
          assetList += 1;
          return new Response(JSON.stringify(assetList === 1
            ? [{ id: 9, name: 'junqi.exe', size: 0, state: 'starter', digest: null }]
            : []), { status: 200 });
        }
        return new Response(JSON.stringify(release), { status: 200 });
      },
    });

    assert.deepEqual(result, {
      status: 'READY',
      releaseId: 41,
      missing: ['junqi.exe', 'release-assets-manifest.json'],
    });
    assert.deepEqual(
      requests.filter((request) => request.method === 'DELETE'),
      [{ url: 'https://api.example.test/repos/owner/repo/releases/assets/9', method: 'DELETE' }],
    );
  });

  test('rechecks starter state and draft ownership immediately before deletion', async () => {
    let deletes = 0;
    const changed = await cleanupOwnedStarterAsset({
      apiBase: 'https://api.example.test',
      repo: 'owner/repo',
      tag: 'v1.2.3',
      releaseId: 41,
      sourceSha: SOURCE_SHA,
      asset: { id: 9, name: 'macos-universal.dmg' },
      token: 'token',
      sleep: async () => {},
      fetchImpl: async (url, options) => {
        if (options.method === 'DELETE') {
          deletes += 1;
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/releases/assets/9')) {
          return new Response(JSON.stringify({
            id: 9,
            name: 'macos-universal.dmg',
            size: 10,
            state: 'uploaded',
            digest: `sha256:${'b'.repeat(64)}`,
          }), { status: 200 });
        }
        return new Response(JSON.stringify(release), { status: 200 });
      },
    });
    assert.deepEqual(changed, {
      status: 'STATE_CHANGED',
      assetId: 9,
      name: 'macos-universal.dmg',
      state: 'uploaded',
    });
    assert.equal(deletes, 0);

    await assert.rejects(
      cleanupOwnedStarterAsset({
        apiBase: 'https://api.example.test',
        repo: 'owner/repo',
        tag: 'v1.2.3',
        releaseId: 41,
        sourceSha: SOURCE_SHA,
        asset: { id: 9, name: 'macos-universal.dmg' },
        token: 'token',
        sleep: async () => {},
        fetchImpl: async () => new Response(JSON.stringify({ ...release, draft: false }), { status: 200 }),
      }),
      (error) => error instanceof GitHubReleaseAssetCleanupError && error.code === 'RELEASE_NOT_DRAFT',
    );
  });

  test('honors a headerless secondary-limit response before retrying starter deletion', async () => {
    let deletes = 0;
    const delays = [];
    const result = await cleanupOwnedStarterAsset({
      apiBase: 'https://api.example.test',
      repo: 'owner/repo',
      tag: 'v1.2.3',
      releaseId: 41,
      sourceSha: SOURCE_SHA,
      asset: { id: 9, name: 'macos-universal.dmg' },
      token: 'token',
      sleep: async (delay) => delays.push(delay),
      fetchImpl: async (url, options) => {
        if (options.method === 'DELETE') {
          deletes += 1;
          return deletes === 1
            ? new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit.' }), {
              status: 403,
              headers: { 'content-type': 'application/json' },
            })
            : new Response(null, { status: 204 });
        }
        if (url.endsWith('/releases/assets/9')) {
          return new Response(JSON.stringify({
            id: 9,
            name: 'macos-universal.dmg',
            size: 0,
            state: 'starter',
            digest: null,
          }), { status: 200 });
        }
        return new Response(JSON.stringify(release), { status: 200 });
      },
    });
    assert.deepEqual(result, {
      status: 'DELETED',
      assetId: 9,
      name: 'macos-universal.dmg',
    });
    assert.equal(deletes, 2);
    assert.deepEqual(delays, [60_000]);
  });

  test('requires immutable reconciliation arguments', () => {
    assert.deepEqual(parseReconciliationArgs([
      '--root', 'release-assets/publication',
      '--repo', 'owner/repo',
      '--tag', 'v1.2.3',
      '--release-id', '41',
      '--source-sha', SOURCE_SHA,
      '--seal', 'release-publication-seal.json',
      '--seal-sha', 'c'.repeat(64),
    ]), {
      root: 'release-assets/publication',
      repo: 'owner/repo',
      tag: 'v1.2.3',
      'release-id': '41',
      'source-sha': SOURCE_SHA,
      seal: 'release-publication-seal.json',
      'seal-sha': 'c'.repeat(64),
    });
    expectCode(
      () => parseReconciliationArgs(['--root', 'x', '--repo', 'owner/repo', '--tag', 'v1.2.3', '--release-id', '41', '--source-sha', 'bad']),
      'INVALID_ARGUMENT',
    );
  });
});
