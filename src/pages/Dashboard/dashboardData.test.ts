import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyCostChartData,
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
    { date: '07-19', input: 0, output: 0, cache: 0, other: 0, total: 0 },
    { date: '07-20', input: 0, output: 0, cache: 0, other: 0, total: 0 },
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
  }]);

  assert.equal(buildDailyCostChartData([{
    date: '2026-07-20',
    inputCost: -1,
    outputCost: Number.NaN,
    totalCost: Number.POSITIVE_INFINITY,
  }])[0]?.total, 0);
});

test('activity metadata uses compact local time and short model names', () => {
  const timestamp = new Date(2026, 6, 20, 9, 5, 7).getTime();
  assert.equal(formatActivityTime(timestamp), '07-20 09:05');
  assert.equal(formatActivityTimeTitle(timestamp), '2026-07-20 09:05:07');
  assert.equal(formatActivityTime(0), '—');
  assert.equal(shortModelName('openai/gpt-5.5'), 'gpt-5.5');
  assert.equal(shortModelName(''), '—');
});
