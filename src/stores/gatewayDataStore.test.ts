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
  refreshSessionArtifacts,
  refreshToolsCatalog,
  refreshToolsEffective,
  resolveOpenClawArtifactDownloadUrl,
  saveSessionArtifact,
  resolveGatewayConnectionStartedAt,
  startPolling,
  stopPolling,
  useGatewayDataStore,
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

test('effective tool snapshots follow Session lifecycle and capability advertisement', async () => {
  const store = useGatewayDataStore.getState();
  store.setSessions([{ key: 'agent:main:main' }]);
  store.setToolsEffective('agent:main:main', {
    agentId: 'main',
    profile: 'coding',
    groups: [],
  });
  assert.ok(useGatewayDataStore.getState().toolsEffective['agent:main:main']);

  store.setToolsEffectiveLoading('agent:main:main');
  store.setSessions([]);
  const afterDeletion = useGatewayDataStore.getState();
  assert.equal(afterDeletion.toolsEffective['agent:main:main'], undefined);
  assert.equal(afterDeletion.toolsEffectiveLoading, false);
  assert.equal(afterDeletion.toolsEffectiveLoadingSessionKey, null);

  const calls: string[] = [];
  const gateway = {
    hasAdvertisedMethod: (method: string) => method === 'tools.effective' ? false : true,
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshToolsEffective('agent:main:main'), false);
    assert.equal(useGatewayDataStore.getState().toolsEffectiveError, 'OPENCLAW_TOOLS_EFFECTIVE_UNSUPPORTED');
    assert.equal(calls.includes('tools.effective'), false);
  } finally {
    stopPolling();
  }
});

test('tool catalogs follow Agent lifecycle and capability advertisement', async () => {
  const store = useGatewayDataStore.getState();
  store.setAgents([{ id: 'main' }]);
  store.setToolsCatalog('main', {
    agentId: 'main',
    profiles: [],
    groups: [],
  });
  assert.ok(useGatewayDataStore.getState().toolsCatalog.main);

  store.setToolsCatalogLoading('main');
  store.setAgents([]);
  const afterDeletion = useGatewayDataStore.getState();
  assert.equal(afterDeletion.toolsCatalog.main, undefined);
  assert.equal(afterDeletion.toolsCatalogLoading, false);
  assert.equal(afterDeletion.toolsCatalogLoadingAgentId, null);

  const calls: string[] = [];
  const gateway = {
    hasAdvertisedMethod: (method: string) => method === 'tools.catalog' ? false : true,
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshToolsCatalog('main'), false);
    assert.equal(useGatewayDataStore.getState().toolsCatalogError, 'OPENCLAW_TOOLS_CATALOG_UNSUPPORTED');
    assert.equal(calls.includes('tools.catalog'), false);
  } finally {
    stopPolling();
  }
});

test('refreshToolsCatalog commits only the current Gateway result for the selected Agent', async () => {
  const store = useGatewayDataStore.getState();
  store.setAgents([{ id: 'main' }]);
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const gateway = {
    hasAdvertisedMethod: (method: string) => method === 'tools.catalog' ? true : null,
    request: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      if (method === 'tools.catalog') {
        return { agentId: 'main', profiles: [], groups: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshToolsCatalog('main'), true);
    assert.deepEqual(useGatewayDataStore.getState().toolsCatalog.main, {
      agentId: 'main',
      profiles: [],
      groups: [],
    });
    assert.deepEqual(calls.find((call) => call.method === 'tools.catalog'), {
      method: 'tools.catalog',
      params: { agentId: 'main', includePlugins: true },
    });
  } finally {
    stopPolling();
  }
});

test('session artifacts follow Session lifecycle and capability advertisement', async () => {
  const store = useGatewayDataStore.getState();
  store.setSessions([{ key: 'agent:main:main' }]);
  store.setSessionArtifacts('agent:main:main', []);
  store.setSessionArtifactsLoading('agent:main:main');
  store.setSessions([]);
  const afterDeletion = useGatewayDataStore.getState();
  assert.equal(afterDeletion.sessionArtifacts['agent:main:main'], undefined);
  assert.equal(afterDeletion.sessionArtifactsLoading, false);
  assert.equal(afterDeletion.sessionArtifactsLoadingKey, null);

  const calls: string[] = [];
  const gateway = {
    hasAdvertisedMethod: (method: string) => method === 'artifacts.download' ? true : false,
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshSessionArtifacts('agent:main:main'), false);
    assert.equal(useGatewayDataStore.getState().sessionArtifactsError, 'OPENCLAW_ARTIFACTS_UNSUPPORTED');
    assert.equal(calls.includes('artifacts.list'), false);
    assert.equal((await saveSessionArtifact('agent:main:main', 'artifact-1')).success, false);
  } finally {
    stopPolling();
  }
});

