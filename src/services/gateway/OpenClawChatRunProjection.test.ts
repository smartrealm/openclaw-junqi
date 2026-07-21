import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawChatRunProjection } from './OpenClawChatRunProjection';

const SESSION = 'agent:main:desktop-run-test';

test('deduplicates OpenClaw run events and requests one history repair for a forward gap', () => {
  const projection = new OpenClawChatRunProjection();

  assert.deepEqual(projection.acceptEvent('chat', 'run-1', 0), {
    accepted: true,
    requiresHistoryRefresh: false,
  });
  assert.deepEqual(projection.acceptEvent('chat', 'run-1', 0), {
    accepted: false,
    requiresHistoryRefresh: false,
  });
  assert.deepEqual(projection.acceptEvent('chat', 'run-1', 2), {
    accepted: true,
    requiresHistoryRefresh: true,
  });
  assert.deepEqual(projection.acceptEvent('chat', 'run-1', 4), {
    accepted: true,
    requiresHistoryRefresh: false,
  });
  assert.deepEqual(projection.acceptEvent('agent', 'run-1', 0), {
    accepted: true,
    requiresHistoryRefresh: false,
  });
});

test('never lets an old terminal event claim a newer session run', () => {
  const projection = new OpenClawChatRunProjection();
  const first = projection.begin(SESSION, 'run-old');
  assert.ok(first);
  const second = projection.begin(SESSION, 'run-new');
  assert.ok(second);

  assert.equal(projection.claimTerminal(SESSION, 'run-old'), null);
  const terminal = projection.claimTerminal(SESSION, 'run-new');
  assert.ok(terminal);
  assert.equal(projection.complete(terminal), true);
  assert.equal(projection.claimTerminal(SESSION, 'run-new'), null);
});

test('invalidated sessions reject delayed Gateway terminals', () => {
  const projection = new OpenClawChatRunProjection();
  assert.ok(projection.begin(SESSION, 'run-reset'));

  projection.invalidate(SESSION);

  assert.equal(projection.claimTerminal(SESSION, 'run-reset'), null);
});

test('adopts the OpenClaw active-run snapshot after reconnect and settles only explicit false', () => {
  const projection = new OpenClawChatRunProjection();
  assert.ok(projection.begin(SESSION, 'run-before-disconnect'));

  const active = projection.reconcileSessionSnapshots([
    { key: SESSION, hasActiveRun: true, activeRunIds: ['run-from-gateway'] },
  ], [SESSION]);
  assert.deepEqual(active, [{
    sessionKey: SESSION,
    state: 'active',
    activeRunIds: ['run-from-gateway'],
    activeRunId: 'run-from-gateway',
    replacedRunId: 'run-before-disconnect',
  }]);
  assert.equal(projection.active(SESSION)?.runId, 'run-from-gateway');

  const settled = projection.reconcileSessionSnapshots([
    { key: SESSION, hasActiveRun: false },
  ], [SESSION]);
  assert.deepEqual(settled, [{
    sessionKey: SESSION,
    state: 'settled',
    activeRunIds: [],
  }]);
  assert.equal(projection.active(SESSION), null);
  assert.equal(projection.claimTerminal(SESSION, 'run-from-gateway'), null);
});

test('does not keep a stale local run when OpenClaw reports activity without run identities', () => {
  const projection = new OpenClawChatRunProjection();
  assert.ok(projection.begin(SESSION, 'run-local'));

  const result = projection.reconcileSessionSnapshots([
    { key: SESSION, hasActiveRun: true },
  ], [SESSION]);

  assert.deepEqual(result, [{
    sessionKey: SESSION,
    state: 'active',
    activeRunIds: [],
    replacedRunId: 'run-local',
  }]);
  assert.equal(projection.active(SESSION), null);
  assert.equal(projection.claimTerminal(SESSION, 'run-local'), null);
});

test('projects an active OpenClaw session that was not started by this renderer', () => {
  const projection = new OpenClawChatRunProjection();
  const externalSession = 'agent:main:external-run';

  const result = projection.reconcileSessionSnapshots([
    { key: externalSession, hasActiveRun: true, activeRunIds: ['run-external'] },
  ], []);

  assert.deepEqual(result, [{
    sessionKey: externalSession,
    state: 'active',
    activeRunIds: ['run-external'],
    activeRunId: 'run-external',
  }]);
  assert.equal(projection.active(externalSession)?.runId, 'run-external');
});

test('normalizes Gateway run identities before they enter the projection', () => {
  const projection = new OpenClawChatRunProjection();

  const result = projection.reconcileSessionSnapshots([
    { key: SESSION, hasActiveRun: true, activeRunIds: ['  run-normalized  ', '', null] },
  ], []);

  assert.equal(result[0]?.activeRunId, 'run-normalized');
  assert.equal(projection.active(SESSION)?.runId, 'run-normalized');
});

test('ordinary session refreshes never replace a newer local run with a stale snapshot', () => {
  const projection = new OpenClawChatRunProjection();
  assert.ok(projection.begin(SESSION, 'run-newer-local'));

  const result = projection.observeActiveSessionSnapshots([
    { key: SESSION, hasActiveRun: true, activeRunIds: ['run-older-snapshot'] },
  ]);

  assert.deepEqual(result, [{
    sessionKey: SESSION,
    state: 'active',
    activeRunIds: ['run-older-snapshot'],
    activeRunId: 'run-newer-local',
  }]);
  assert.equal(projection.active(SESSION)?.runId, 'run-newer-local');
});

test('deduplicates durable transcript updates by OpenClaw message sequence', () => {
  const projection = new OpenClawChatRunProjection();

  assert.equal(projection.acceptTranscriptUpdate(SESSION, 11), true);
  assert.equal(projection.acceptTranscriptUpdate(SESSION, 11), false);
  assert.equal(projection.acceptTranscriptUpdate(SESSION, 10), false);
  assert.equal(projection.acceptTranscriptUpdate(SESSION, 12), true);
});
