import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimProviderSession,
  providerResumeFingerprint,
  releaseProviderClaim,
  updateProviderClaimStatus,
  type ProviderClaimRequest,
  type ProviderClaimState,
} from './providerSession';

const empty = (): ProviderClaimState => ({ byPane: {} });
const request = (patch: Partial<ProviderClaimRequest> = {}): ProviderClaimRequest => ({
  claimId: 'claim-1', worktreeId: 'worktree-1', paneId: 'pane-1',
  ptyId: 'pty-1', ptyRunId: 'run-1', providerId: 'claude',
  providerSessionId: null, transcriptPath: null, ...patch,
});

test('claim is idempotent only for the complete pane PTY provider identity', () => {
  const first = claimProviderSession(empty(), request());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const repeated = claimProviderSession(first.state, request());
  assert.equal(repeated.ok && repeated.idempotent, true);
  assert.equal(claimProviderSession(first.state, request({ claimId: 'other' })).ok, false);
});

test('replacement requires the exact current claim and increments generation', () => {
  const first = claimProviderSession(empty(), request());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const stale = claimProviderSession(first.state, request({ claimId: 'claim-2', expectedClaimId: 'stale' }));
  assert.deepEqual(stale, { ok: false, state: first.state, reason: 'stale-replacement' });
  const next = claimProviderSession(first.state, request({ claimId: 'claim-2', expectedClaimId: 'claim-1', ptyId: 'pty-2', ptyRunId: 'run-2' }));
  assert.equal(next.ok, true);
  if (next.ok) assert.equal(next.claim.generation, 2);
});

test('PTY and resume identities cannot be claimed by another pane', () => {
  const resumable = request({ providerSessionId: 'session-1', transcriptPath: '/repo/session.jsonl' });
  const first = claimProviderSession(empty(), resumable);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(claimProviderSession(first.state, request({ paneId: 'pane-2', claimId: 'claim-2' })).ok, false);
  const resumeCollision = claimProviderSession(first.state, {
    ...resumable, paneId: 'pane-2', claimId: 'claim-2', ptyId: 'pty-2', ptyRunId: 'run-2',
  });
  assert.deepEqual(resumeCollision, { ok: false, state: first.state, reason: 'resume-owned' });
});

test('resume fingerprint includes worktree provider session and transcript', () => {
  const base = request({ providerSessionId: 'session', transcriptPath: '/one' });
  assert.notEqual(providerResumeFingerprint(base), providerResumeFingerprint({ ...base, worktreeId: 'other' }));
  assert.notEqual(providerResumeFingerprint(base), providerResumeFingerprint({ ...base, providerId: 'codex' }));
  assert.notEqual(providerResumeFingerprint(base), providerResumeFingerprint({ ...base, transcriptPath: '/two' }));
});

test('late status and release results cannot mutate a replacement claim', () => {
  const first = claimProviderSession(empty(), request());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const next = claimProviderSession(first.state, request({ claimId: 'claim-2', expectedClaimId: 'claim-1', ptyId: 'pty-2', ptyRunId: 'run-2' }));
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(updateProviderClaimStatus(next.state, 'pane-1', 'claim-1', 1, 'running'), next.state);
  assert.equal(releaseProviderClaim(next.state, 'pane-1', 'claim-1', 1), next.state);
  assert.equal(updateProviderClaimStatus(next.state, 'pane-1', 'claim-2', 2, 'running').byPane['pane-1']?.status, 'running');
});
