import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GATEWAY_DATA_GROUPS,
  buildSessionsUsageRequest,
  createGatewayRequestFence,
  isRunningSubagentSession,
  parseGatewayAgentList,
  parseGatewayCostSummary,
  parseGatewayCronJobList,
  parseGatewaySessionsUsage,
  resolveGatewayConnectionStartedAt,
} from './gatewayDataStore';

const NOW = Date.UTC(2026, 6, 21, 12, 0, 0);
const METRICS = {
  totalCost: 1,
  inputCost: 0.2,
  outputCost: 0.8,
  input: 10,
  output: 20,
  cacheRead: 1,
  cacheWrite: 2,
  cacheReadCost: 0.01,
  cacheWriteCost: 0.02,
  totalTokens: 33,
  missingCostEntries: 0,
};

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

test('Gateway polling decoders reject malformed responses instead of inventing empty data', () => {
  assert.deepEqual(parseGatewayAgentList({ agents: [{ id: 'main' }] }), [{ id: 'main' }]);
  assert.equal(parseGatewayAgentList({ agents: [{ name: 'missing-id' }] }), null);
  assert.deepEqual(parseGatewayCronJobList([{ id: 'daily', agentId: 'ops' }]), [{ id: 'daily', agentId: 'ops' }]);
  assert.equal(parseGatewayCronJobList({ jobs: [{ id: 'daily', agentId: '' }] }), null);
  assert.equal(parseGatewayCronJobList({ jobs: [{ id: '' }] }), null);

  const cost = { days: 30, daily: [{ date: '2026-07-31', ...METRICS }], totals: METRICS };
  assert.deepEqual(parseGatewayCostSummary(cost), cost);
  assert.equal(parseGatewayCostSummary({ days: 30, daily: [], totals: {} }), null);
  const usage = {
    updatedAt: NOW,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    sessions: [],
    totals: METRICS,
    aggregates: { byAgent: [] },
  };
  assert.deepEqual(parseGatewaySessionsUsage(usage), usage);
  assert.equal(parseGatewaySessionsUsage({ sessions: [], aggregates: { byAgent: [] } }), null);
  assert.equal(parseGatewaySessionsUsage({ sessions: {} }), null);
});

test('sessions.usage requests keep the official date range beside the all-agent scope', () => {
  assert.deepEqual(buildSessionsUsageRequest(2000, { range: 'all' }), {
    limit: 2000,
    agentScope: 'all',
    range: 'all',
  });
  assert.deepEqual(buildSessionsUsageRequest(200, {
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    mode: 'specific',
    timeZone: 'Asia/Shanghai',
  }), {
    limit: 200,
    agentScope: 'all',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    mode: 'specific',
    timeZone: 'Asia/Shanghai',
  });
});

test('sessions.usage accepts official family rows without a concrete session id', () => {
  const usage = {
    updatedAt: NOW,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    sessions: [{ key: 'agent:main:family', scope: 'family', usage: null }],
    totals: METRICS,
    aggregates: { byAgent: [] },
  };
  assert.deepEqual(parseGatewaySessionsUsage(usage), usage);
});
