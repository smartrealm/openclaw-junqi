import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyOpenClawChatAbortAcknowledgement,
  classifyOpenClawChatSendAcknowledgement,
  OpenClawChatRunProjection,
  parseOpenClawInFlightRunSnapshot,
  parseOpenClawSessionListSnapshot,
} from './OpenClawChatRunProjection';

const SESSION = 'agent:main:desktop-run-test';

test('classifies all OpenClaw chat.send acknowledgement states without trusting another run', () => {
  assert.deepEqual(
    classifyOpenClawChatSendAcknowledgement({ runId: 'run-1', status: 'started' }, 'run-1'),
    { state: 'active', runId: 'run-1' },
  );
  assert.deepEqual(
    classifyOpenClawChatSendAcknowledgement({ runId: 'run-1', status: 'in_flight' }, 'run-1'),
    { state: 'active', runId: 'run-1' },
  );
  assert.deepEqual(
    classifyOpenClawChatSendAcknowledgement({ runId: 'run-1', status: 'ok' }, 'run-1'),
    { state: 'settled', runId: 'run-1' },
  );
  assert.deepEqual(
    classifyOpenClawChatSendAcknowledgement({ runId: 'run-1', status: 'timeout' }, 'run-1'),
    { state: 'settled', runId: 'run-1' },
  );
  assert.deepEqual(
    classifyOpenClawChatSendAcknowledgement({ runId: 'another-run', status: 'started' }, 'run-1'),
    { state: 'unknown' },
  );
});

test('classifies chat.abort only from the official confirmation fields', () => {
  assert.deepEqual(
    classifyOpenClawChatAbortAcknowledgement({ ok: true, aborted: true, runIds: [' run-a ', 'run-a'] }),
    { state: 'aborted', runIds: ['run-a'] },
  );
  assert.deepEqual(
    classifyOpenClawChatAbortAcknowledgement({ ok: true, aborted: false, runIds: [] }),
    { state: 'not_aborted', runIds: [] },
  );
  assert.deepEqual(
    classifyOpenClawChatAbortAcknowledgement({ ok: true, aborted: true }),
    { state: 'unknown', runIds: [] },
  );
});

test('parses the documented chat.history in-flight recovery snapshot', () => {
  assert.deepEqual(
    parseOpenClawInFlightRunSnapshot({
      inFlightRun: { runId: ' run-live ', text: 'Buffered answer.', plan: { entries: [] } },
    }),
    { runId: 'run-live', text: 'Buffered answer.', plan: { entries: [] } },
  );
  assert.equal(parseOpenClawInFlightRunSnapshot({ inFlightRun: { runId: 'run-live' } }), null);
});

test('preserves sessions.list pagination evidence before missing sessions are settled', () => {
  assert.deepEqual(
    parseOpenClawSessionListSnapshot({ sessions: [{ key: SESSION }], hasMore: false }),
    { sessions: [{ key: SESSION }], complete: true },
  );
  assert.deepEqual(
    parseOpenClawSessionListSnapshot({ sessions: [{ key: SESSION }], hasMore: true }),
    { sessions: [{ key: SESSION }], complete: false },
  );
  assert.equal(parseOpenClawSessionListSnapshot({
    sessions: [{ key: SESSION }],
    offset: 4,
    totalCount: 5,
  }).complete, true);
  assert.equal(parseOpenClawSessionListSnapshot({ sessions: [{ key: SESSION }] }).complete, false);
  assert.equal(parseOpenClawSessionListSnapshot({ hasMore: false }).complete, false);
});

test('deduplicates OpenClaw run events and repairs each agent sequence gap', () => {
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
    requiresHistoryRefresh: false,
  });
  assert.deepEqual(projection.acceptEvent('chat', 'run-1', 4), {
    accepted: true,
    requiresHistoryRefresh: false,
  });
  assert.deepEqual(projection.acceptEvent('agent', 'run-1', 0), {
    accepted: true,
    requiresHistoryRefresh: false,
  });
  assert.deepEqual(projection.acceptEvent('agent', 'run-1', 2), {
    accepted: true,
    requiresHistoryRefresh: true,
  });
  assert.deepEqual(projection.acceptEvent('agent', 'run-1', 4), {
    accepted: true,
    requiresHistoryRefresh: true,
  });
});

