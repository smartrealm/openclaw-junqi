import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GATEWAY_DATA_GROUPS,
  createGatewayRequestFence,
  handleGatewayEvent,
  isRunningSubagentSession,
  parseGatewayAgentList,
  parseGatewayCostSummary,
  parseGatewayCronJobList,
  parseGatewaySessionsUsage,
  resolveGatewayConnectionStartedAt,
  useGatewayDataStore,
} from './gatewayDataStore';
import { parseCronStatus } from '@/services/gateway/cronStatus';

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

test('Gateway polling decoders reject malformed responses instead of inventing empty data', () => {
  assert.deepEqual(parseGatewayAgentList({ agents: [{ id: 'main' }] }), [{ id: 'main' }]);
  assert.equal(parseGatewayAgentList({ agents: [{ name: 'missing-id' }] }), null);
  assert.deepEqual(parseGatewayCronJobList([{ id: 'daily', agentId: 'ops' }]), [{ id: 'daily', agentId: 'ops' }]);
  assert.equal(parseGatewayCronJobList({ jobs: [{ id: 'daily', agentId: '' }] }), null);
  assert.equal(parseGatewayCronJobList({ jobs: [{ id: '' }] }), null);
  assert.equal(parseGatewayCronJobList({ jobs: [{ id: 'daily', state: 'running' }] }), null);
  assert.deepEqual(parseCronStatus({
    enabled: true,
    storePath: '/runtime/cron.sqlite',
    storage: 'sqlite',
    sqlitePath: '/runtime/cron.sqlite',
    jobs: 1,
    nextWakeAtMs: null,
  }), {
    enabled: true,
    storePath: '/runtime/cron.sqlite',
    storage: 'sqlite',
    sqlitePath: '/runtime/cron.sqlite',
    jobs: 1,
    nextWakeAtMs: null,
  });

  const metrics = {
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
  const cost = { days: 30, daily: [{ date: '2026-07-31', ...metrics }], totals: metrics };
  assert.deepEqual(parseGatewayCostSummary(cost), cost);
  assert.equal(parseGatewayCostSummary({ days: 30, daily: [], totals: {} }), null);
  assert.deepEqual(parseGatewaySessionsUsage({ sessions: [], aggregates: { byAgent: [] } }), {
    sessions: [],
    aggregates: { byAgent: [] },
  });
  assert.equal(parseGatewaySessionsUsage({ sessions: {} }), null);
});

test('cron run events preserve the Gateway state object and project official runtime fields', () => {
  const initialJob = {
    id: 'daily',
    name: 'Daily briefing',
    enabled: true,
    state: {
      nextRunAtMs: 1_754_000_100_000,
      lastRunStatus: 'error',
      lastDurationMs: 900,
    },
  };
  useGatewayDataStore.setState({ cronJobs: [initialJob] });

  try {
    handleGatewayEvent('cron', {
      jobId: 'daily',
      action: 'started',
      runAtMs: 1_754_000_000_000,
    });

    const started = useGatewayDataStore.getState().cronJobs[0];
    assert.equal(typeof started.state, 'object');
    assert.equal(started.state?.nextRunAtMs, 1_754_000_100_000);
    assert.equal(started.state?.lastRunStatus, 'error');
    assert.equal(started.state?.lastDurationMs, 900);
    assert.equal(started.state?.runningAtMs, 1_754_000_000_000);

    handleGatewayEvent('cron', {
      jobId: 'daily',
      action: 'finished',
      status: 'ok',
      runAtMs: 1_754_000_000_000,
      durationMs: 2_100,
      nextRunAtMs: 1_754_000_200_000,
      deliveryStatus: 'delivered',
    });

    const finished = useGatewayDataStore.getState().cronJobs[0];
    assert.equal(typeof finished.state, 'object');
    assert.equal(finished.state?.runningAtMs, undefined);
    assert.equal(finished.state?.nextRunAtMs, 1_754_000_200_000);
    assert.equal(finished.state?.lastRunAtMs, 1_754_000_000_000);
    assert.equal(finished.state?.lastRunStatus, 'ok');
    assert.equal(finished.state?.lastStatus, 'ok');
    assert.equal(finished.state?.lastDurationMs, 2_100);
    assert.equal(finished.state?.lastDeliveryStatus, 'delivered');
    assert.equal(finished.lastRun, new Date(1_754_000_000_000).toISOString());
    assert.equal(finished.lastRunStatus, 'ok');
    assert.equal(finished.lastDeliveryStatus, 'delivered');
  } finally {
    useGatewayDataStore.setState({ cronJobs: [] });
  }
});

test('legacy dotted cron run events keep the same state projection contract', () => {
  useGatewayDataStore.setState({
    cronJobs: [{ id: 'legacy', state: { nextRunAtMs: 10_000 } }],
  });

  try {
    handleGatewayEvent('cron.run.started', { id: 'legacy', runAtMs: 5_000 });
    assert.equal(useGatewayDataStore.getState().cronJobs[0].state?.runningAtMs, 5_000);

    handleGatewayEvent('cron.run.completed', {
      id: 'legacy',
      status: 'skipped',
      runAtMs: 5_000,
    });
    const job = useGatewayDataStore.getState().cronJobs[0];
    assert.equal(typeof job.state, 'object');
    assert.equal(job.state?.runningAtMs, undefined);
    assert.equal(job.state?.lastRunStatus, 'skipped');
    assert.equal(job.state?.nextRunAtMs, 10_000);
  } finally {
    useGatewayDataStore.setState({ cronJobs: [] });
  }
});
