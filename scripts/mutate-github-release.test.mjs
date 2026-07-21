import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createGitHubRelease,
  GitHubReleaseMutationError,
  parseReleaseMutationArgs,
  publishGitHubRelease,
  sourceMarker,
} from './mutate-github-release.mjs';

const API_BASE = 'https://api.example.test';
const REPO = 'owner/repo';
const TAG = 'v1.2.3';
const SOURCE_SHA = 'a'.repeat(40);
const RELEASE_ID = 41;
const MARKER = sourceMarker(SOURCE_SHA);

function release({ id = RELEASE_ID, draft = true, body = `Generated notes\n${MARKER}` } = {}) {
  return {
    id,
    tag_name: TAG,
    draft,
    body,
    name: 'JunQi Desktop 1.2.3',
  };
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function queuedFetch(steps) {
  const requests = [];
  let index = 0;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const step = steps[index++];
    if (!step) throw new Error(`unexpected request ${options.method ?? 'GET'} ${url}`);
    if (step.assert) step.assert(String(url), options);
    if (step.error) throw step.error;
    return typeof step.response === 'function'
      ? step.response(String(url), options)
      : step.response;
  };
  fetchImpl.requests = requests;
  fetchImpl.remaining = () => steps.length - index;
  return fetchImpl;
}

function commonCreate(fetchImpl, extra = {}) {
  return createGitHubRelease({
    apiBase: API_BASE,
    repo: REPO,
    tag: TAG,
    title: 'JunQi Desktop 1.2.3',
    sourceSha: SOURCE_SHA,
    token: 'token',
    fetchImpl,
    sleep: async () => {},
    operationTimeoutMs: 30_000,
    ...extra,
  });
}

function commonPublish(fetchImpl, extra = {}) {
  return publishGitHubRelease({
    apiBase: API_BASE,
    repo: REPO,
    tag: TAG,
    releaseId: String(RELEASE_ID),
    sourceSha: SOURCE_SHA,
    token: 'token',
    fetchImpl,
    sleep: async () => {},
    operationTimeoutMs: 30_000,
    ...extra,
  });
}