test('accepts one terminal chat event that reuses the final delta sequence', () => {
  const projection = new OpenClawChatRunProjection();

  assert.equal(projection.acceptEvent('chat', 'run-terminal', 7).accepted, true);
  assert.equal(projection.acceptEvent('chat', 'run-terminal', 7).accepted, false);
  assert.equal(projection.acceptEvent('chat', 'run-terminal', 7, { terminal: true }).accepted, true);
  assert.equal(projection.acceptEvent('chat', 'run-terminal', 7, { terminal: true }).accepted, false);
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

test('an ordinary refresh keeps a local lease when an active snapshot omits run identities', () => {
  const projection = new OpenClawChatRunProjection();
  assert.ok(projection.begin(SESSION, 'run-local'));

  const result = projection.observeActiveSessionSnapshots([
    { key: SESSION, hasActiveRun: true },
  ]);

  assert.deepEqual(result, [{
    sessionKey: SESSION,
    state: 'active',
    activeRunIds: [],
    activeRunId: 'run-local',
  }]);
  assert.equal(projection.active(SESSION)?.runId, 'run-local');
});

test('an authoritative snapshot without exact membership releases the retained local run', () => {
  const projection = new OpenClawChatRunProjection();
  assert.ok(projection.begin(SESSION, 'run-local-without-membership'));

  const result = projection.reconcileSessionSnapshots([
    { key: SESSION, hasActiveRun: true },
  ], [SESSION]);

  assert.deepEqual(result, [{
    sessionKey: SESSION,
    state: 'active',
    activeRunIds: [],
    replacedRunId: 'run-local-without-membership',
  }]);
  assert.equal(projection.active(SESSION), null);
  assert.equal(projection.hasActiveSession(SESSION), true);
  assert.equal(projection.claimTerminal(SESSION, 'run-local-without-membership'), null);
});

test('an authoritative list settles a retained run whose session no longer exists', () => {
  const projection = new OpenClawChatRunProjection();
  assert.ok(projection.begin(SESSION, 'run-deleted-externally'));

  const result = projection.reconcileSessionSnapshots([], [SESSION], { settleMissing: true });

  assert.deepEqual(result, [{ sessionKey: SESSION, state: 'settled', activeRunIds: [] }]);
  assert.equal(projection.hasActiveSession(SESSION), false);
  assert.equal(projection.claimTerminal(SESSION, 'run-deleted-externally'), null);
});

test('a partial session page leaves an unlisted run unresolved for targeted lookup', () => {
  const projection = new OpenClawChatRunProjection();
  assert.ok(projection.begin(SESSION, 'run-outside-current-page'));

  const result = projection.reconcileSessionSnapshots([], [SESSION]);
  const unresolved = projection.unresolvedSessionKeys([], [SESSION]);

  assert.deepEqual(result, []);
  assert.deepEqual(unresolved, [SESSION]);
  assert.equal(projection.active(SESSION)?.runId, 'run-outside-current-page');
});

test('an older Gateway row without run fields remains unknown instead of settling', () => {
  const projection = new OpenClawChatRunProjection();
  assert.ok(projection.begin(SESSION, 'run-on-older-gateway'));

  const result = projection.reconcileSessionSnapshots([{ key: SESSION }], [SESSION]);

  assert.deepEqual(result, []);
  assert.equal(projection.active(SESSION)?.runId, 'run-on-older-gateway');
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

test('an ordinary stale snapshot cannot resurrect a terminal OpenClaw run', () => {
  const projection = new OpenClawChatRunProjection();
  const started = projection.begin(SESSION, 'run-completed');
  assert.ok(started);
  assert.equal(projection.complete(started.lease), true);

  const result = projection.observeActiveSessionSnapshots([
    { key: SESSION, hasActiveRun: true, activeRunIds: ['run-completed'] },
  ]);

  assert.deepEqual(result, []);
  assert.equal(projection.active(SESSION), null);
});

test('chat.history inFlightRun can authoritatively revive the same run after reconnect', () => {
  const projection = new OpenClawChatRunProjection();
  const started = projection.begin(SESSION, 'run-recovered');
  assert.ok(started);
  const terminal = projection.claimTerminal(SESSION, 'run-recovered');
  assert.ok(terminal);
  assert.equal(projection.complete(terminal), true);

  const resolution = projection.adoptInFlightRun(SESSION, 'run-recovered');

  assert.equal(resolution.activeRunId, 'run-recovered');
  assert.equal(projection.active(SESSION)?.runId, 'run-recovered');
});

test('only authoritative reconciliation adopts anonymous active state after a terminal run', () => {
  const projection = new OpenClawChatRunProjection();
  const started = projection.begin(SESSION, 'run-completed-anonymous');
  assert.ok(started);
  assert.equal(projection.complete(started.lease), true);

  const observed = projection.observeActiveSessionSnapshots([
    { key: SESSION, hasActiveRun: true },
  ]);
  const reconciled = projection.reconcileSessionSnapshots([
    { key: SESSION, hasActiveRun: true },
  ], [SESSION]);

  assert.deepEqual(observed, []);
  assert.deepEqual(reconciled, [{
    sessionKey: SESSION,
    state: 'active',
    activeRunIds: [],
  }]);
  assert.equal(projection.active(SESSION), null);
  assert.equal(projection.hasActiveSession(SESSION), true);

  const settled = projection.reconcileSessionSnapshots([
    { key: SESSION, hasActiveRun: false },
  ], [SESSION]);
  assert.deepEqual(settled, [{ sessionKey: SESSION, state: 'settled', activeRunIds: [] }]);
  assert.equal(projection.hasActiveSession(SESSION), false);
});

test('a delayed retired terminal cannot clear an authoritative anonymous active run', () => {
  const projection = new OpenClawChatRunProjection();
  const completed = projection.begin(SESSION, 'run-retired-before-reconnect');
  assert.ok(completed);
  assert.equal(projection.complete(completed.lease), true);

  projection.reconcileSessionSnapshots([
    { key: SESSION, hasActiveRun: true },
  ], [SESSION]);

  assert.equal(projection.hasActiveSession(SESSION), true);
  assert.equal(projection.claimTerminal(SESSION, 'run-retired-before-reconnect'), null);
  assert.equal(projection.hasActiveSession(SESSION), true);
});

test('deduplicates durable transcript updates by OpenClaw message sequence', () => {
  const projection = new OpenClawChatRunProjection();

  assert.equal(projection.acceptTranscriptUpdate(SESSION, 11), true);
  assert.equal(projection.acceptTranscriptUpdate(SESSION, 11), false);
  assert.equal(projection.acceptTranscriptUpdate(SESSION, 10), false);
  assert.equal(projection.acceptTranscriptUpdate(SESSION, 12), true);
});

test('session invalidation resets the transcript sequence namespace', () => {
  const projection = new OpenClawChatRunProjection();

  assert.equal(projection.acceptTranscriptUpdate(SESSION, 12), true);
  projection.invalidate(SESSION);

  assert.equal(projection.acceptTranscriptUpdate(SESSION, 1), true);
});
