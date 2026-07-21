import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  githubApiHeaders,
  GitHubApiBaseError,
  normalizeGitHubApiBase,
} from './github-api-base.mjs';

describe('GitHub API base value object', () => {
  test('normalizes GitHub.com and GHES API bases', () => {
    assert.equal(normalizeGitHubApiBase('https://api.github.com/'), 'https://api.github.com');
    assert.equal(
      normalizeGitHubApiBase('https://github.example.test/api/v3/'),
      'https://github.example.test/api/v3',
    );
  });

  test('rejects token-leaking or ambiguous API bases', () => {
    for (const value of [
      'http://api.github.com',
      'https://token@api.github.com',
      'https://api.github.com?target=other',
      'https://api.github.com/#fragment',
      'not-a-url',
    ]) {
      assert.throws(
        () => normalizeGitHubApiBase(value),
        (error) => error instanceof GitHubApiBaseError && error.code === 'INVALID_API_BASE',
      );
    }
  });

  test('provides one versioned, identifiable authentication header policy', () => {
    assert.deepEqual(githubApiHeaders('token'), {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer token',
      'user-agent': 'junqi-release-transaction/1',
      'x-github-api-version': '2022-11-28',
    });
    for (const invalidToken of ['token\nleak', ' token', 'token ', `token${String.fromCharCode(0)}`]) {
      assert.throws(() => githubApiHeaders(invalidToken), TypeError);
    }
  });
});
