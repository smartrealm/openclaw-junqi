import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  GitHubTagTargetError,
  validateTagTarget,
} from './verify-github-tag-target.mjs';

const SOURCE = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

function refResponse(object, ref = 'refs/tags/v1.2.3') {
  return { ref, object };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof GitHubTagTargetError && error.code === code);
}

describe('GitHub tag target policy', () => {
  test('accepts a lightweight tag pointing at the source commit', () => {
    assert.deepEqual(
      validateTagTarget({
        tag: 'v1.2.3',
        expectedSha: SOURCE,
        refResponse: refResponse({ type: 'commit', sha: SOURCE }),
      }),
      { tag: 'v1.2.3', ref: 'refs/tags/v1.2.3', targetSha: SOURCE },
    );
  });

  test('dereferences annotated tags before comparing the commit', () => {
    const tagObjectSha = 'c'.repeat(40);
    assert.equal(
      validateTagTarget({
        tag: 'v1.2.3',
        expectedSha: SOURCE,
        refResponse: refResponse({ type: 'tag', sha: tagObjectSha }),
        tagObjectsBySha: { [tagObjectSha]: { object: { type: 'commit', sha: SOURCE } } },
      }).targetSha,
      SOURCE,
    );
  });

  test('rejects ref, target, malformed, and cyclic tag data', () => {
    expectCode(
      () => validateTagTarget({
        tag: 'v1.2.3', expectedSha: SOURCE,
        refResponse: refResponse({ type: 'commit', sha: SOURCE }, 'refs/tags/v9.9.9'),
      }),
      'TAG_REF_MISMATCH',
    );
    expectCode(
      () => validateTagTarget({
        tag: 'v1.2.3', expectedSha: SOURCE,
        refResponse: refResponse({ type: 'commit', sha: OTHER }),
      }),
      'TAG_TARGET_MISMATCH',
    );
    const cycle = 'd'.repeat(40);
    expectCode(
      () => validateTagTarget({
        tag: 'v1.2.3', expectedSha: SOURCE,
        refResponse: refResponse({ type: 'tag', sha: cycle }),
        tagObjectsBySha: { [cycle]: { object: { type: 'tag', sha: cycle } } },
      }),
      'TAG_CYCLE',
    );
    expectCode(
      () => validateTagTarget({
        tag: 'release', expectedSha: SOURCE,
        refResponse: refResponse({ type: 'commit', sha: SOURCE }),
      }),
      'INVALID_TAG',
    );
  });
});
