import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyCostChartData,
  getDashboardTokenUsageOverview,
  getDailyCostAvailability,
  resolveDashboardPricingNotice,
  resolveDashboardChartMetric,
  formatActivityTime,
  formatActivityTimeTitle,
  shortModelName,
} from './dashboardData';

test('daily cost chart keeps dated zero-cost buckets and sorts them', () => {
  assert.deepEqual(buildDailyCostChartData([
    { date: '2026-07-20', totalCost: 0 },
    { date: 'invalid', totalCost: 9 },
    { date: '2026-07-19', totalCost: 0 },
  ]), [
    { date: '07-19', input: 0, output: 0, cache: 0, other: 0, total: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0 },
    { date: '07-20', input: 0, output: 0, cache: 0, other: 0, total: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0 },
  ]);
});

test('daily cost chart includes cache and unclassified cost without negative values', () => {
  assert.deepEqual(buildDailyCostChartData([{
    date: '2026-07-20',
    inputCost: 1,
    outputCost: 2,
    cacheReadCost: 0.5,
    cacheWriteCost: 0.25,
    totalCost: 4,
  }]), [{
    date: '07-20',
    input: 1,
    output: 2,
    cache: 0.75,
    other: 0.25,
    total: 4,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    totalTokens: 0,
  }]);

  assert.equal(buildDailyCostChartData([{
    date: '2026-07-20',
    inputCost: -1,
    outputCost: Number.NaN,
    totalCost: Number.POSITIVE_INFINITY,
  }])[0]?.total, 0);
});

test('daily cost availability keeps token activity separate from unavailable pricing', () => {
  assert.deepEqual(getDailyCostAvailability([{
    date: '2026-07-20',
    totalTokens: 42_000,
    totalCost: 0,
    missingCostEntries: 3,
  }]), {
    hasDatedEntries: true,
    hasPricedCost: false,
    totalTokens: 42_000,
    missingCostEntries: 3,
  });
});

test('daily cost availability uses component costs and tokens when aggregate fields are absent', () => {
  assert.deepEqual(getDailyCostAvailability([{
    date: '2026-07-20',
    inputCost: 0.4,
    outputCost: 0.6,
    input: 12_000,
    output: 8_000,
    cacheRead: 2_000,
  }]), {
    hasDatedEntries: true,
    hasPricedCost: true,
    totalTokens: 22_000,
    missingCostEntries: 0,
  });
});

test('daily cost availability retains partial-pricing evidence alongside known cost', () => {
  assert.deepEqual(getDailyCostAvailability([{
    date: '2026-07-20',
    totalCost: 1.2,
    totalTokens: 8_000,
    missingCostEntries: 3,
  }]), {
    hasDatedEntries: true,
    hasPricedCost: true,
    totalTokens: 8_000,
    missingCostEntries: 3,
  });
});

test('费用提示在全部未定价和部分估价之间保持互斥', () => {
  assert.equal(resolveDashboardPricingNotice({
    hasDatedEntries: true,
    hasPricedCost: false,
    totalTokens: 42_000,
    missingCostEntries: 3,
  }), 'unpriced');
  assert.equal(resolveDashboardPricingNotice({
    hasDatedEntries: true,
    hasPricedCost: true,
    totalTokens: 42_000,
    missingCostEntries: 3,
  }), 'partial');
  assert.equal(resolveDashboardPricingNotice({
    hasDatedEntries: true,
    hasPricedCost: true,
    totalTokens: 42_000,
    missingCostEntries: 0,
  }), 'none');
});

test('single-day unpriced usage becomes a summary instead of a blank trend chart', () => {
  const overview = getDashboardTokenUsageOverview(buildDailyCostChartData([{
    date: '2026-07-20',
    input: 140_000,
    output: 2_000,
    totalTokens: 142_000,
  }]));

  assert.deepEqual(overview, {
    totalTokens: 142_000,
    inputTokens: 140_000,
    outputTokens: 2_000,
    cacheTokens: 0,
    unclassifiedTokens: 0,
    activeDays: 1,
    latestActivityDate: '07-20',
    hasTrend: false,
  });
});

test('multiple plotted usage days remain eligible for the token trend chart', () => {
  const overview = getDashboardTokenUsageOverview(buildDailyCostChartData([
    { date: '2026-07-19', input: 10 },
    { date: '2026-07-20', output: 20 },
  ]));

  assert.equal(overview.hasTrend, true);
  assert.equal(overview.activeDays, 2);
});

test('部分未估价时默认展示 Token 趋势并允许查看已知费用', () => {
  const availability = {
    hasDatedEntries: true,
    hasPricedCost: true,
    totalTokens: 42_000,
    missingCostEntries: 3,
  };
  const overview = {
    totalTokens: 42_000,
    inputTokens: 40_000,
    outputTokens: 2_000,
    cacheTokens: 0,
    unclassifiedTokens: 0,
    activeDays: 2,
    latestActivityDate: '07-20',
    hasTrend: true,
  };

  assert.equal(resolveDashboardChartMetric('auto', availability, overview), 'tokens');
  assert.equal(resolveDashboardChartMetric('cost', availability, overview), 'cost');
  assert.equal(resolveDashboardChartMetric('tokens', availability, overview), 'tokens');
});

test('activity metadata uses compact local time and short model names', () => {
  const timestamp = new Date(2026, 6, 20, 9, 5, 7).getTime();
  assert.equal(formatActivityTime(timestamp), '07-20 09:05');
  assert.equal(formatActivityTimeTitle(timestamp), '2026-07-20 09:05:07');
  assert.equal(formatActivityTime(0), '—');
  assert.equal(shortModelName('openai/gpt-5.5'), 'gpt-5.5');
  assert.equal(shortModelName(''), '—');
});
