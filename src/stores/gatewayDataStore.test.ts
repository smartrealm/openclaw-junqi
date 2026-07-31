import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GATEWAY_DATA_GROUPS,
  createGatewayRequestFence,
  isRunningSubagentSession,
  resolveGatewayConnectionStartedAt,
} from './gatewayDataStore';

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0);

test('sub-agent activity follows explicit OpenClaw run fields before timestamp compatibility fallback', () => {
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:a', hasActiveRun: true }, NOW), true);
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:b', hasActiveRun: false }, NOW), false);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:authoritative-active',
    hasActiveRun: true,
    status: 'done',
  }, NOW), true);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:authoritative-settled',
    hasActiveRun: false,
    status: 'running',
  }, NOW), false);
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:c', status: 'done' }, NOW), false);
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:d', running: false }, NOW), false);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:e',
    updatedAt: new Date(NOW - 30_000).toISOString(),
  }, NOW), true);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:f',
    updatedAt: new Date(NOW - 61_000).toISOString(),
  }, NOW), false);
});

test('every Gateway data group rejects stale requests and stale connections', () => {
  const fence = createGatewayRequestFence<object>();
  const firstConnection = {};
  const secondConnection = {};
  const latestByGroup = new Map<string, ReturnType<typeof fence.begin>>();

  for (const group of GATEWAY_DATA_GROUPS) {
    const first = fence.begin(group, firstConnection);
    const latest = fence.begin(group, firstConnection);
    assert.equal(fence.isCurrent(first, firstConnection), false, `${group} supersedes its old request`);
    assert.equal(fence.isCurrent(latest, firstConnection), true, `${group} accepts its latest request`);
    assert.equal(fence.isCurrent(latest, secondConnection), false, `${group} rejects a replaced connection`);
    latestByGroup.set(group, latest);
  }

  const latestSession = latestByGroup.get('sessions');
  const latestAgents = latestByGroup.get('agents');
  assert.ok(latestSession);
  assert.ok(latestAgents);
  fence.invalidate('sessions');
  assert.equal(fence.isCurrent(latestSession, firstConnection), false);
  assert.equal(fence.isCurrent(latestAgents, firstConnection), true);

  fence.invalidateAll();
  for (const group of GATEWAY_DATA_GROUPS) {
    const stale = latestByGroup.get(group);
    assert.ok(stale);
    assert.equal(fence.isCurrent(stale, firstConnection), false, `${group} invalidates disconnected work`);
    const ticket = fence.begin(group, secondConnection);
    assert.equal(fence.isCurrent(ticket, secondConnection), true, `${group} accepts a new request`);
  }
});

test('Gateway connection start time survives polling restarts only while connected', () => {
  assert.equal(resolveGatewayConnectionStartedAt(null, true, 100), 100);
  assert.equal(resolveGatewayConnectionStartedAt(100, true, 200), 100);
  assert.equal(resolveGatewayConnectionStartedAt(100, false, 300), null);
  assert.equal(resolveGatewayConnectionStartedAt(null, true, 400), 400);
});
