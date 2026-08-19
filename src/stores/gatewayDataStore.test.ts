import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from '@/services/gateway/Connection';
import {
  GATEWAY_DATA_GROUPS,
  buildSessionsUsageRequest,
  createGatewayRequestFence,
  handleGatewayEvent,
  isRunningSubagentSession,
  parseGatewayAgentList,
  parseGatewayCostSummary,
  parseGatewayCronJobList,
  parseGatewaySessionsUsage,
  refreshSessionArtifacts,
  retainGatewayDataPolling,
  searchOpenClawMemory,
  refreshOpenClawMemoryDiagnostics,
  refreshToolsCatalog,
  refreshToolsEffective,
  invokeOpenClawTool,
  OpenClawToolsInvokeUnavailableError,
  resolveOpenClawArtifactDownloadUrl,
  saveSessionArtifact,
  resolveGatewayConnectionStartedAt,
  startPolling,
  stopPolling,
  searchOpenClawSessions,
  selectSessionArtifacts,
  useGatewayDataStore,
} from './gatewayDataStore';
import { parseCronStatus } from '@/services/gateway/cronStatus';

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

const USAGE_AGGREGATES = {
  messages: { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 },
  tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
  byModel: [],
  byProvider: [],
  byAgent: [],
  byChannel: [],
  daily: [],
};

const CRON_JOB = {
  id: 'daily',
  name: 'Daily report',
  agentId: 'main',
  enabled: true,
  createdAtMs: NOW,
  updatedAtMs: NOW,
  schedule: { kind: 'every', everyMs: 86_400_000 },
  sessionTarget: 'isolated',
  wakeMode: 'now',
  payload: { kind: 'agentTurn', message: 'Generate the report' },
  payloadKind: 'agentTurn',
  state: { nextRunAtMs: 100 },
} as const;

test('会话产物缺失时复用稳定空快照', () => {
  const state = { sessionArtifacts: {} };
  const first = selectSessionArtifacts(state, 'agent:main:missing');
  const second = selectSessionArtifacts(state, 'agent:main:missing');

  assert.equal(first, second);
  assert.deepEqual(first, []);
});

test('相同会话快照仍标记为当前连接已完成读取', () => {
  const originalNow = Date.now;
  const originalState = useGatewayDataStore.getState();
  try {
    let now = 1_000;
    Date.now = () => now;
    useGatewayDataStore.setState({
      sessions: [],
      lastFetch: { ...originalState.lastFetch, sessions: 0 },
      loading: { ...originalState.loading, sessions: true },
      errors: { ...originalState.errors, sessions: null },
    });
    const session = { key: 'agent:main:main', label: '主会话' };
    useGatewayDataStore.getState().setSessions([session]);

    now = 2_000;
    useGatewayDataStore.setState({
      connectionStartedAt: 1_500,
      loading: { ...useGatewayDataStore.getState().loading, sessions: true },
    });
    useGatewayDataStore.getState().setSessions([session]);

    assert.equal(useGatewayDataStore.getState().lastFetch.sessions, 2_000);
    assert.equal(useGatewayDataStore.getState().loading.sessions, false);
  } finally {
    Date.now = originalNow;
    useGatewayDataStore.setState(originalState, true);
  }
});

test('重型用量轮询仅在页面保留期间启动', async () => {
  const calls: string[] = [];
  const gateway = {
    request: async (method: string, params: Record<string, unknown>) => {
      calls.push(method);
      if (method === 'agents.list') {
        return { defaultId: 'main', mainKey: 'main', scope: 'per-sender', agents: [{ id: 'main' }] };
      }
      if (method === 'sessions.list') {
        return {
          sessions: [], totalCount: 0, offset: Number(params.offset ?? 0), nextOffset: null, hasMore: false,
        };
      }
      if (method === 'sessions.usage') {
        return {
          updatedAt: NOW,
          startDate: '2026-07-01',
          endDate: '2026-07-31',
          sessions: [],
          totals: METRICS,
          aggregates: USAGE_AGGREGATES,
        };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  const release = retainGatewayDataPolling('usage');
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.filter((method) => method === 'sessions.usage').length, 1);
  } finally {
    release();
    stopPolling();
  }
});

test('sub-agent activity only follows explicit OpenClaw run fields', () => {
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:a', hasActiveRun: true }), true);
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:b', hasActiveRun: false }), false);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:authoritative-active',
    hasActiveRun: true,
    status: 'done',
  }), true);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:authoritative-settled',
    hasActiveRun: false,
    status: 'running',
  }), false);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:child-active',
    hasActiveSubagentRun: true,
  }), true);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:child-settled',
    hasActiveSubagentRun: false,
  }), false);
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:c', status: 'running' }), false);
  assert.equal(isRunningSubagentSession({ key: 'agent:writer:subagent:d', running: true }), false);
  assert.equal(isRunningSubagentSession({
    key: 'agent:writer:subagent:e',
    updatedAt: new Date(NOW - 30_000).toISOString(),
  }), false);
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

