import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  GitHubReleaseInspectionError,
  inspectGitHubRelease,
  interpretReleaseListPage,
} from './inspect-github-release.mjs';

function expectCode(code) {
  return (error) => error instanceof GitHubReleaseInspectionError && error.code === code;
}

describe('GitHub release transaction preflight', () => {
  test('discovers an authenticated draft by exact tag and immutable id', () => {
    assert.deepEqual(interpretReleaseListPage({
      status: 200,
      tag: 'v1.2.3',
      body: [{ id: 17, draft: true, tag_name: 'v1.2.3', body: 'notes' }],
    }), {
      status: 'PRESENT',
      tag: 'v1.2.3',
      release: { id: 17, draft: true, body: 'notes' },
    });
    assert.deepEqual(interpretReleaseListPage({ status: 200, tag: 'v1.2.3', body: [] }), {
      status: 'NOT_FOUND_ON_PAGE',
      exhausted: true,
    });
  });

  test('fails closed on API failures and malformed release identities', () => {
    assert.throws(() => interpretReleaseListPage({ status: 404, body: {}, tag: 'v1.2.3' }), expectCode('GITHUB_API_FAILED'));
    assert.throws(
      () => interpretReleaseListPage({ status: 200, tag: 'v1.2.3', body: [{ id: 17, draft: true, tag_name: 'v1.2.3' }] }),
      expectCode('INVALID_RELEASE'),
    );
    assert.throws(
      () => interpretReleaseListPage({
        status: 200,
        tag: 'v1.2.3',
        body: [
          { id: 17, draft: true, tag_name: 'v1.2.3', body: 'first' },
          { id: 18, draft: true, tag_name: 'v1.2.3', body: 'second' },
        ],
      }),
      expectCode('DUPLICATE_RELEASE'),
    );
  });

  test('uses the authenticated list endpoint because tag lookup excludes drafts', async () => {
    const requests = [];
    const result = await inspectGitHubRelease({
      apiBase: 'https://api.example.test/',
      repo: 'owner/repo',
      tag: 'v1.2.3',
      token: 'token',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return new Response('[]', { status: 200 });
      },
    });
    assert.equal(result.status, 'ABSENT');
    assert.equal(requests[0].url, 'https://api.example.test/repos/owner/repo/releases?per_page=100&page=1');
    assert.equal(requests[0].options.headers.authorization, 'Bearer token');
  });

  test('finds a draft on a bounded later page', async () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        draft: false,
        tag_name: `v0.0.${index}`,
        body: '',
      })),
      [{ id: 1001, draft: true, tag_name: 'v1.2.3', body: 'owned draft' }],
    ];
    const result = await inspectGitHubRelease({
      apiBase: 'https://api.example.test',
      repo: 'owner/repo',
      tag: 'v1.2.3',
      token: 'token',
      fetchImpl: async () => new Response(JSON.stringify(pages.shift()), { status: 200 }),
    });
    assert.deepEqual(result.release, { id: 1001, draft: true, body: 'owned draft' });
  });

  test('waits for a newly created draft within a bounded consistency window', async () => {
    const pages = [
      [],
      [{ id: 77, draft: true, tag_name: 'v1.2.3', body: 'owned draft' }],
    ];
    const delays = [];
    const result = await inspectGitHubRelease({
      apiBase: 'https://api.example.test',
      repo: 'owner/repo',
      tag: 'v1.2.3',
      token: 'token',
      waitForPresent: true,
      sleep: async (delay) => delays.push(delay),
      fetchImpl: async () => new Response(JSON.stringify(pages.shift()), { status: 200 }),
    });
    assert.equal(result.release.id, 77);
    assert.deepEqual(delays, [1_000]);
  });
});
