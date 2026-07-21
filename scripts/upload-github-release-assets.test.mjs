import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  buildReleaseAssetUploadUrl,
  calculateUploadDeadlineMs,
  GitHubReleaseUploadError,
  parseUploadArgs,
  validateUploadResponse,
  uploadGitHubReleaseAssets,
} from './upload-github-release-assets.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const REPO = 'owner/repo';
const TAG = 'v1.2.3';
const RELEASE_ID = 41;
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function release(overrides = {}) {
  return {
    id: RELEASE_ID,
    draft: true,
    tag_name: TAG,
    body: `notes\n<!-- junqi-release-source-sha: ${SOURCE_SHA} -->`,
    upload_url: `https://api.example.test/repos/${REPO}/releases/${RELEASE_ID}/assets{?name,label}`,
    ...overrides,
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function createAssetRoot(name = 'junqi.exe', contents = 'signed-installer') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'junqi-release-upload-'));
  roots.push(root);
  await writeFile(path.join(root, name), contents);
  const digest = sha256(contents);
  await writeFile(path.join(root, 'release-assets-manifest.json'), `${JSON.stringify({
    schemaVersion: 1,
    artifacts: [{ name, bytes: Buffer.byteLength(contents), sha256: digest }],
  })}\n`);
  await writeFile(path.join(root, 'release-decision.json'), '{"schemaVersion":1,"kind":"SATISFIED"}\n');
  return { root, name, contents, digest };
}

function expectCode(code) {
  return (error) => error instanceof GitHubReleaseUploadError && error.code === code;
}

