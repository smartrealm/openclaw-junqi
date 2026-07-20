import assert from 'node:assert/strict';
import test from 'node:test';
import { activitySessionMetrics, mergeActivitySessions, normalizeUsageSession } from './activitySessions';

test('normalizes historical usage rows and nested metrics', () => {
  const record = normalizeUsageSession({
    key: 'agent:main:desktop-history',
    model: 'openai/gpt-5',
    usage: {
      totalTokens: 3210,
      cost: { total: 0.0123 },
      lastActivity: '2026-07-21T01:00:00.000Z',
      durationMs: 4500,
    },
  });

  assert.ok(record);
  assert.equal(record.session.model, 'openai/gpt-5');
  assert.equal(record.session.totalTokens, 3210);
  assert.equal(record.session.lastActive, '2026-07-21T01:00:00.000Z');
  assert.deepEqual(activitySessionMetrics(record), { tokens: 3210, cost: 0.0123, durationMs: 4500 });
});

test('live session snapshots override historical fields without dropping usage metrics', () => {
  const records = mergeActivitySessions({
    usageSessions: [{
      key: 'agent:main:desktop-1',
      label: 'Historical label',
      model: 'anthropic/claude',
      usage: { totalTokens: 1200, cost: { total: 0.04 } },
    }],
    gatewaySessions: [{
      key: 'agent:main:desktop-1',
      label: 'Live label',
      running: true,
      model: 'openai/gpt-5',
    }],
    chatSessions: [],
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].session.label, 'Live label');
  assert.equal(records[0].session.model, 'openai/gpt-5');
  assert.equal(records[0].session.running, true);
  assert.deepEqual(activitySessionMetrics(records[0]), { tokens: 1200, cost: 0.04, durationMs: undefined });
});

test('numeric timestamps in seconds are normalized to ISO milliseconds', () => {
  const record = normalizeUsageSession({ key: 'agent:main:old', updatedAt: 1_750_000_000 });
  assert.ok(record);
  assert.equal(record.session.updatedAt, new Date(1_750_000_000_000).toISOString());
});
