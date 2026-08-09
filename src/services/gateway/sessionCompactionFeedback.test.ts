import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionCompactionTargetError,
  notifyOpenClawSessionCompaction,
  notifyOpenClawSessionCompactionFailure,
  presentOpenClawSessionCompaction,
  requireOpenClawSessionCompactionTarget,
} from '@/processing/sessionCompactionFeedback';

const translate = (key: string, options?: { reason: string }): string => (
  options?.reason ? `${key}:${options.reason}` : key
);

test('classifies a Gateway-accepted pending compaction separately from no-op and completion', () => {
  assert.equal(presentOpenClawSessionCompaction({
    ok: true,
    key: 'agent:main:main',
    compacted: false,
    pending: true,
  }).bodyKey, 'dashboard.compactPendingBody');
  assert.equal(presentOpenClawSessionCompaction({
    ok: true,
    key: 'agent:main:main',
    compacted: false,
  }).bodyKey, 'dashboard.compactNoopBody');
  assert.equal(presentOpenClawSessionCompaction({
    ok: true,
    key: 'agent:main:main',
    compacted: true,
  }).bodyKey, 'dashboard.compactCompletedBody');
});

test('pending compaction feedback never claims completion or no-op', () => {
  const calls: Array<{ type: string; title: string; body: string }> = [];
  notifyOpenClawSessionCompaction({
    ok: true,
    key: 'agent:main:main',
    compacted: false,
    pending: true,
  }, translate, (type, title, body) => {
    calls.push({ type, title, body });
  });

  assert.deepEqual(calls, [{
    type: 'info',
    title: 'dashboard.compactPendingTitle',
    body: 'dashboard.compactPendingBody',
  }]);
});

test('Gateway rejection and request failure both remain errors', () => {
  const calls: Array<{ type: string; title: string; body: string }> = [];
  const addToast = (type: string, title: string, body: string) => {
    calls.push({ type, title, body });
  };
  notifyOpenClawSessionCompaction({
    ok: false,
    key: 'agent:main:main',
    compacted: false,
    reason: 'provider rejected summary',
  }, translate, addToast);
  notifyOpenClawSessionCompactionFailure(new Error('authorization denied'), translate, addToast);

  assert.deepEqual(calls, [
    {
      type: 'error',
      title: 'dashboard.compactFailedTitle',
      body: 'dashboard.compactFailedBody:provider rejected summary',
    },
    {
      type: 'error',
      title: 'dashboard.compactFailedTitle',
      body: 'authorization denied',
    },
  ]);
});

test('requires an explicit active session before requesting compaction', () => {
  assert.equal(requireOpenClawSessionCompactionTarget(' agent:main:main '), 'agent:main:main');
  assert.throws(
    () => requireOpenClawSessionCompactionTarget('   '),
    OpenClawSessionCompactionTargetError,
  );
  assert.throws(
    () => requireOpenClawSessionCompactionTarget(null),
    OpenClawSessionCompactionTargetError,
  );
});

test('missing active session renders a localized compaction failure', () => {
  const notifications: Array<{ type: string; title: string; body: string }> = [];
  notifyOpenClawSessionCompactionFailure(
    new OpenClawSessionCompactionTargetError(),
    (key) => key,
    (type, title, body) => { notifications.push({ type, title, body }); },
  );

  assert.deepEqual(notifications, [{
    type: 'error',
    title: 'dashboard.compactFailedTitle',
    body: 'dashboard.compactSessionRequired',
  }]);
});