test('首次轮询在确认 OpenClaw 智能体范围后再读取会话', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const gateway = {
    request: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'agents.list') {
        return {
          defaultId: 'main',
          mainKey: 'main',
          scope: 'per-sender',
          agents: [{ id: 'main' }],
        };
      }
      if (method === 'sessions.list') {
        return {
          sessions: [],
          totalCount: 0,
          offset: Number(params.offset ?? 0),
          nextOffset: null,
          hasMore: false,
        };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls.map((call) => call.method), [
      'agents.list',
      'sessions.list',
      'sessions.list',
    ]);
    assert.deepEqual(calls[1]?.params, {
      agentId: 'main',
      includeGlobal: true,
      includeUnknown: true,
      configuredAgentsOnly: true,
      includeDerivedTitles: true,
      includeLastMessage: true,
      limit: 100,
      offset: 0,
    });
    assert.equal(useGatewayDataStore.getState().errors.sessions, null);
  } finally {
    stopPolling();
  }
});

test('cron events refresh the authoritative list without manufacturing local run state', async () => {
  const calls: string[] = [];
  const gateway = {
    request: async (method: string, params: Record<string, unknown>) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      if (method === 'cron.list') {
        return {
          jobs: [{ ...CRON_JOB, state: { nextRunAtMs: 100 } }],
          snapshotRevision: 'cron-snapshot-1',
          total: 1,
          offset: Number(params.offset ?? 0),
          limit: Number(params.limit ?? 200),
          hasMore: false,
          nextOffset: null,
        };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    useGatewayDataStore.getState().setCronJobs([{ ...CRON_JOB, state: { nextRunAtMs: 1 } }]);

    handleGatewayEvent('cron.run.started', { jobId: 'daily' });
    assert.deepEqual(useGatewayDataStore.getState().cronJobs[0]?.state, { nextRunAtMs: 1 });

    handleGatewayEvent('cron', {});
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.filter((method) => method === 'cron.list').length, 1);
    assert.deepEqual(useGatewayDataStore.getState().cronJobs[0]?.state, { nextRunAtMs: 100 });
  } finally {
    stopPolling();
  }
});

test('Gateway polling decoders reject malformed responses instead of inventing empty data', () => {
  assert.deepEqual(parseGatewayAgentList({ defaultId: 'captain', mainKey: 'main', scope: 'per-sender', agents: [{ id: 'captain' }] }), {
    agents: [{ id: 'captain' }], defaultAgentId: 'captain', mainSessionKey: 'agent:captain:main', scope: 'per-sender',
  });
  assert.deepEqual(parseGatewayAgentList({ defaultId: 'captain', mainKey: 'main', scope: 'global', agents: [{ id: 'captain' }] }), {
    agents: [{ id: 'captain' }], defaultAgentId: 'captain', mainSessionKey: 'agent:captain:global', scope: 'global',
  });
  assert.equal(parseGatewayAgentList({ agents: [{ name: 'missing-id' }] }), null);
  assert.deepEqual(parseGatewayCronJobList({ jobs: [{ ...CRON_JOB, agentId: 'ops' }] }), [{
    id: 'daily',
    name: 'Daily report',
    enabled: true,
    agentId: 'ops',
    createdAtMs: NOW,
    updatedAtMs: NOW,
    schedule: { kind: 'every', everyMs: 86_400_000 },
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payloadKind: 'agentTurn',
    state: { nextRunAtMs: 100 },
  }]);
  assert.equal(parseGatewayCronJobList([{ ...CRON_JOB, agentId: 'ops' }]), null);
  assert.equal(parseGatewayCronJobList({ jobs: [{ id: 'daily', agentId: 'ops' }] }), null);
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

  const cost = { updatedAt: NOW, days: 30, daily: [{ date: '2026-07-31', ...METRICS }], totals: METRICS };
  assert.deepEqual(parseGatewayCostSummary(cost), cost);
  assert.equal(parseGatewayCostSummary({ days: 30, daily: [], totals: {} }), null);
  const usage = {
    updatedAt: NOW,
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    sessions: [],
    totals: METRICS,
    aggregates: USAGE_AGGREGATES,
  };
  assert.deepEqual(parseGatewaySessionsUsage(usage), usage);
  assert.equal(parseGatewaySessionsUsage({ sessions: [], aggregates: USAGE_AGGREGATES }), null);
  assert.equal(parseGatewaySessionsUsage({ sessions: {} }), null);
});

