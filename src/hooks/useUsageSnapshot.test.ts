import assert from 'node:assert/strict';
import test from 'node:test';
import { getUsageColor } from './useUsageSnapshot';

test('usage colors follow Nezha remaining-quota thresholds', () => {
  assert.equal(getUsageColor(71), 'rgb(var(--aegis-success))');
  assert.equal(getUsageColor(70), 'rgb(var(--aegis-warning))');
  assert.equal(getUsageColor(20), 'rgb(var(--aegis-warning))');
  assert.equal(getUsageColor(19), 'rgb(var(--aegis-danger))');
});
