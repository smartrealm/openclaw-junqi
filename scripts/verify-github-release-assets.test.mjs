import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  collectLocalReleaseAssets,
  GitHubReleaseAssetError,
  parseReleaseAssetArgs,
  validateRemoteReleaseAssets,
  verifyGitHubReleaseAssets,
} from './verify-github-release-assets.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof GitHubReleaseAssetError && error.code === code);
}

describe('GitHub release asset verification', () => {
  test('binds an exact top-level local asset set to remote SHA-256 digests', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-release-assets-'));
    roots.push(root);
    await writeFile(path.join(root, 'junqi.dmg'), 'dmg-bytes');
    await writeFile(path.join(root, 'junqi.exe'), 'exe-bytes');
    const localAssets = await collectLocalReleaseAssets(root);
    const remoteAssets = localAssets.map((asset, index) => ({
      id: index + 1,
      name: asset.name,
      size: asset.bytes,
      state: 'uploaded',
      digest: `sha256:${asset.sha256}`,
    }));
    assert.deepEqual(
      validateRemoteReleaseAssets({
        expectedState: 'draft',
        localAssets,
        release: { id: 7, draft: true },
        remoteAssets,
      }),
      { status: 'VERIFIED', releaseId: 7, state: 'draft', assets: 2 },
    );
    assert.deepEqual(
      validateRemoteReleaseAssets({
        expectedState: 'published',
        localAssets,
        release: { id: 7, draft: false },
        remoteAssets,
      }),
      { status: 'VERIFIED', releaseId: 7, state: 'published', assets: 2 },
    );
  });

  test('accepts only explicitly named provenance metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-release-assets-'));
    roots.push(root);
    await writeFile(path.join(root, 'junqi.dmg'), 'dmg-bytes');
    await writeFile(path.join(root, 'release-decision.json'), '{}\n');
    assert.equal((await collectLocalReleaseAssets(root)).length, 2);
    await writeFile(path.join(root, 'internal-debug.json'), '{}\n');
    await assert.rejects(
      collectLocalReleaseAssets(root),
      (error) => error instanceof GitHubReleaseAssetError && error.code === 'UNEXPECTED_RELEASE_ASSET',
    );
  });

  test('binds publication installers to the attested manifest before remote verification', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-release-assets-'));
    roots.push(root);
    await writeFile(path.join(root, 'junqi.dmg'), 'dmg-bytes');
    await writeFile(path.join(root, 'junqi.exe'), 'exe-bytes');
    const digest = (value) => createHash('sha256').update(value).digest('hex');
    await writeFile(path.join(root, 'release-assets-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      artifacts: [
        { name: 'junqi.dmg', bytes: 9, sha256: digest('dmg-bytes') },
        { name: 'junqi.exe', bytes: 9, sha256: digest('exe-bytes') },
      ],
    })}\n`);
    assert.equal((await collectLocalReleaseAssets(root, { requireManifest: true })).length, 3);
    await writeFile(path.join(root, 'junqi.exe'), 'tampered');
    await assert.rejects(
      collectLocalReleaseAssets(root, { requireManifest: true }),
      (error) => error instanceof GitHubReleaseAssetError && error.code === 'PROVENANCE_MANIFEST_MISMATCH',
    );
  });

  test('requires an immutable release id and explicit expected state', () => {
    const required = [
      '--root', 'release-assets',
      '--repo', 'smartrealm/openclaw-junqi',
      '--tag', 'v1.2.3',
      '--release-id', '123456',
      '--source-sha', 'a'.repeat(40),
      '--expected-state', 'draft',
      '--seal', 'release-publication-seal.json',
      '--seal-sha', 'c'.repeat(64),
    ];
    assert.deepEqual(parseReleaseAssetArgs(required), {
      root: 'release-assets',
      repo: 'smartrealm/openclaw-junqi',
      tag: 'v1.2.3',
      'release-id': '123456',
      'source-sha': 'a'.repeat(40),
      'expected-state': 'draft',
      seal: 'release-publication-seal.json',
      'seal-sha': 'c'.repeat(64),
    });
    expectCode(
      () => parseReleaseAssetArgs(required.filter((_, index) => index < 6 || index > 7)),
      'INVALID_ARGUMENT',
    );
    expectCode(() => parseReleaseAssetArgs(required.slice(0, -2)), 'INVALID_ARGUMENT');
    expectCode(
      () => parseReleaseAssetArgs(required.map((value, index) => index === 11 ? 'pending' : value)),
      'INVALID_ARGUMENT',
    );
  });

  test('rejects wrong API state, stale, missing, and digest-mismatched asset sets', () => {
    const localAssets = [{ name: 'junqi.exe', bytes: 10, sha256: 'a'.repeat(64) }];
    const validRemote = [{ id: 1, name: 'junqi.exe', size: 10, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` }];
    const validate = (overrides = {}) => validateRemoteReleaseAssets({
      expectedState: 'draft',
      localAssets,
      release: { id: 1, draft: true },
      remoteAssets: validRemote,
      ...overrides,
    });
    expectCode(() => validate({ release: { id: 1, draft: false } }), 'RELEASE_NOT_DRAFT');
    expectCode(
      () => validate({ expectedState: 'published', release: { id: 1, draft: true } }),
      'RELEASE_NOT_PUBLISHED',
    );
    expectCode(() => validate({ expectedState: 'pending' }), 'INVALID_EXPECTED_STATE');
    expectCode(() => validate({ release: { id: 1, draft: 'false' } }), 'INVALID_RELEASE_STATE');
    expectCode(() => validate({ remoteAssets: [] }), 'REMOTE_ASSET_SET_INCOMPLETE');
    expectCode(
      () => validate({ remoteAssets: [{ id: 1, name: 'old.exe', size: 10, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` }] }),
      'UNEXPECTED_REMOTE_ASSET',
    );
    expectCode(
      () => validate({ remoteAssets: [{ id: 1, name: 'junqi.exe', size: 10, state: 'uploaded', digest: `sha256:${'b'.repeat(64)}` }] }),
      'REMOTE_ASSET_DIGEST_MISMATCH',
    );
    expectCode(
      () => validate({ remoteAssets: [{ id: 1, name: 'junqi.exe', size: 10, state: 'uploaded', digest: null }] }),
      'REMOTE_ASSET_DIGEST_UNAVAILABLE',
    );
    expectCode(
      () => validate({ remoteAssets: [{ name: 'junqi.exe', size: 10, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` }] }),
      'REMOTE_ASSET_ID_UNAVAILABLE',
    );
    expectCode(
      () => validate({ remoteAssets: [{ id: 1, name: 'junqi.exe', size: 10, state: 'starter', digest: `sha256:${'a'.repeat(64)}` }] }),
      'REMOTE_ASSET_NOT_UPLOADED',
    );
  });

  test('waits for an incomplete remote set but still verifies exact ownership and assets', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-release-assets-'));
    roots.push(root);
    const installer = 'installer';
    const installerSha = createHash('sha256').update(installer).digest('hex');
    await writeFile(path.join(root, 'junqi.exe'), installer);
    await writeFile(path.join(root, 'release-assets-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      artifacts: [{ name: 'junqi.exe', bytes: installer.length, sha256: installerSha }],
    })}\n`);
    await writeFile(path.join(root, 'release-decision.json'), '{"schemaVersion":1,"kind":"SATISFIED"}\n');
    const localAssets = await collectLocalReleaseAssets(root, { requireManifest: true });
    const completeRemote = localAssets.map((asset, index) => ({
      id: index + 1,
      name: asset.name,
      size: asset.bytes,
      state: 'uploaded',
      digest: `sha256:${asset.sha256}`,
    }));
    let assetLists = 0;
    const sourceSha = 'a'.repeat(40);
    const result = await verifyGitHubReleaseAssets({
      expectedState: 'draft',
      localAssets,
      releaseId: '7',
      tag: 'v1.2.3',
      sourceSha,
      apiBase: 'https://api.example.test',
      repo: 'owner/repo',
      token: 'token',
      sleep: async () => {},
      fetchImpl: async (url) => {
        if (url.includes('/assets?')) {
          assetLists += 1;
          return new Response(JSON.stringify(assetLists >= 3 ? completeRemote : []), { status: 200 });
        }
        return new Response(JSON.stringify({
          id: 7,
          draft: true,
          tag_name: 'v1.2.3',
          body: `notes\n<!-- junqi-release-source-sha: ${sourceSha} -->`,
        }), { status: 200 });
      },
    });
    assert.equal(result.status, 'VERIFIED');
    assert.equal(assetLists, 3);

    await assert.rejects(
      verifyGitHubReleaseAssets({
        expectedState: 'draft',
        localAssets,
        releaseId: '7',
        tag: 'v1.2.3',
        sourceSha,
        apiBase: 'https://api.example.test',
        repo: 'owner/repo',
        token: 'token',
        sleep: async () => {},
        fetchImpl: async (url) => new Response(JSON.stringify(url.includes('/assets?')
          ? completeRemote
          : { id: 7, draft: true, tag_name: 'v1.2.3', body: 'marker removed' }), { status: 200 }),
      }),
      (error) => error instanceof GitHubReleaseAssetError && error.code === 'RELEASE_OWNERSHIP_MISMATCH',
    );
  });
});