describe('immutable GitHub release asset uploader', () => {
  test('derives a bounded large-file deadline from the minimum transfer rate', () => {
    const fiveHundredMiB = calculateUploadDeadlineMs(500 * 1024 * 1024);
    assert.equal(fiveHundredMiB, 530_000);
    assert.ok(fiveHundredMiB > 40_000);
    assert.equal(calculateUploadDeadlineMs(2 * 1024 * 1024 * 1024), 2_078_000);
  });

  test('parses an immutable release identity and a bounded explicit asset set', () => {
    assert.deepEqual(parseUploadArgs([
      '--root', 'release-assets/publication',
      '--repo', REPO,
      '--tag', TAG,
      '--release-id', String(RELEASE_ID),
      '--source-sha', SOURCE_SHA,
      '--seal', 'release-publication-seal.json',
      '--seal-sha', 'c'.repeat(64),
      '--asset', 'junqi.exe',
      '--asset', 'release-decision.json',
    ]), {
      assets: ['junqi.exe', 'release-decision.json'],
      root: 'release-assets/publication',
      repo: REPO,
      tag: TAG,
      'release-id': String(RELEASE_ID),
      'source-sha': SOURCE_SHA,
      seal: 'release-publication-seal.json',
      'seal-sha': 'c'.repeat(64),
    });
    assert.throws(
      () => parseUploadArgs([
        '--root', 'x', '--repo', REPO, '--tag', TAG, '--release-id', 'not-an-id', '--source-sha', SOURCE_SHA,
      ]),
      expectCode('INVALID_ARGUMENT'),
    );
  });

  test('preserves GitHub rate-limit hints on upload failures', async () => {
    const asset = await createAssetRoot();
    const expected = {
      name: asset.name,
      bytes: Buffer.byteLength(asset.contents),
      sha256: asset.digest,
    };
    assert.throws(
      () => validateUploadResponse({
        status: 403,
        headers: new Headers({
          'retry-after': '4',
          'x-ratelimit-remaining': '0',
        }),
        expected,
      }),
      (error) => error instanceof GitHubReleaseUploadError
        && error.code === 'UPLOAD_RETRYABLE_STATUS'
        && error.retryable === true
        && error.rateLimited === true
        && error.retryAfterMs === 4_000
        && error.rateLimitRemaining === 0,
    );
    assert.throws(
      () => validateUploadResponse({
        status: 403,
        headers: new Headers(),
        body: { message: 'You have exceeded a secondary rate limit.' },
        expected,
      }),
      (error) => error instanceof GitHubReleaseUploadError
        && error.code === 'UPLOAD_RETRYABLE_STATUS'
        && error.rateLimited === true,
    );
  });

  test('builds an upload URL bound to the immutable release id and trusted host', () => {
    assert.equal(
      buildReleaseAssetUploadUrl({
        release: release(),
        apiBase: 'https://api.example.test',
        repo: REPO,
        releaseId: RELEASE_ID,
        name: 'junqi.exe',
      }),
      `https://api.example.test/repos/${REPO}/releases/${RELEASE_ID}/assets?name=junqi.exe`,
    );
    assert.equal(
      new URL(buildReleaseAssetUploadUrl({
        release: release({ upload_url: undefined }),
        apiBase: 'https://api.github.com',
        repo: REPO,
        releaseId: RELEASE_ID,
        name: 'junqi.exe',
      })).hostname,
      'uploads.github.com',
    );
    assert.equal(
      buildReleaseAssetUploadUrl({
        release: release({
          upload_url: `https://github.example.test/api/uploads/repos/${REPO}/releases/${RELEASE_ID}/assets{?name,label}`,
        }),
        apiBase: 'https://github.example.test/api/v3',
        repo: REPO,
        releaseId: RELEASE_ID,
        name: 'junqi.exe',
      }),
      `https://github.example.test/api/uploads/repos/${REPO}/releases/${RELEASE_ID}/assets?name=junqi.exe`,
    );
    assert.throws(
      () => buildReleaseAssetUploadUrl({
        release: release({ upload_url: `https://api.example.test/repos/${REPO}/releases/99/assets{?name,label}` }),
        apiBase: 'https://api.example.test',
        repo: REPO,
        releaseId: RELEASE_ID,
        name: 'junqi.exe',
      }),
      expectCode('UPLOAD_RELEASE_ID_MISMATCH'),
    );
  });

  test('streams exact bytes to the release-id endpoint and verifies the remote postcondition', async () => {
    const asset = await createAssetRoot();
    const remoteAssets = [];
    const requests = [];
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      requests.push({ url: requestUrl.toString(), method: options.method ?? 'GET' });
      if (options.method === 'POST') {
        const chunks = [];
        for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        assert.equal(bytes.toString('utf8'), asset.contents);
        assert.equal(options.headers['content-length'], String(bytes.byteLength));
        assert.equal(requestUrl.pathname, `/repos/${REPO}/releases/${RELEASE_ID}/assets`);
        assert.equal(requestUrl.searchParams.get('name'), asset.name);
        const uploaded = {
          id: 7,
          name: asset.name,
          size: bytes.byteLength,
          state: 'uploaded',
          digest: `sha256:${sha256(bytes)}`,
        };
        remoteAssets.push(uploaded);
        return jsonResponse(uploaded, 201);
      }
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) return jsonResponse(remoteAssets);
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}`)) return jsonResponse(release());
      throw new Error(`Unexpected request: ${requestUrl}`);
    };

    const result = await uploadGitHubReleaseAssets({
      apiBase: 'https://api.example.test',
      repo: REPO,
      tag: TAG,
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      root: asset.root,
      assets: [asset.name],
      token: 'token',
      fetchImpl,
      timeoutMs: 1_000,
      sleep: async () => {},
    });

    assert.deepEqual(result, {
      status: 'UPLOADED',
      releaseId: RELEASE_ID,
      uploaded: [asset.name],
      skipped: [],
    });
    assert.equal(requests.filter(({ method }) => method === 'POST').length, 1);
    assert.equal(requests.some(({ url }) => url.includes(`/releases/tags/${TAG}`)), false);
  });

  test('reconciles a committed upload when the 201 response body is malformed', async () => {
    const asset = await createAssetRoot();
    const remoteAssets = [];
    let posts = 0;
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (options.method === 'POST') {
        posts += 1;
        const chunks = [];
        for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        remoteAssets.push({
          id: 31,
          name: asset.name,
          size: bytes.byteLength,
          state: 'uploaded',
          digest: `sha256:${sha256(bytes)}`,
        });
        return jsonResponse({}, 201);
      }
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) return jsonResponse(remoteAssets);
      return jsonResponse(release());
    };

    const result = await uploadGitHubReleaseAssets({
      apiBase: 'https://api.example.test',
      repo: REPO,
      tag: TAG,
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      root: asset.root,
      assets: [asset.name],
      token: 'token',
      fetchImpl,
      sleep: async () => {},
    });
    assert.equal(result.status, 'UPLOADED');
    assert.deepEqual(result.uploaded, [asset.name]);
    assert.equal(posts, 1);
  });

  test('treats an exact existing asset as an idempotent no-op', async () => {
    const asset = await createAssetRoot();
    let posts = 0;
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (options.method === 'POST') {
        posts += 1;
        throw new Error('POST must not be called');
      }
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) {
        return jsonResponse([{
          id: 7,
          name: asset.name,
          size: Buffer.byteLength(asset.contents),
          state: 'uploaded',
          digest: `sha256:${asset.digest}`,
        }]);
      }
      return jsonResponse(release());
    };

    const result = await uploadGitHubReleaseAssets({
      apiBase: 'https://api.example.test',
      repo: REPO,
      tag: TAG,
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      root: asset.root,
      assets: [asset.name],
      token: 'token',
      fetchImpl,
      sleep: async () => {},
    });
    assert.equal(result.status, 'VERIFIED');
    assert.deepEqual(result.skipped, [asset.name]);
    assert.equal(posts, 0);
  });

  test('fails deterministic upload rejection without post-error reconciliation', async () => {
    const asset = await createAssetRoot();
    let releaseReads = 0;
    let assetReads = 0;
    let posts = 0;
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (options.method === 'POST') {
        posts += 1;
        for await (const _chunk of options.body) { /* consume stable upload */ }
        return jsonResponse({ message: 'unauthorized' }, 401);
      }
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) {
        assetReads += 1;
        return jsonResponse([]);
      }
      releaseReads += 1;
      return jsonResponse(release());
    };

    await assert.rejects(
      uploadGitHubReleaseAssets({
        apiBase: 'https://api.example.test',
        repo: REPO,
        tag: TAG,
        releaseId: RELEASE_ID,
        sourceSha: SOURCE_SHA,
        root: asset.root,
        assets: [asset.name],
        token: 'token',
        fetchImpl,
        sleep: async () => {},
      }),
      expectCode('UPLOAD_REJECTED'),
    );
    assert.deepEqual({ releaseReads, assetReads, posts }, { releaseReads: 1, assetReads: 1, posts: 1 });
  });

  test('classifies an immediate rate-limit response before a slow request body drains', async () => {
    const asset = await createAssetRoot();
    const events = [];
    let posted = false;
    let bodyClosed = false;
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (options.method === 'POST') {
        posted = true;
        options.body.once('close', () => {
          bodyClosed = true;
          events.push('BODY_CLOSED');
        });
        events.push('POST');
        // Deliberately do not consume the body. A real upstream can reject a
        // request before reading a large installer stream.
        return jsonResponse({ message: 'secondary rate limit' }, 429, { 'retry-after': '1' });
      }
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) {
        return jsonResponse(posted ? [{
          id: 71,
          name: asset.name,
          size: Buffer.byteLength(asset.contents),
          state: 'uploaded',
          digest: `sha256:${asset.digest}`,
        }] : []);
      }
      return jsonResponse(release());
    };

    const result = await uploadGitHubReleaseAssets({
      apiBase: 'https://api.example.test',
      repo: REPO,
      tag: TAG,
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      root: asset.root,
      assets: [asset.name],
      token: 'token',
      fetchImpl,
      timeoutMs: 1_000,
      operationTimeoutMs: 10_000,
      sleep: async (delay) => events.push(`SLEEP:${delay}`),
    });

    assert.equal(result.status, 'UPLOADED');
    assert.equal(bodyClosed, true);
    assert.deepEqual(events.slice(0, 3), ['POST', 'BODY_CLOSED', 'SLEEP:1000']);
  });

  test('waits for a rate-limit hint before reconciling an ambiguous upload', async () => {
    const asset = await createAssetRoot();
    const events = [];
    const remoteAssets = [];
    let posts = 0;
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (options.method === 'POST') {
        posts += 1;
        const chunks = [];
        for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        remoteAssets.push({
          id: 21,
          name: asset.name,
          size: bytes.byteLength,
          state: 'uploaded',
          digest: `sha256:${sha256(bytes)}`,
        });
        events.push('POST');
        return jsonResponse({ message: 'secondary rate limit' }, 429, { 'retry-after': '2' });
      }
      events.push(requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`) ? 'GET_ASSETS' : 'GET_RELEASE');
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) return jsonResponse(remoteAssets);
      return jsonResponse(release());
    };

    const result = await uploadGitHubReleaseAssets({
      apiBase: 'https://api.example.test',
      repo: REPO,
      tag: TAG,
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      root: asset.root,
      assets: [asset.name],
      token: 'token',
      fetchImpl,
      sleep: async (delay) => events.push(`SLEEP:${delay}`),
    });
    const postIndex = events.indexOf('POST');
    assert.equal(events[postIndex + 1], 'SLEEP:2000');
    assert.equal(posts, 1);
    assert.equal(result.status, 'UPLOADED');
  });

  test('fails closed on a rate-limit hint beyond the transaction wait bound', async () => {
    const asset = await createAssetRoot();
    let releaseReads = 0;
    let assetReads = 0;
    let posts = 0;
    const sleeps = [];
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (options.method === 'POST') {
        posts += 1;
        for await (const _chunk of options.body) { /* consume stable upload */ }
        return jsonResponse({ message: 'rate limited' }, 429, { 'retry-after': '120' });
      }
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) {
        assetReads += 1;
        return jsonResponse([]);
      }
      releaseReads += 1;
      return jsonResponse(release());
    };

    await assert.rejects(
      uploadGitHubReleaseAssets({
        apiBase: 'https://api.example.test',
        repo: REPO,
        tag: TAG,
        releaseId: RELEASE_ID,
        sourceSha: SOURCE_SHA,
        root: asset.root,
        assets: [asset.name],
        token: 'token',
        fetchImpl,
        sleep: async (delay) => sleeps.push(delay),
      }),
      (error) => error.code === 'GITHUB_RATE_LIMIT_BUDGET_EXCEEDED',
    );
    assert.deepEqual({ releaseReads, assetReads, posts }, { releaseReads: 1, assetReads: 1, posts: 1 });
    assert.deepEqual(sleeps, []);
  });

  test('reconciles a committed upload when the POST response is a transient failure', async () => {
    const asset = await createAssetRoot();
    const remoteAssets = [];
    let posts = 0;
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (options.method === 'POST') {
        posts += 1;
        const chunks = [];
        for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        remoteAssets.push({
          id: 9,
          name: asset.name,
          size: bytes.byteLength,
          state: 'uploaded',
          digest: `sha256:${sha256(bytes)}`,
        });
        return jsonResponse({ message: 'upstream response was lost' }, 502);
      }
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) return jsonResponse(remoteAssets);
      return jsonResponse(release());
    };

    const result = await uploadGitHubReleaseAssets({
      apiBase: 'https://api.example.test',
      repo: REPO,
      tag: TAG,
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      root: asset.root,
      assets: [asset.name],
      token: 'token',
      fetchImpl,
      timeoutMs: 1_000,
      sleep: async () => {},
    });
    assert.equal(result.status, 'UPLOADED');
    assert.deepEqual(result.uploaded, [asset.name]);
    assert.equal(posts, 1);
  });

  test('waits through response-loss visibility lag before reconciling a duplicate POST', async () => {
    const asset = await createAssetRoot();
    let committedAsset;
    let posts = 0;
    let assetLists = 0;
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (options.method === 'POST') {
        posts += 1;
        const chunks = [];
        for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        committedAsset ??= {
          id: 17,
          name: asset.name,
          size: bytes.byteLength,
          state: 'uploaded',
          digest: `sha256:${sha256(bytes)}`,
        };
        return jsonResponse(
          { message: posts === 1 ? 'response lost' : 'already exists' },
          posts === 1 ? 502 : 422,
        );
      }
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) {
        assetLists += 1;
        return jsonResponse(assetLists >= 9 ? [committedAsset] : []);
      }
      return jsonResponse(release());
    };

    const result = await uploadGitHubReleaseAssets({
      apiBase: 'https://api.example.test',
      repo: REPO,
      tag: TAG,
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      root: asset.root,
      assets: [asset.name],
      token: 'token',
      fetchImpl,
      timeoutMs: 1_000,
      sleep: async () => {},
    });
    assert.equal(result.status, 'UPLOADED');
    assert.deepEqual(result.uploaded, [asset.name]);
    assert.equal(posts, 2);
    assert.equal(assetLists, 9);
  });

  test('fails closed when the local file identity changes while its request body is streaming', async () => {
    const asset = await createAssetRoot('junqi.exe', Buffer.alloc(256 * 1024, 0x41));
    let mutated = false;
    const fetchImpl = async (url, options = {}) => {
      const requestUrl = new URL(url);
      if (options.method === 'POST') {
        for await (const _chunk of options.body) {
          if (!mutated) {
            mutated = true;
            await writeFile(path.join(asset.root, asset.name), Buffer.alloc(256 * 1024, 0x42));
          }
        }
        return jsonResponse({ message: 'should not complete' }, 500);
      }
      if (requestUrl.pathname.endsWith(`/releases/${RELEASE_ID}/assets`)) return jsonResponse([]);
      return jsonResponse(release());
    };

    await assert.rejects(
      uploadGitHubReleaseAssets({
        apiBase: 'https://api.example.test',
        repo: REPO,
        tag: TAG,
        releaseId: RELEASE_ID,
        sourceSha: SOURCE_SHA,
        root: asset.root,
        assets: [asset.name],
        token: 'token',
        fetchImpl,
        timeoutMs: 1_000,
        sleep: async () => {},
      }),
      expectCode('ASSET_CHANGED'),
    );
  });
});
