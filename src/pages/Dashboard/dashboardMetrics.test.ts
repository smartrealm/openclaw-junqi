import assert from 'node:assert/strict';
import test from 'node:test';
import {
  budgetProgress,
  costChangePercent,
  localDateKey,
  percentageOf,
  previousLocalDateKey,
} from './dashboardMetrics';

test('dashboard date keys follow local calendar dates instead of UTC dates', () => {
  const local = new Date(2026, 6, 14, 0, 30, 0);
  assert.equal(localDateKey(local), '2026-07-14');
  assert.equal(previousLocalDateKey(local), '2026-07-13');
});

test('cost comparison is neutral when yesterday has no usable baseline', () => {
  assert.equal(costChangePercent(4, 0), null);
  assert.equal(costChangePercent(4, Number.NaN), null);
  assert.equal(costChangePercent(8, 4), 100);
  assert.equal(costChangePercent(2, 4), -50);
});

test('context and budget percentages are clamped and use one data pair', () => {
  assert.equal(percentageOf(50, 200), 25);
  assert.equal(percentageOf(250, 200), 100);
  assert.equal(percentageOf(20, 0), 0);
  assert.equal(budgetProgress(25, 100), 25);
  assert.equal(budgetProgress(25, 0), null);
});
