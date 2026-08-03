import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openClawSessionObserverStream,
  parseOpenClawSessionObserverDigest,
  publishOpenClawSessionObserverEvent,
} from './sessionObserverEventBridge';

const digest = {
  sessionKey: 'agent:main:main',
  agentId: 'main',
  runId: 'run-1',
  revision: 2,
  updatedAt: 1_700_000_000_000,
  headline: 'Inspecting current implementation.',
  health: 'on-track',
};

test('parses only the display-safe portion of the official observer digest', () => {
  assert.deepEqual(parseOpenClawSessionObserverDigest({
    ...digest,
    assessment: 'Detailed assessment is intentionally not projected.',
    planProgress: { completed: 1, total: 3 },
  }), digest);
  assert.equal(parseOpenClawSessionObserverDigest({ ...digest, health: 'legacy' }), null);
  assert.equal(parseOpenClawSessionObserverDigest({ ...digest, headline: '' }), null);
});

test('keeps only the newest observer event for one session and agent identity', () => {
  openClawSessionObserverStream.clear();
  publishOpenClawSessionObserverEvent({ type: 'event', event: 'session.observer', payload: digest });
  publishOpenClawSessionObserverEvent({
    type: 'event',
    event: 'session.observer',
    payload: { ...digest, revision: 1, updatedAt: digest.updatedAt + 1, headline: 'Stale update.' },
  });
  assert.deepEqual(openClawSessionObserverStream.getSnapshot(), [digest]);
  openClawSessionObserverStream.clear();
});

test('reserves malformed observer events without forwarding them as generic Gateway state', () => {
  assert.equal(publishOpenClawSessionObserverEvent({
    type: 'event', event: 'session.observer', payload: { sessionKey: 'agent:main:main' },
  }), true);
  assert.equal(publishOpenClawSessionObserverEvent({ type: 'event', event: 'session.message', payload: {} }), false);
});