describe('GitHub release mutation adapter', () => {
  test('parses operation-specific arguments and rejects unbounded values', () => {
    assert.deepEqual(
      parseReleaseMutationArgs([
        'create', '--repo', REPO, '--tag', TAG, '--title', 'JunQi', '--source-sha', SOURCE_SHA,
      ]),
      { operation: 'create', repo: REPO, tag: TAG, title: 'JunQi', 'source-sha': SOURCE_SHA },
    );
    assert.deepEqual(
      parseReleaseMutationArgs([
        'publish', '--repo', REPO, '--tag', TAG, '--release-id', String(RELEASE_ID), '--source-sha', SOURCE_SHA,
      ]),
      { operation: 'publish', repo: REPO, tag: TAG, 'release-id': String(RELEASE_ID), 'source-sha': SOURCE_SHA },
    );
    assert.throws(
      () => parseReleaseMutationArgs([
        'create', '--repo', REPO, '--tag', TAG, '--title', 'x'.repeat(257), '--source-sha', SOURCE_SHA,
      ]),
      (error) => error instanceof GitHubReleaseMutationError && error.code === 'INVALID_ARGUMENT',
    );
    assert.throws(
      () => parseReleaseMutationArgs([
        'publish', '--repo', REPO, '--tag', TAG, '--release-id', '9007199254740992', '--source-sha', SOURCE_SHA,
      ]),
      (error) => error instanceof GitHubReleaseMutationError && error.code === 'INVALID_ARGUMENT',
    );
  });

  test('creates a draft with canonical marker and bounded JSON payload', async () => {
    const fetchImpl = queuedFetch([
      { response: jsonResponse([]), assert: (url, options) => {
        assert.match(url, /\/releases\?per_page=100&page=1$/);
        assert.equal(options.headers.authorization, 'Bearer token');
      } },
      { response: jsonResponse(release(), 201), assert: (url, options) => {
        assert.equal(url, `${API_BASE}/repos/${REPO}/releases`);
        assert.equal(options.method, 'POST');
        const payload = JSON.parse(options.body);
        assert.deepEqual(payload, {
          tag_name: TAG,
          name: 'JunQi Desktop 1.2.3',
          body: MARKER,
          draft: true,
          generate_release_notes: true,
        });
      } },
    ]);
    const result = await commonCreate(fetchImpl);
    assert.equal(result.action, 'CREATED');
    assert.equal(result.state, 'draft');
    assert.equal(result.releaseId, RELEASE_ID);
    assert.equal(fetchImpl.remaining(), 0);
  });

  test('resumes the exact owned draft without issuing another POST', async () => {
    const fetchImpl = queuedFetch([{ response: jsonResponse([release()]) }]);
    const result = await commonCreate(fetchImpl);
    assert.equal(result.action, 'RESUMED');
    assert.equal(result.releaseId, RELEASE_ID);
    assert.equal(fetchImpl.requests.length, 1);
  });

  test('refuses a release with the same tag but a different source marker', async () => {
    const fetchImpl = queuedFetch([{ response: jsonResponse([release({ body: 'someone else' })]) }]);
    await assert.rejects(
      commonCreate(fetchImpl),
      (error) => error instanceof GitHubReleaseMutationError
        && error.code === 'RELEASE_OWNERSHIP_MISMATCH',
    );
    assert.equal(fetchImpl.requests.length, 1);
  });

  test('reconciles an ambiguous POST by release id before considering another create', async () => {
    const fetchImpl = queuedFetch([
      { response: jsonResponse([]) },
      { response: jsonResponse({ id: RELEASE_ID }, 201) },
      { response: jsonResponse(release()), assert: (url, options) => {
        assert.equal(url, `${API_BASE}/repos/${REPO}/releases/${RELEASE_ID}`);
        assert.equal(options.method ?? 'GET', 'GET');
      } },
    ]);
    const result = await commonCreate(fetchImpl);
    assert.equal(result.action, 'RECONCILED');
    assert.equal(result.releaseId, RELEASE_ID);
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'POST').length, 1);
  });

  test('never substitutes a tag-matching release after create returns a candidate id', async () => {
    const requests = [];
    let preflightComplete = false;
    const fetchImpl = async (url, options = {}) => {
      const request = { url: String(url), options };
      requests.push(request);
      if (options.method === 'POST') return jsonResponse({ id: RELEASE_ID }, 201);
      if (request.url === `${API_BASE}/repos/${REPO}/releases/${RELEASE_ID}`) {
        return jsonResponse({ message: 'not found' }, 404);
      }
      if (request.url.includes('/releases?')) {
        if (!preflightComplete) {
          preflightComplete = true;
          return jsonResponse([]);
        }
        return jsonResponse([release({ id: RELEASE_ID + 1 })]);
      }
      throw new Error(`unexpected request ${options.method ?? 'GET'} ${url}`);
    };

    await assert.rejects(
      commonCreate(fetchImpl),
      (error) => error instanceof GitHubReleaseMutationError
        && error.code === 'CREATE_AMBIGUOUS_UNRESOLVED',
    );
    assert.equal(requests.filter(({ options }) => options.method === 'POST').length, 1);
    assert.equal(requests.filter(({ url }) => url.includes('/releases?')).length, 1);
    assert.equal(
      requests.filter(({ url }) => url === `${API_BASE}/repos/${REPO}/releases/${RELEASE_ID}`).length,
      4,
    );
  });

  test('waits for the exact create candidate id to become visible', async () => {
    const delays = [];
    const fetchImpl = queuedFetch([
      { response: jsonResponse([]) },
      { response: jsonResponse({ id: RELEASE_ID }, 201) },
      { response: jsonResponse({ message: 'not found' }, 404) },
      { response: jsonResponse(release()), assert: (url, options) => {
        assert.equal(url, `${API_BASE}/repos/${REPO}/releases/${RELEASE_ID}`);
        assert.equal(options.method ?? 'GET', 'GET');
      } },
    ]);

    const result = await commonCreate(fetchImpl, {
      sleep: async (delay) => delays.push(delay),
    });
    assert.equal(result.action, 'RECONCILED');
    assert.equal(result.releaseId, RELEASE_ID);
    assert.deepEqual(delays, [1_000]);
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'POST').length, 1);
    assert.equal(fetchImpl.remaining(), 0);
  });

  test('does not trust an unexpected successful POST status without reconciliation', async () => {
    const fetchImpl = queuedFetch([
      { response: jsonResponse([]) },
      { response: jsonResponse(release(), 200) },
      { response: jsonResponse([release()]) },
    ]);
    const result = await commonCreate(fetchImpl);
    assert.equal(result.action, 'RECONCILED');
    assert.equal(result.releaseId, RELEASE_ID);
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'POST').length, 1);
  });

  test('reconciles a lost POST response through tag and marker visibility', async () => {
    const fetchImpl = queuedFetch([
      { response: jsonResponse([]) },
      { error: new Error('socket closed') },
      { response: jsonResponse([release()]) },
    ]);
    const result = await commonCreate(fetchImpl);
    assert.equal(result.action, 'RECONCILED');
    assert.equal(result.releaseId, RELEASE_ID);
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'POST').length, 1);
  });

  test('fails closed after bounded POST visibility reconciliation remains absent', async () => {
    const fetchImpl = queuedFetch([
      { response: jsonResponse([]) },
      { error: new Error('socket closed') },
      { response: jsonResponse([]) },
      { response: jsonResponse([]) },
      { response: jsonResponse([]) },
      { response: jsonResponse([]) },
    ]);
    await assert.rejects(
      commonCreate(fetchImpl),
      (error) => error instanceof GitHubReleaseMutationError
        && error.code === 'CREATE_AMBIGUOUS_UNRESOLVED',
    );
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'POST').length, 1);
  });

  test('publishes an owned draft through the release-id PATCH endpoint', async () => {
    const fetchImpl = queuedFetch([
      { response: jsonResponse(release()) },
      { response: jsonResponse(release({ draft: false })), assert: (url, options) => {
        assert.equal(url, `${API_BASE}/repos/${REPO}/releases/${RELEASE_ID}`);
        assert.equal(options.method, 'PATCH');
        assert.deepEqual(JSON.parse(options.body), { draft: false });
      } },
    ]);
    const result = await commonPublish(fetchImpl);
    assert.equal(result.action, 'PUBLISHED');
    assert.equal(result.state, 'published');
    assert.equal(result.releaseId, RELEASE_ID);
  });

  test('refuses a foreign marker before publishing and never issues PATCH', async () => {
    const fetchImpl = queuedFetch([{ response: jsonResponse(release({ body: 'foreign release' })) }]);
    await assert.rejects(
      commonPublish(fetchImpl),
      (error) => error instanceof GitHubReleaseMutationError
        && error.code === 'RELEASE_OWNERSHIP_MISMATCH',
    );
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'PATCH').length, 0);
  });

  test('refuses a wrong immutable release id before publishing and never issues PATCH', async () => {
    const fetchImpl = queuedFetch([{ response: jsonResponse(release({ id: RELEASE_ID + 1 })) }]);
    await assert.rejects(
      commonPublish(fetchImpl),
      (error) => error instanceof GitHubReleaseMutationError
        && error.code === 'RELEASE_ID_MISMATCH',
    );
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'PATCH').length, 0);
  });

  test('converges after an ambiguous PATCH when the release is already published', async () => {
    const fetchImpl = queuedFetch([
      { response: jsonResponse(release()) },
      { error: new Error('connection reset') },
      { response: jsonResponse(release({ draft: false })) },
    ]);
    const result = await commonPublish(fetchImpl);
    assert.equal(result.action, 'RECONCILED');
    assert.equal(result.state, 'published');
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'PATCH').length, 1);
  });

  test('fails closed without another PATCH when ambiguous publication cannot be reconciled', async () => {
    const requests = [];
    let preflightComplete = false;
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (options.method === 'PATCH') throw new Error('connection reset');
      if (!preflightComplete) {
        preflightComplete = true;
        return jsonResponse(release());
      }
      return jsonResponse({ message: 'temporarily unavailable' }, 503);
    };

    await assert.rejects(
      commonPublish(fetchImpl),
      (error) => error instanceof GitHubReleaseMutationError
        && error.code === 'PUBLISH_AMBIGUOUS_UNRESOLVED',
    );
    assert.equal(requests.filter(({ options }) => options.method === 'PATCH').length, 1);
  });

  test('retries a malformed PATCH response only after release-id reconciliation proves it is still draft', async () => {
    const delays = [];
    const fetchImpl = queuedFetch([
      { response: jsonResponse(release()) },
      { response: jsonResponse({ id: RELEASE_ID }, 200) },
      { response: jsonResponse(release()) },
      { response: jsonResponse(release({ draft: false }), 200) },
    ]);
    const result = await commonPublish(fetchImpl, { sleep: async (delay) => delays.push(delay) });
    assert.equal(result.action, 'PUBLISHED');
    assert.equal(result.state, 'published');
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'PATCH').length, 2);
    assert.deepEqual(delays, [1_000]);
  });

  test('fails closed when the provider rate-limit window exceeds the adapter bound', async () => {
    const fetchImpl = queuedFetch([
      { response: jsonResponse([]) },
      { response: new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '120', 'content-length': '26' },
      }) },
    ]);
    await assert.rejects(
      commonCreate(fetchImpl),
      (error) => error?.code === 'GITHUB_RATE_LIMIT_BUDGET_EXCEEDED',
    );
    assert.equal(fetchImpl.requests.filter(({ options }) => options.method === 'POST').length, 1);
  });
});
