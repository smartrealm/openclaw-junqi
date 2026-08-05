import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSessionsUsageQuery } from './useAnalyticsData';

test('analytics presets map to the official sessions.usage range contract', () => {
  assert.deepEqual(resolveSessionsUsageQuery('7d'), { range: '7d' });
  assert.deepEqual(resolveSessionsUsageQuery('90d'), { range: '90d' });
  assert.deepEqual(resolveSessionsUsageQuery('all'), { range: 'all' });
});

test('analytics custom dates use the official sessions.usage date boundary fields', () => {
  assert.deepEqual(resolveSessionsUsageQuery('custom', '2026-07-01', '2026-07-31'), {
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  });
});
