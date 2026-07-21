import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  RELEASE_SOURCE_KINDS,
  ReleaseSourcePolicyError,
  evaluateReleaseSource,
} from './release-source-policy.mjs';

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function context(overrides = {}) {
  return {
    eventName: 'push',
    eventRef: 'refs/heads/main',
    eventRefName: 'main',
    eventSha: SHA_A,
    sourceSha: SHA_A,
    dispatchRef: '',
    ...overrides,
  };
}

function expectPolicyError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ReleaseSourcePolicyError);
    assert.equal(error.code, code);
    return true;
  });
}

describe('release source policy', () => {
  test('accepts a main push as an unsigned candidate', () => {
    assert.deepEqual(evaluateReleaseSource(context()), {
      sourceSha: SHA_A,
      releaseRef: 'refs/heads/main',
      releaseTag: '',
      sourceKind: RELEASE_SOURCE_KINDS.CANDIDATE_MAIN_PUSH,
      signingEnabled: false,
    });
  });

  test('accepts dispatch only when the workflow itself runs from main', () => {
    const decision = evaluateReleaseSource(context({
      eventName: 'workflow_dispatch',
      eventRef: 'refs/heads/main',
      eventRefName: 'main',
      dispatchRef: 'main',
    }));
    assert.equal(decision.sourceKind, RELEASE_SOURCE_KINDS.CANDIDATE_MAIN_DISPATCH);
    assert.equal(decision.signingEnabled, false);
  });

  test('accepts a main push even though it is not a signed release', () => {
    const decision = evaluateReleaseSource(context({
      eventName: 'push',
      eventRef: 'refs/heads/main',
      eventRefName: 'main',
    }));
    assert.equal(decision.sourceKind, RELEASE_SOURCE_KINDS.CANDIDATE_MAIN_PUSH);
    assert.equal(decision.signingEnabled, false);
  });

  test('rejects a dispatch selected from an untrusted branch', () => {
    expectPolicyError(() => evaluateReleaseSource(context({
      eventName: 'workflow_dispatch',
      eventRef: 'refs/heads/feature',
      eventRefName: 'feature',
      dispatchRef: 'main',
    })), 'UNSUPPORTED_RELEASE_EVENT');
  });

  test('rejects tag-owned workflow code until trusted promotion exists', () => {
    const tag = context({
      eventRef: 'refs/tags/v1.2.3',
      eventRefName: 'v1.2.3',
    });
    expectPolicyError(() => evaluateReleaseSource(tag), 'TRUSTED_PROMOTION_REQUIRED');
  });

  test('rejects a source SHA that differs from the event SHA', () => {
    expectPolicyError(() => evaluateReleaseSource(context({ sourceSha: SHA_B })), 'SOURCE_IDENTITY_MISMATCH');
  });

  test('rejects malformed and non-version tag refs', () => {
    expectPolicyError(() => evaluateReleaseSource(context({ eventSha: 'not-a-sha' })), 'INVALID_COMMIT_SHA');
    expectPolicyError(() => evaluateReleaseSource(context({
      eventRef: 'refs/tags/release-1.2.3',
      eventRefName: 'release-1.2.3',
    })), 'UNSUPPORTED_RELEASE_EVENT');
  });
});