test('artifact download URLs stay bound to the selected Gateway', () => {
  assert.equal(
    resolveOpenClawArtifactDownloadUrl('https://gateway.example/artifact-1', 'http://127.0.0.1:18789'),
    'https://gateway.example/artifact-1',
  );
  assert.equal(
    resolveOpenClawArtifactDownloadUrl('/api/media/artifact-1', 'http://127.0.0.1:18789'),
    'http://127.0.0.1:18789/api/media/artifact-1',
  );
  assert.equal(resolveOpenClawArtifactDownloadUrl('/api/media/artifact-1'), null);
  assert.equal(resolveOpenClawArtifactDownloadUrl('/media/artifact-1', 'http://127.0.0.1:18789'), null);
  assert.equal(
    resolveOpenClawArtifactDownloadUrl('data:text/plain;base64,aGVsbG8=', 'http://127.0.0.1:18789'),
    'data:text/plain;base64,aGVsbG8=',
  );
});

test('session artifacts are not discarded before the first authoritative session snapshot', async () => {
  const store = useGatewayDataStore.getState();
  store.setSessions([]);
  useGatewayDataStore.setState({
    lastFetch: { ...store.lastFetch, sessions: 0 },
  });
  const gateway = {
    hasAdvertisedMethod: (method: string) => method === 'artifacts.list' ? true : null,
    request: async (method: string) => {
      if (method === 'sessions.list') return new Promise<never>(() => {});
      if (method === 'agents.list') return { agents: [] };
      if (method === 'artifacts.list') {
        return {
          artifacts: [{
            id: 'artifact-cold-start',
            type: 'file',
            title: 'cold-start.txt',
            download: { mode: 'unsupported' },
          }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshSessionArtifacts('agent:main:main'), true);
    assert.ok(useGatewayDataStore.getState().sessionArtifacts['agent:main:main']);
  } finally {
    stopPolling();
  }
});

test('refreshSessionArtifacts commits only a current Gateway result for an active Session', async () => {
  const store = useGatewayDataStore.getState();
  store.setSessions([{ key: 'agent:main:main' }]);
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const gateway = {
    hasAdvertisedMethod: (method: string) => method === 'artifacts.list' ? true : null,
    request: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'sessions.list') return { sessions: [{ key: 'agent:main:main' }], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      if (method === 'artifacts.list') {
        return {
          artifacts: [{
            id: 'artifact-1',
            type: 'file',
            title: 'report.txt',
            sessionKey: 'agent:main:main',
            download: { mode: 'unsupported' },
          }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshSessionArtifacts('agent:main:main', 'main'), true);
    assert.deepEqual(useGatewayDataStore.getState().sessionArtifacts['agent:main:main'], [{
      id: 'artifact-1',
      type: 'file',
      title: 'report.txt',
      sessionKey: 'agent:main:main',
      download: { mode: 'unsupported' },
    }]);
    assert.deepEqual(calls.find((call) => call.method === 'artifacts.list'), {
      method: 'artifacts.list',
      params: { sessionKey: 'agent:main:main', agentId: 'main' },
    });
  } finally {
    stopPolling();
  }
});