test('非官方顶层事件不会修改 OpenClaw 会话投影', () => {
  const sessionKey = 'agent:main:gateway-event-boundary';
  useGatewayDataStore.getState().setSessions([{ key: sessionKey, running: false }]);

  handleGatewayEvent('session.started', { key: 'agent:main:invented-session' });
  handleGatewayEvent('task-session', { task_id: 'local-task', session_id: sessionKey });
  handleGatewayEvent('task-status', { task_id: 'local-task', status: 'running' });

  const sessions = useGatewayDataStore.getState().sessions;
  assert.equal(sessions.some((session) => session.key === 'agent:main:invented-session'), false);
  assert.equal(sessions.find((session) => session.key === sessionKey)?.running, false);
});

test('未知 Gateway 事件载荷不会突破事件边界或破坏日志路径', () => {
  const sessionKey = 'agent:main:unknown-event-payload';
  const circularPayload: Record<string, unknown> = {};
  circularPayload.self = circularPayload;
  useGatewayDataStore.getState().setSessions([{ key: sessionKey, running: false }]);

  assert.doesNotThrow(() => handleGatewayEvent('sessions.changed', null));
  assert.doesNotThrow(() => handleGatewayEvent('unknown.event', circularPayload));
  const sessions = useGatewayDataStore.getState().sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.key, sessionKey);
  assert.equal(sessions[0]?.running, false);
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
    aggregates: USAGE_AGGREGATES,
  };
  assert.deepEqual(parseGatewaySessionsUsage(usage), usage);
});

test('effective tool snapshots follow Session lifecycle and actual Gateway support', async () => {
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
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      if (method === 'tools.effective') {
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshToolsEffective('agent:main:main'), false);
    assert.equal(useGatewayDataStore.getState().toolsEffectiveError, 'OPENCLAW_TOOLS_EFFECTIVE_UNSUPPORTED');
    assert.equal(calls.includes('tools.effective'), true);
  } finally {
    stopPolling();
  }
});

