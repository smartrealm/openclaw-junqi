import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOpenClawSessionMutationOutcome } from './OpenClawSessionMutationOutcome';

test('delete is committed when the described old identity is missing or replaced', () => {
  assert.deepEqual(
    resolveOpenClawSessionMutationOutcome('delete', 'old-id', { session: null }),
    { state: 'committed', nextSessionId: null },
  );
  assert.deepEqual(
    resolveOpenClawSessionMutationOutcome('delete', 'old-id', { session: { sessionId: 'new-id' } }),
    { state: 'committed', nextSessionId: 'new-id' },
  );
});

test('reset is committed only when OpenClaw advertises a replacement identity', () => {
  assert.deepEqual(
    resolveOpenClawSessionMutationOutcome('reset', 'old-id', { session: { sessionId: 'new-id' } }),
    { state: 'committed', nextSessionId: 'new-id' },
  );
  assert.deepEqual(
    resolveOpenClawSessionMutationOutcome('reset', 'old-id', { session: null }),
    { state: 'unknown' },
  );
});

test('the unchanged identity proves that the mutation did not commit', () => {
  assert.deepEqual(
    resolveOpenClawSessionMutationOutcome('reset', 'old-id', { session: { sessionId: 'old-id' } }),
    { state: 'not-committed' },
  );
  assert.deepEqual(
    resolveOpenClawSessionMutationOutcome('delete', 'old-id', { session: { sessionId: 'old-id' } }),
    { state: 'not-committed' },
  );
});

test('malformed descriptions fail closed', () => {
  assert.deepEqual(resolveOpenClawSessionMutationOutcome('delete', 'old-id', {}), { state: 'unknown' });
  assert.deepEqual(
    resolveOpenClawSessionMutationOutcome('reset', 'old-id', { session: { key: 'same-key' } }),
    { state: 'unknown' },
  );
});
