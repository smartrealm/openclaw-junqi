import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseOpenClawCostUsageSummary,
  parseOpenClawSessionsUsage,
} from './OpenClawUsageClient';

const TOTALS = {
  input: 10,
  output: 5,
  cacheRead: 2,
  cacheWrite: 1,
  totalTokens: 18,
  totalCost: 0.01,
  inputCost: 0.005,
  outputCost: 0.004,
  cacheReadCost: 0.0005,
  cacheWriteCost: 0.0005,
  missingCostEntries: 0,
};

const AGGREGATES = {
  messages: { total: 1, user: 1, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 },
  tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
  byModel: [],
  byProvider: [],
  byAgent: [],
  byChannel: [],
  daily: [],
};

test('cost usage parser accepts official totals and rejects incomplete summaries', () => {
  const summary = {
    updatedAt: 1_750_000_000_000,
    days: 1,
    daily: [{ date: '2026-08-10', ...TOTALS }],
    totals: TOTALS,
  };

  assert.deepEqual(parseOpenClawCostUsageSummary(summary), summary);
  assert.equal(parseOpenClawCostUsageSummary({ ...summary, totals: { ...TOTALS, input: undefined } }), null);
  assert.equal(parseOpenClawCostUsageSummary({ ...summary, daily: [{ date: '2026-08-10', ...TOTALS, missingCostByModel: { model: -1 } }] }), null);
});

test('sessions usage parser requires the structured aggregates returned by OpenClaw', () => {
  const usage = {
    updatedAt: 1_750_000_000_000,
    startDate: '2026-08-10',
    endDate: '2026-08-10',
    sessions: [{
      key: 'agent:main:main',
      agentId: 'main',
      modelProvider: 'vllm',
      model: 'gpt-5.6-sol',
      usage: TOTALS,
    }],
    totals: TOTALS,
    aggregates: AGGREGATES,
  };

  assert.deepEqual(parseOpenClawSessionsUsage(usage), usage);
  assert.equal(parseOpenClawSessionsUsage({ ...usage, aggregates: { ...AGGREGATES, byChannel: undefined } }), null);
  assert.equal(parseOpenClawSessionsUsage({ ...usage, sessions: [{ ...usage.sessions[0], usage: { ...TOTALS, latency: { count: 1 } } }] }), null);
});