test('tools.invoke is restricted to the current effective Session tool set and uses a connection fence', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId?: string }> = [];
  const gateway = {
    getAttestedConnectionId: () => 'connection-1',
    request: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'sessions.list') return { sessions: [{ key: 'agent:main:main' }], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      throw new Error(`unexpected unfenced method: ${method}`);
    },
    requestFenced: async (method: string, params: Record<string, unknown>, connectionId: string) => {
      calls.push({ method, params, connectionId });
      if (method === 'tools.invoke') {
        return { ok: true, toolName: 'memory_search', output: { results: [] }, source: 'core' };
      }
      throw new Error(`unexpected fenced method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    const store = useGatewayDataStore.getState();
    store.setSessions([{ key: 'agent:main:main' }]);
    store.setToolsEffective('agent:main:main', {
      agentId: 'main',
      profile: 'coding',
      groups: [{
        id: 'core',
        label: 'Core',
        source: 'core',
        tools: [{
          id: 'memory_search',
          label: 'Memory search',
          description: 'Search memory',
          rawDescription: 'Search memory',
          source: 'core',
        }],
      }],
    });

    const result = await invokeOpenClawTool({
      name: 'memory_search',
      args: { query: 'JunQi' },
      sessionKey: 'agent:main:main',
    });
    assert.deepEqual(result, {
      ok: true,
      toolName: 'memory_search',
      output: { results: [] },
      source: 'core',
    });
    const invokeCall = calls.find((call) => call.method === 'tools.invoke');
    assert.equal(invokeCall?.connectionId, 'connection-1');
    assert.equal(invokeCall?.params.name, 'memory_search');
    assert.deepEqual(invokeCall?.params.args, { query: 'JunQi' });
    assert.equal(invokeCall?.params.sessionKey, 'agent:main:main');
    assert.equal(invokeCall?.params.agentId, 'main');
    assert.equal(typeof invokeCall?.params.idempotencyKey, 'string');
  } finally {
    stopPolling();
  }
});

test('tools.invoke maps an actual unsupported Gateway method after its effective snapshot is verified', async () => {
  const calls: string[] = [];
  const gateway = {
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [{ key: 'agent:main:main' }], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      if (method === 'tools.invoke') {
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    useGatewayDataStore.getState().setSessions([{ key: 'agent:main:main' }]);
    useGatewayDataStore.getState().setToolsEffective('agent:main:main', {
      agentId: 'main',
      profile: 'coding',
      groups: [{
        id: 'core',
        label: 'Core',
        source: 'core',
        tools: [{
          id: 'exec',
          label: 'Exec',
          description: '',
          rawDescription: '',
          source: 'core',
        }],
      }],
    });
    await assert.rejects(
      invokeOpenClawTool({ name: 'exec', sessionKey: 'agent:main:main' }),
      (error: unknown) => error instanceof OpenClawToolsInvokeUnavailableError
        && error.code === 'OPENCLAW_TOOLS_INVOKE_UNSUPPORTED',
    );
    assert.equal(calls.includes('tools.invoke'), true);
  } finally {
    stopPolling();
  }
});

test('tools.invoke never bypasses an effective snapshot that omits the requested tool', async () => {
  const calls: string[] = [];
  const gateway = {
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [{ key: 'agent:main:main' }], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      if (method === 'tools.effective') {
        return { agentId: 'main', profile: 'minimal', groups: [] };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    useGatewayDataStore.getState().setSessions([{ key: 'agent:main:main' }]);
    await assert.rejects(
      invokeOpenClawTool({ name: 'exec', sessionKey: 'agent:main:main' }),
      (error: unknown) => error instanceof OpenClawToolsInvokeUnavailableError
        && error.code === 'OPENCLAW_TOOLS_INVOKE_TOOL_NOT_EFFECTIVE',
    );
    assert.equal(calls.includes('tools.invoke'), false);
    assert.equal(calls.includes('tools.effective'), true);
  } finally {
    stopPolling();
  }
});

test('tool catalogs follow Agent lifecycle and actual Gateway support', async () => {
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
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      if (method === 'tools.catalog') {
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshToolsCatalog('main'), false);
    assert.equal(useGatewayDataStore.getState().toolsCatalogError, 'OPENCLAW_TOOLS_CATALOG_UNSUPPORTED');
    assert.equal(calls.includes('tools.catalog'), true);
  } finally {
    stopPolling();
  }
});

test('refreshToolsCatalog commits only the current Gateway result for the selected Agent', async () => {
  const store = useGatewayDataStore.getState();
  store.setAgents([{ id: 'main' }]);
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const gateway = {
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

test('session artifacts follow Session lifecycle and actual Gateway support', async () => {
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
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      if (method === 'artifacts.list' || method === 'artifacts.download') {
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshSessionArtifacts('agent:main:main'), false);
    assert.equal(useGatewayDataStore.getState().sessionArtifactsError, 'OPENCLAW_ARTIFACTS_UNSUPPORTED');
    assert.equal(calls.includes('artifacts.list'), true);
    assert.deepEqual(await saveSessionArtifact('agent:main:main', 'artifact-1'), {
      success: false,
      errorCode: 'OPENCLAW_ARTIFACTS_UNSUPPORTED',
    });
    assert.equal(calls.includes('artifacts.download'), true);
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

test('memory.search maps actual Gateway rejection and never fabricates a result', async () => {
  const calls: string[] = [];
  const gateway = {
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [{ id: 'main' }] };
      if (method === 'memory.search') {
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await searchOpenClawMemory('release notes'), false);
    assert.equal(useGatewayDataStore.getState().memorySearchError, 'OPENCLAW_MEMORY_SEARCH_UNSUPPORTED');
    assert.equal(useGatewayDataStore.getState().memorySearch, null);
    assert.equal(calls.includes('memory.search'), true);
  } finally {
    stopPolling();
  }
});

test('memory.search commits only the latest query and preserves Gateway metadata', async () => {
  const pending = new Map<string, (value: unknown) => void>();
  const gateway = {
    request: (method: string, params: Record<string, unknown>) => {
      if (method === 'sessions.list') return Promise.resolve({ sessions: [], hasMore: false });
      if (method === 'agents.list') return Promise.resolve({ agents: [] });
      if (method === 'memory.search') {
        return new Promise<unknown>((resolve) => pending.set(String(params.query), resolve));
      }
      return Promise.reject(new Error(`unexpected method: ${method}`));
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    const first = searchOpenClawMemory('first');
    await Promise.resolve();
    const second = searchOpenClawMemory('second');
    await Promise.resolve();
    pending.get('second')?.({
      agentId: 'writer',
      provider: 'local',
      searchMode: 'fts-only',
      stale: true,
      warning: 'Index is stale',
      action: 'retry',
      results: [{
        path: 'sessions/2026-08-03.jsonl',
        startLine: 12,
        endLine: 14,
        score: 0.77,
        snippet: 'Gateway result',
        source: 'sessions',
      }],
    });
    assert.equal(await second, true);
    pending.get('first')?.({
      agentId: 'writer',
      provider: 'local',
      searchMode: 'hybrid',
      results: [],
    });
    assert.equal(await first, false);
    assert.deepEqual(useGatewayDataStore.getState().memorySearch, {
      agentId: 'writer',
      provider: 'local',
      searchMode: 'fts-only',
      stale: true,
      warning: 'Index is stale',
      action: 'retry',
      results: [{
        path: 'sessions/2026-08-03.jsonl',
        startLine: 12,
        endLine: 14,
        score: 0.77,
        snippet: 'Gateway result',
        source: 'sessions',
      }],
    });
    assert.equal(useGatewayDataStore.getState().memorySearchQuery, 'second');
  } finally {
    stopPolling();
  }
});

test('disconnect clears the Gateway-owned memory snapshot and invalidates its request', async () => {
  const gateway = {
    request: async (method: string) => {
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [] };
      if (method === 'memory.search') {
        return {
          agentId: 'main',
          provider: 'local',
          searchMode: 'hybrid',
          results: [],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  assert.equal(await searchOpenClawMemory('disconnect'), true);
  stopPolling();
  assert.equal(useGatewayDataStore.getState().memorySearch, null);
  assert.equal(useGatewayDataStore.getState().memorySearchQuery, '');
  assert.equal(useGatewayDataStore.getState().memorySearchLoading, false);
  assert.equal(useGatewayDataStore.getState().memorySearchError, null);
});

test('memory diagnostics requests only the current official status method', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const gateway = {
    request: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [] };
      if (method === 'doctor.memory.status') return {
        agentId: 'main',
        provider: 'local',
        embedding: { ok: false, checked: false, error: 'memory embedding readiness not checked' },
      };
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshOpenClawMemoryDiagnostics(), true);
    assert.deepEqual(useGatewayDataStore.getState().memoryDiagnostics?.embedding, {
      ok: false,
      checked: false,
      error: 'memory embedding readiness not checked',
    });
    assert.deepEqual(calls.filter((call) => call.method.startsWith('doctor.memory')), [
      { method: 'doctor.memory.status', params: {} },
    ]);
  } finally {
    stopPolling();
  }
});

test('memory diagnostics maps actual Gateway rejection without fabricating state', async () => {
  const calls: string[] = [];
  const gateway = {
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [] };
      if (method === 'doctor.memory.status') {
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await refreshOpenClawMemoryDiagnostics(), false);
    assert.equal(useGatewayDataStore.getState().memoryDiagnosticsError, 'OPENCLAW_MEMORY_DIAGNOSTICS_UNSUPPORTED');
    assert.equal(calls.includes('doctor.memory.status'), true);
  } finally {
    stopPolling();
  }
});

test('disconnect clears native memory diagnostics and invalidates late results', async () => {
  let resolveStatus: ((value: unknown) => void) | undefined;
  const gateway = {
    request: (method: string) => {
      if (method === 'sessions.list') return Promise.resolve({ sessions: [], hasMore: false });
      if (method === 'agents.list') return Promise.resolve({ agents: [] });
      if (method === 'doctor.memory.status') {
        return new Promise<unknown>((resolve) => { resolveStatus = resolve; });
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  const pending = refreshOpenClawMemoryDiagnostics();
  await Promise.resolve();
  stopPolling();
  resolveStatus?.({ agentId: 'main', embedding: { ok: true } });
  assert.equal(await pending, false);
  assert.equal(useGatewayDataStore.getState().memoryDiagnostics, null);
  assert.equal(useGatewayDataStore.getState().memoryDiagnosticsLoading, false);
  assert.equal(useGatewayDataStore.getState().memoryDiagnosticsError, null);
});

test('sessions.search maps actual Gateway rejection and never fabricates hits', async () => {
  const calls: string[] = [];
  const gateway = {
    request: async (method: string) => {
      calls.push(method);
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [] };
      if (method === 'sessions.search') {
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    assert.equal(await searchOpenClawSessions('release notes'), false);
    assert.equal(useGatewayDataStore.getState().sessionSearchError, 'OPENCLAW_SESSIONS_SEARCH_UNSUPPORTED');
    assert.equal(useGatewayDataStore.getState().sessionSearch, null);
    assert.equal(calls.includes('sessions.search'), true);
  } finally {
    stopPolling();
  }
});

test('sessions.search commits only the latest query and preserves native indexing flags', async () => {
  const pending = new Map<string, (value: unknown) => void>();
  const gateway = {
    request: (method: string, params: Record<string, unknown>) => {
      if (method === 'sessions.list') return Promise.resolve({ sessions: [], hasMore: false });
      if (method === 'agents.list') return Promise.resolve({ agents: [] });
      if (method === 'sessions.search') {
        return new Promise<unknown>((resolve) => pending.set(String(params.query), resolve));
      }
      return Promise.reject(new Error(`unexpected method: ${method}`));
    },
  };

  stopPolling();
  startPolling(gateway);
  try {
    const first = searchOpenClawSessions('first');
    await Promise.resolve();
    const second = searchOpenClawSessions('second');
    await Promise.resolve();
    pending.get('second')?.({
      indexing: false,
      truncated: true,
      results: [{
        sessionKey: 'agent:main:main',
        sessionId: 'session-2',
        messageId: 'message-2',
        role: 'assistant',
        timestamp: 1_700_000_000_000,
        snippet: 'Native transcript hit',
        score: 0.84,
      }],
    });
    assert.equal(await second, true);
    pending.get('first')?.({ results: [] });
    assert.equal(await first, false);
    assert.deepEqual(useGatewayDataStore.getState().sessionSearch, {
      indexing: false,
      truncated: true,
      results: [{
        sessionKey: 'agent:main:main',
        sessionId: 'session-2',
        messageId: 'message-2',
        role: 'assistant',
        timestamp: 1_700_000_000_000,
        snippet: 'Native transcript hit',
        score: 0.84,
      }],
    });
    assert.equal(useGatewayDataStore.getState().sessionSearchQuery, 'second');
  } finally {
    stopPolling();
  }
});

test('disconnect clears the Gateway-owned session search snapshot', async () => {
  const gateway = {
    request: async (method: string) => {
      if (method === 'sessions.list') return { sessions: [], hasMore: false };
      if (method === 'agents.list') return { agents: [] };
      if (method === 'sessions.search') {
        return {
          results: [{
            sessionKey: 'agent:main:main',
            sessionId: 'session-1',
            messageId: 'message-1',
            role: 'user',
            timestamp: 1_700_000_000_000,
            snippet: 'Gateway hit',
            score: 0.9,
          }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    },
  };

  stopPolling();
  startPolling(gateway);
  assert.equal(await searchOpenClawSessions('disconnect'), true);
  stopPolling();
  assert.equal(useGatewayDataStore.getState().sessionSearch, null);
  assert.equal(useGatewayDataStore.getState().sessionSearchQuery, '');
  assert.equal(useGatewayDataStore.getState().sessionSearchLoading, false);
  assert.equal(useGatewayDataStore.getState().sessionSearchError, null);
});
