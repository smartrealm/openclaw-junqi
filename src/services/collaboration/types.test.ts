import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLABORATION_ERROR_CODES,
  collaborationSessionIdentityKey,
  hasUnresolvedResidualExecutionRisk,
  isTerminalCollaborationRun,
  parseCollaborationChangedHint,
} from './types';
import type { CollaborationRunSnapshot } from './types';
import { COLLABORATION_ERROR_CODES as PLUGIN_ERROR_CODES } from '../../../packages/junqi-collab/src/errors';

test('Desktop recognizes every stable collaboration plugin error code', () => {
  const desktopCodes = new Set<string>(COLLABORATION_ERROR_CODES);
  assert.equal(desktopCodes.size, COLLABORATION_ERROR_CODES.length);
  assert.equal(new Set<string>(PLUGIN_ERROR_CODES).size, PLUGIN_ERROR_CODES.length);
  assert.deepEqual(
    PLUGIN_ERROR_CODES.filter((code) => !desktopCodes.has(code)),
    [],
  );
});

test('session identity includes instance, key, and native session id without delimiter collisions', () => {
  const first = collaborationSessionIdentityKey('instance:a', {
    sessionKey: 'agent:main:desktop',
    sessionId: 'session:1',
  });
  const second = collaborationSessionIdentityKey('instance', {
    sessionKey: 'a:agent:main:desktop',
    sessionId: 'session:1',
  });
  const reset = collaborationSessionIdentityKey('instance:a', {
    sessionKey: 'agent:main:desktop',
    sessionId: 'session:2',
  });

  assert.notEqual(first, second);
  assert.notEqual(first, reset);
  assert.deepEqual(JSON.parse(first), ['instance:a', 'agent:main:desktop', 'session:1']);
});

test('only durable run terminal states stop active polling', () => {
  assert.equal(isTerminalCollaborationRun('COMPLETED'), true);
  assert.equal(isTerminalCollaborationRun('CANCELLED'), true);
  assert.equal(isTerminalCollaborationRun('FAILED'), true);
  assert.equal(isTerminalCollaborationRun('DELIVERY_PENDING'), false);
  assert.equal(isTerminalCollaborationRun('AWAITING_INTERVENTION'), false);
});

test('residual execution risk requires a cancelled run and one unresolved matching intervention', () => {
  const run = {
    status: 'CANCELLED',
    interventions: [{
      id: 'residual-risk-1',
      code: 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK',
      entityRef: { type: 'attempt', id: 'attempt-1' },
      requiredAction: 'Verify the OpenClaw Task termination independently.',
      diagnostics: {},
      resumeStatus: 'CANCELLING',
      createdAt: 100,
      resolvedAt: null,
    }],
  } satisfies Pick<CollaborationRunSnapshot, 'status' | 'interventions'>;

  assert.equal(hasUnresolvedResidualExecutionRisk(run), true);
  assert.equal(hasUnresolvedResidualExecutionRisk({
    ...run,
    interventions: [{ ...run.interventions[0], resolvedAt: 200 }],
  }), false);
  assert.equal(hasUnresolvedResidualExecutionRisk({
    ...run,
    interventions: [{ ...run.interventions[0], code: 'ATTEMPT_CANCELLED' }],
  }), false);
  assert.equal(hasUnresolvedResidualExecutionRisk({ ...run, status: 'COMPLETED' }), false);
});

test('changed hint parser accepts only complete transport-safe watermarks', () => {
  const valid = {
    collaborationInstanceId: 'instance-a',
    runId: 'run-1',
    runRevision: 2,
    lastSequence: 4,
  };
  assert.deepEqual(parseCollaborationChangedHint(valid), valid);
  assert.equal(parseCollaborationChangedHint({ ...valid, runRevision: 2.5 }), null);
  assert.equal(parseCollaborationChangedHint({ ...valid, lastSequence: -1 }), null);
  assert.equal(parseCollaborationChangedHint({ ...valid, runId: [] }), null);
  assert.equal(parseCollaborationChangedHint({ ...valid, collaborationInstanceId: '   ' }), null);
});
